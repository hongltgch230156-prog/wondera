// frontend/src/components/puppet/accountImages.js
// Lấy ảnh từ "My 2D Exports" của tài khoản (GET /api/account/exports) – dùng chung cho Uploader con rối và chọn bóng/vật phẩm.
import { API_BASE, getToken } from "../auth.js";
import { loadImage } from "./puppetAssets.js";

const safeUrl = (u) => (typeof u === "string" && /^(https?:|blob:|data:image\/|\/)/i.test(u) ? u : "");
export const resolveUrl = (u) => (u && u.startsWith("/") ? API_BASE + u : u);
export const isLoggedIn = () => !!getToken();

/** Trả về [{ id, name, url, thumb }] – ném lỗi nếu chưa đăng nhập hoặc server lỗi */
export async function fetchExports() {
  const token = getToken();
  if (!token) throw new Error("not-logged-in");
  const res = await fetch(`${API_BASE}/api/account/exports`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.items || data.exports || [];
  return list
    .map((i) => ({ id: i.id, name: i.name || "Export", url: resolveUrl(i.url || i.thumbnail), thumb: resolveUrl(i.thumbnail || i.url) }))
    .filter((i) => safeUrl(i.url));
}

/** Tải ảnh thành HTMLImageElement “sạch” (đọc được điểm ảnh). Ưu tiên fetch -> blob để tránh lỗi CORS-tainted. */
export async function loadAccountImage(url) {
  try {
    const headers = getToken() && url.startsWith(API_BASE) ? { Authorization: `Bearer ${getToken()}` } : {};
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(String(res.status));
    return await loadImage(URL.createObjectURL(await res.blob()));
  } catch {
    return loadImage(url);          // cách dự phòng: <img crossOrigin="anonymous">
  }
}