// backend/utils/storage.js
// Lưu file (model .glb, ảnh export, thumbnail).
//  - Có SUPABASE_URL + SUPABASE_SERVICE_KEY trong .env  -> lưu lên Supabase Storage (vĩnh viễn, không mất khi deploy/restart)
//  - Không có                                           -> lưu ổ đĩa server như cũ (tiện chạy localhost)
// Các hàm export GIỮ NGUYÊN tên/kiểu trả về như bản cũ nên accountRoutes.js gần như không phải sửa.
require('dotenv').config(); // storage.js được require TRƯỚC khi server.js gọi dotenv.config(), nên phải nạp .env ở đây
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'wondera-files';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
if (!USE_SUPABASE) {
  ['models', 'exports', 'thumbs'].forEach((d) =>
    fs.mkdirSync(path.join(STORAGE_DIR, d), { recursive: true })
  );
}
console.log(`[storage] Đang lưu file bằng: ${USE_SUPABASE ? `Supabase Storage (bucket "${BUCKET}")` : 'Ổ ĐĨA SERVER (có thể mất khi deploy!)'}`);

/* ----------------------------- Supabase client ----------------------------- */
let _client = null;
function client() {
  if (!_client) {
    const { createClient } = require('@supabase/supabase-js');
    _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// Gói Free của Supabase có thể tự "tạm dừng" project nếu lâu không có hoạt động.
// Gọi nhẹ 1 lần / 12 giờ (khi server đang chạy) để project luôn được tính là còn hoạt động.
if (USE_SUPABASE) {
  const t = setInterval(() => {
    client().storage.from(BUCKET).list('', { limit: 1 }).catch(() => {});
  }, 12 * 60 * 60 * 1000);
  if (t.unref) t.unref();
}

/* ----------------------------- Tiện ích chung ----------------------------- */
// Tên file ngẫu nhiên 32 ký tự hex => không đoán được link của người khác
const randomName = () => crypto.randomBytes(16).toString('hex');

const CONTENT_TYPES = {
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// Chặn đường dẫn thoát ra ngoài thư mục storage (chế độ ổ đĩa)
function resolveSafe(rel) {
  const abs = path.resolve(STORAGE_DIR, rel);
  if (!abs.startsWith(STORAGE_DIR + path.sep)) throw new Error('Đường dẫn không hợp lệ');
  return abs;
}

// URL công khai trực tiếp của Supabase cho một "rel" kiểu "models/abc.glb"
const supabasePublicUrl = (rel) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${rel}`;

/* ----------------------------- Ghi / xóa / kiểm tra ----------------------------- */
/** Lưu buffer, trả về "rel" (vd "models/abc.glb") để lưu vào database như trước. */
async function saveBuffer(subdir, ext, buffer) {
  const rel = `${subdir}/${randomName()}${ext}`;
  if (USE_SUPABASE) {
    const { error } = await client()
      .storage.from(BUCKET)
      .upload(rel, buffer, {
        contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
        cacheControl: '31536000',
        upsert: false,
      });
    if (error) throw new Error(`Supabase upload lỗi: ${error.message}`);
    return rel;
  }
  await fsp.writeFile(resolveSafe(rel), buffer);
  return rel;
}

// Ảnh thu nhỏ 360x300 (JPEG) dùng cho thẻ trong trang Account
async function saveThumb(buffer) {
  const jpg = await sharp(buffer)
    .rotate()
    .resize(360, 300, { fit: 'cover' })
    .flatten({ background: '#ffffff' }) // ảnh PNG trong suốt -> nền trắng
    .jpeg({ quality: 78 })
    .toBuffer();
  return saveBuffer('thumbs', '.jpg', jpg);
}

async function removeFiles(...rels) {
  const list = rels.filter(Boolean);
  if (!list.length) return;
  if (USE_SUPABASE) {
    try {
      await client().storage.from(BUCKET).remove(list);
    } catch {
      /* file đã mất thì thôi */
    }
    return;
  }
  for (const rel of list) {
    try {
      await fsp.unlink(resolveSafe(rel));
    } catch {
      /* file đã mất thì thôi */
    }
  }
}

/** File còn tồn tại không? (dùng cho script dọn bản ghi cũ) */
async function exists(rel) {
  if (!rel) return false;
  try {
    if (USE_SUPABASE) {
      const res = await fetch(supabasePublicUrl(rel), { method: 'HEAD' });
      return res.ok;
    }
    await fsp.access(resolveSafe(rel));
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------- Tải file từ fal ----------------------------- */
// Chỉ tải về từ CDN của fal (tránh để client bắt server tải một link bất kỳ)
function isFalUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    return (
      u.hostname === 'fal.media' ||
      u.hostname.endsWith('.fal.media') ||
      (u.hostname === 'storage.googleapis.com' && u.pathname.startsWith('/falserverless/'))
    );
  } catch {
    return false;
  }
}

async function fetchBuffer(url, maxBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tải file thất bại (${res.status})`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) throw new Error('File quá lớn');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('File quá lớn');
  return buf;
}

/* ----------------------------- Đường dẫn công khai ----------------------------- */
// Vẫn trả "/files/models/abc.glb" như cũ => frontend/Account KHÔNG phải sửa gì.
// Route /files (filesMiddleware bên dưới) sẽ chuyển hướng sang URL Supabase.
const publicPath = (rel) => (rel ? `/files/${rel}` : '');

const localStatic = express.static(STORAGE_DIR, { index: false, dotfiles: 'deny', maxAge: '7d' });
const SAFE_REL = /^\/(models|exports|thumbs)\/[a-f0-9]{32}\.(glb|jpg|png|webp)$/;

/** Dùng trong server.js:  app.use('/files', storage.filesMiddleware); */
function filesMiddleware(req, res, next) {
  if (!USE_SUPABASE) return localStatic(req, res, next);
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!SAFE_REL.test(req.path)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  return res.redirect(302, supabasePublicUrl(req.path.slice(1)));
}

module.exports = {
  STORAGE_DIR,
  USE_SUPABASE,
  saveBuffer,
  saveThumb,
  removeFiles,
  exists,
  isFalUrl,
  fetchBuffer,
  publicPath,
  filesMiddleware,
};