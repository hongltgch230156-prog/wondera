// backend/scripts/rescueLostFiles.js
// Chạy MỘT LẦN sau khi chuyển sang Supabase để dọn các bản ghi cũ đã mất file (ảnh vỡ trong Account).
//   node scripts/rescueLostFiles.js           -> chỉ XEM (không sửa gì)
//   node scripts/rescueLostFiles.js --apply   -> thực hiện
// Với mỗi bản ghi "ready":
//   - file còn            -> giữ nguyên (nếu thumbnail mất thì để trống)
//   - model mất file, link fal còn sống -> tải lại và upload lên kho lưu trữ (cứu được)
//   - không cứu được      -> xóa bản ghi (để số lượng và danh sách trong Account không bị sai)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Creation = require('../models/Creation');
const storage = require('../utils/storage');

const APPLY = process.argv.includes('--apply');
const MAX_GLB_BYTES = 150 * 1024 * 1024;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Kho lưu trữ: ${storage.USE_SUPABASE ? 'Supabase' : 'ổ đĩa (chưa bật Supabase!)'} | chế độ: ${APPLY ? 'THỰC HIỆN' : 'CHỈ XEM'}`);

  const docs = await Creation.find({ status: 'ready' });
  const stat = { ok: 0, rescued: 0, removed: 0 };

  for (const d of docs) {
    const label = `${d.type}/${d.name || 'Untitled'} (${d._id})`;
    const fileAlive = await storage.exists(d.file);

    if (fileAlive) {
      stat.ok++;
      if (d.thumb && !(await storage.exists(d.thumb))) {
        console.log(`  - ${label}: thumbnail đã mất -> để trống`);
        if (APPLY) { d.thumb = ''; await d.save(); }
      }
      continue;
    }

    if (d.type === 'model' && d.remoteUrl && storage.isFalUrl(d.remoteUrl)) {
      try {
        const buf = await storage.fetchBuffer(d.remoteUrl, MAX_GLB_BYTES);
        console.log(`  + ${label}: CỨU được từ link fal`);
        if (APPLY) {
          d.file = await storage.saveBuffer('models', '.glb', buf);
          if (d.thumb && !(await storage.exists(d.thumb))) d.thumb = '';
          await d.save();
        }
        stat.rescued++;
        continue;
      } catch (e) {
        /* link fal hết hạn -> xuống dưới xóa */
      }
    }

    console.log(`  x ${label}: mất file, không cứu được -> xóa bản ghi`);
    if (APPLY) await d.deleteOne();
    stat.removed++;
  }

  console.log(`\nXong. Còn nguyên: ${stat.ok} | cứu được: ${stat.rescued} | xóa: ${stat.removed}${APPLY ? '' : '  (chưa áp dụng, thêm --apply để thực hiện)'}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });