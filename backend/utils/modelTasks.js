// backend/utils/modelTasks.js
// Tự ghi lại model 3D của user ngay khi họ bấm Generate (không cần sửa forge.js).
//  - trackModelTask:    gọi sau khi gửi task lên fal  -> tạo bản ghi "pending" + thumbnail
//  - finalizeModelTask: gọi khi task hoàn tất         -> chuyển "ready" và tải file .glb lên kho lưu trữ
//  - healPendingTasks:  gọi khi user mở trang Account -> tự "cứu" các task mà frontend đã ngừng hỏi (user đóng Forge/tắt tab)
const { fal } = require('@fal-ai/client');
const Creation = require('../models/Creation');
const storage = require('./storage');
const credits = require('./credits');

const FAL_ENDPOINT = 'fal-ai/trellis-2';
// Supabase gói Free giới hạn ~50MB / file. File lớn hơn sẽ upload lỗi và dùng tạm link fal.
const MAX_GLB_BYTES = 150 * 1024 * 1024;
const MAX_THUMB_SOURCE_BYTES = 15 * 1024 * 1024;
const HEAL_BATCH = 10; // mỗi lần mở Account chỉ xử lý tối đa 10 bản ghi
const HEAL_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // khớp STALE_PENDING_MS của accountRoutes
const DEFAULT_NAMES = { single: '3D Object', scene: '3D Scene', magic: 'Magic Wand object' };

function cleanName(raw, kind) {
  const base = String(raw || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 60);
  return base || DEFAULT_NAMES[kind] || '3D Model';
}

// Lấy link .glb từ kết quả của fal (cùng logic với /api/task-status trong server.js)
function extractModelUrl(result) {
  const dataObj = result?.data || result;
  let fileUrl = dataObj?.model_glb?.url || dataObj?.model_mesh?.url || dataObj?.model_file?.url;
  if (!fileUrl) {
    const glbMatch = JSON.stringify(result || {}).match(/https?:\/\/[^"'\s]+\.glb/i);
    if (glbMatch) fileUrl = glbMatch[0];
  }
  return fileUrl || '';
}

/** Tải .glb từ fal rồi đưa lên kho lưu trữ, gắn vào bản ghi. Ném lỗi nếu thất bại. */
async function uploadGlb(doc, glbUrl) {
  const buf = await storage.fetchBuffer(glbUrl, MAX_GLB_BYTES);
  doc.file = await storage.saveBuffer('models', '.glb', buf);
  await doc.save();
}

/** Không bao giờ ném lỗi: việc lưu lịch sử không được làm hỏng việc tạo model. */
async function trackModelTask(userId, taskId, { kind, name, thumbBuffer, thumbUrl }) {
  try {
    let thumb = '';
    try {
      if (thumbBuffer) {
        thumb = await storage.saveThumb(thumbBuffer);
      } else if (thumbUrl && storage.isFalUrl(thumbUrl)) {
        thumb = await storage.saveThumb(await storage.fetchBuffer(thumbUrl, MAX_THUMB_SOURCE_BYTES));
      }
    } catch (e) {
      console.warn('[Account] Không tạo được thumbnail:', e.message);
    }
    await Creation.create({
      user: userId,
      type: 'model',
      kind,
      name: cleanName(name, kind),
      status: 'pending',
      taskId,
      thumb,
    });
  } catch (e) {
    if (e.code !== 11000) console.error('[Account] trackModelTask:', e.message);
  }
}

/** Gọi mỗi lần client hỏi trạng thái. Chỉ lần đầu tiên (pending -> ready) mới tải file về. */
async function finalizeModelTask(userId, taskId, glbUrl) {
  try {
    const doc = await Creation.findOneAndUpdate(
      { user: userId, type: 'model', taskId, status: 'pending' },
      { status: 'ready', remoteUrl: glbUrl },
      { returnDocument: 'after' }
    );
    if (!doc) return; // đã xử lý rồi, hoặc task này không phải của user
    if (!storage.isFalUrl(glbUrl)) return;
    await uploadGlb(doc, glbUrl);
  } catch (e) {
    // Không sao: bản ghi vẫn "ready" (dùng tạm link fal) và healPendingTasks sẽ thử upload lại lần sau
    console.error('[Account] finalizeModelTask:', e.message);
  }
}

/**
 * "Cứu" các bản ghi của user. Gọi khi user mở trang Account. Không bao giờ ném lỗi ra ngoài từng bản ghi.
 *  1) Task còn "pending": hỏi fal, nếu đã xong thì lưu luôn (trường hợp user đóng Forge nên frontend ngừng hỏi).
 *     Nếu task thất bại thì hoàn credit (chỉ hoàn được một lần).
 *  2) Bản ghi "ready" nhưng chưa có file trong kho lưu trữ (lần upload trước lỗi): thử upload lại từ link fal.
 */
async function healPendingTasks(userId) {
  // 1) task còn pending
  const pendings = await Creation.find({
    user: userId,
    type: 'model',
    status: 'pending',
    taskId: { $nin: [null, ''] },
    createdAt: { $gt: new Date(Date.now() - HEAL_MAX_AGE_MS) },
  })
    .sort({ createdAt: -1 })
    .limit(HEAL_BATCH);

  for (const doc of pendings) {
    try {
      const st = await fal.queue.status(FAL_ENDPOINT, { requestId: doc.taskId, logs: false });
      if (st.status === 'COMPLETED') {
        const result = await fal.queue.result(FAL_ENDPOINT, { requestId: doc.taskId });
        const url = extractModelUrl(result);
        if (url) await finalizeModelTask(userId, doc.taskId, url);
        else credits.refundByTask(userId, doc.taskId, 'no model file returned').catch(() => {});
      } else if (st.status === 'FAILED') {
        credits.refundByTask(userId, doc.taskId, 'generation failed').catch(() => {});
      }
    } catch (e) {
      console.warn('[Account] heal pending:', doc.taskId, e.message);
    }
  }

  // 2) ready nhưng chưa có file
  const orphans = await Creation.find({
    user: userId,
    type: 'model',
    status: 'ready',
    file: { $in: [null, ''] },
    remoteUrl: { $nin: [null, ''] },
  }).limit(HEAL_BATCH);

  for (const doc of orphans) {
    try {
      if (!storage.isFalUrl(doc.remoteUrl)) continue;
      await uploadGlb(doc, doc.remoteUrl);
    } catch (e) {
      console.warn('[Account] heal upload:', doc._id.toString(), e.message); // link fal có thể đã hết hạn
    }
  }
}

module.exports = { trackModelTask, finalizeModelTask, healPendingTasks };