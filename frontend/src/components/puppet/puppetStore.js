// frontend/src/components/puppet/puppetStore.js
// ĐÓNG GÓI DỮ LIỆU CON RỐI ("Puppet package") + lưu con rối tự upload trong localStorage.
//
// Puppet package (thứ mà phần thời gian thực – poseSolver / puppetRenderer – cần):
//   {
//     id, name, version: 1,
//     texture:  <canvas>  ảnh đã tách nền + cắt sát hình
//     rig: { image:{w,h}, bounds, axisX, joints:{ <tên khớp>: {x,y} }, widths:{head,torso,arm,thigh,shin}, manual:[...], confidence }
//   }
// Cập nhật thời gian thực chỉ cần: solvePose(rig, { root, scale, targets:{wristR, wristL, ankleR, ankleL}, lean, headTilt })
import { PuppetSprite } from "./puppetRenderer.js";
import { cleanImage, analyzeRig, cloneRig } from "./rigEngine.js";

const KEY = "wondera.puppet.custom.v1";
const MAX_SAVED = 4;

export function makePackage({ id, name, texture, rig }) {
  return { id: id || "p" + Math.random().toString(36).slice(2, 9), name: (name || "My Puppet").slice(0, 24), version: 1, texture, rig: cloneRig(rig) };
}
export const packageToSprite = (pkg) => new PuppetSprite(pkg.texture, pkg.rig, pkg.name);

/** Tạo package từ một ảnh (HTMLImageElement/canvas) – dùng cho con rối mẫu và cả ảnh người dùng upload. */
export function packageFromImage(img, name) {
  const clean = cleanImage(img);
  const data = clean.canvas.getContext("2d").getImageData(0, 0, clean.canvas.width, clean.canvas.height);
  const { rig, report } = analyzeRig(data);
  return { pkg: makePackage({ name, texture: clean.canvas, rig }), clean, report };
}

export function listSaved() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function savePackage(pkg) {
  try {
    const entry = { id: pkg.id, name: pkg.name, rig: pkg.rig, png: pkg.texture.toDataURL("image/png") };
    const list = [entry, ...listSaved().filter((e) => e.id !== pkg.id)].slice(0, MAX_SAVED);
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch { return false; }          // đầy bộ nhớ / chế độ riêng tư: bỏ qua, vẫn dùng được trong phiên này
}
export function removeSaved(id) {
  try { localStorage.setItem(KEY, JSON.stringify(listSaved().filter((e) => e.id !== id))); } catch { /* bỏ qua */ }
}
/** Dựng lại package từ bản đã lưu (texture là PNG data URL) */
export function restorePackage(entry) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").drawImage(img, 0, 0); resolve({ id: entry.id, name: entry.name, version: 1, texture: c, rig: entry.rig }); };
    img.onerror = reject; img.src = entry.png;
  });
}