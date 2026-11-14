// frontend/src/components/puppet/rigEngine.js
// ENGINE KHUNG XƯƠNG: làm sạch ảnh -> quét hình bóng (silhouette) -> tự đặt điểm neo khớp -> kiểm tra hợp lệ.
// File này KHÔNG đụng tới DOM (trừ canvas để đọc điểm ảnh) nên dễ test riêng.
import { PUPPET_VIEW } from "./puppetConfig.js";
/* ------------------------------------------------------------------ */
/*  1. Làm sạch ảnh: tách nền, cắt khung, đổi cỡ                       */
/* ------------------------------------------------------------------ */
const dist2 = (r, g, b, c) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
/**
 * Tách nền khỏi ảnh KHÔNG có kênh alpha (render 3D / ảnh nền trắng). Sửa d (RGBA) tại chỗ, trả về độ "nhiễu" của nền.
 * 1) Flood-fill chặt từ viền ảnh (màu gần đúng màu nền) – như trước.
 * 2) Mở rộng qua BÓNG ĐỔ: điểm ảnh gần như trung tính (cùng tông với nền, chỉ tối hơn) VÀ đổi màu rất ít so với điểm kề nó đã là nền.
 *    Bóng đổ thì mịn, còn nét viền / quần áo nhân vật thì đổi màu gắt -> vùng mở rộng dừng đúng ở mép nhân vật.
 *    Nhờ vậy khe giữa hai chân, khe dưới nách tay và bóng dưới giày (thường bị bóng làm tối nên không "gần nền") cũng được xoá.
 */
export function removeBackground(d, w, h, opts = {}) {
  const samples = [];
  const push = (x, y) => { const i = (y * w + x) * 4; samples.push([d[i], d[i + 1], d[i + 2]]); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  const med = (ch) => samples.map((s) => s[ch]).sort((a, b) => a - b)[samples.length >> 1];
  const bg = [med(0), med(1), med(2)];
  const bgSpread = Math.sqrt(samples.reduce((a, s) => a + dist2(s[0], s[1], s[2], bg), 0) / samples.length);
  const tol2 = (34 + Math.min(30, bgSpread * 1.2)) ** 2;
  const bgLum = (bg[0] + bg[1] + bg[2]) / 3;
  // tham số "bóng đổ" (chỉ dùng khi nền sáng gần như trung tính – nền trắng / xám nhạt)
  const neutralBg = Math.max(bg[0], bg[1], bg[2]) - Math.min(bg[0], bg[1], bg[2]) < 14 && bgLum > 150;
  const chromaTol = opts.chromaTol ?? 8, stepTol2 = (opts.stepTol ?? 6.5) ** 2, minLum = bgLum * (opts.minLumRatio ?? 0.5);
  // "sắc độ" = màu sau khi chuẩn hoá theo độ sáng. Bóng đổ chỉ làm TỐI nền (sắc độ không đổi), còn quần áo màu kem / ngà
  // có độ sáng gần nền nhưng sắc độ khác (ấm hơn) -> không được coi là nền (trước đây bị flood-fill ăn lẹm).
  const bm = Math.max(1, bgLum), bgN = [bg[0] / bm, bg[1] / bm, bg[2] / bm];
  const chromaTolN = (opts.chromaDist ?? 0.05) + Math.min(0.05, bgSpread * 0.01);
  const chromDist = (i) => {
    const m = Math.max(1, (d[i] + d[i + 1] + d[i + 2]) / 3);
    return Math.hypot(d[i] / m - bgN[0], d[i + 1] / m - bgN[1], d[i + 2] / m - bgN[2]);
  };
  const chromaOf = (i) => { const r = d[i], g = d[i + 1], b = d[i + 2], m = (r + g + b) / 3; return Math.max(Math.abs(r - m), Math.abs(g - m), Math.abs(b - m)); };
  // điểm "giống nền" chặt: gần màu nền VÀ cùng sắc độ với nền
  const strictLike = (i) => dist2(d[i], d[i + 1], d[i + 2], bg) <= tol2 && chromDist(i) <= chromaTolN;
  const isBg = new Uint8Array(w * h), stack = [];
  const accept = (q, p) => {
    const i = q * 4;
    if (strictLike(i)) return true;                                                   // 1) gần màu nền
    if (!neutralBg || p < 0) return false;
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (lum < minLum || chromaOf(i) > chromaTol) return false;                         // 2) bóng: trung tính & không quá tối
    const j = p * 4;
    return dist2(d[i], d[i + 1], d[i + 2], [d[j], d[j + 1], d[j + 2]]) <= stepTol2;    //    và đổi màu rất ít so với điểm kề (mịn)
  };
  const seed = (x, y) => { const q = y * w + x; if (!isBg[q] && strictLike(q * 4)) { isBg[q] = 1; stack.push(q); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  const grow = (q, p) => { if (!isBg[q] && accept(q, p)) { isBg[q] = 1; stack.push(q); } };
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p / w) | 0;
    if (x > 0) grow(p - 1, p);
    if (x < w - 1) grow(p + 1, p);
    if (y > 0) grow(p - w, p);
    if (y < h - 1) grow(p + w, p);
  }
  // ---- "lỗ" kín giống nền: khe giữa hai chân bị đóng ở đáy bởi bóng / đế giày chạm nhau thì flood-fill từ viền không tới được ----
  // Chỉ xoá những vùng kín giống nền mà trông như KHE: cao & hẹp, nằm ở nửa dưới và gần trục giữa thân (không đụng tới áo trắng, mắt, răng...).
  {
    let fx0 = w, fy0 = h, fx1 = -1, fy1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!isBg[y * w + x]) { if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y; }
    if (fx1 > fx0 && fy1 > fy0) {
      const fbw = fx1 - fx0 + 1, fbh = fy1 - fy0 + 1, fcx = (fx0 + fx1) / 2;
      const seen = new Uint8Array(w * h), minArea = Math.max(60, Math.round(fbw * fbh * 0.0012));
      for (let y0 = Math.round(fy0 + fbh * 0.45); y0 <= fy1; y0++) for (let x0 = fx0; x0 <= fx1; x0++) {
        const s0 = y0 * w + x0;
        if (seen[s0] || isBg[s0] || !strictLike(s0 * 4)) continue;
        const comp = [s0]; seen[s0] = 1;
        let minx = x0, maxx = x0, miny = y0, maxy = y0, touchesEdge = false;
        for (let k = 0; k < comp.length; k++) {
          const p = comp[k], x = p % w, y = (p / w) | 0;
          if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
          for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
            if (q >= 0 && !seen[q] && !isBg[q] && strictLike(q * 4)) { seen[q] = 1; comp.push(q); }
          }
        }
        const cw = maxx - minx + 1, chh = maxy - miny + 1, ccx = (minx + maxx) / 2;
        if (!touchesEdge && comp.length >= minArea && chh >= cw * 1.8 && cw <= fbw * 0.2 && miny >= fy0 + fbh * 0.45 && Math.abs(ccx - fcx) <= fbw * 0.22) {
          for (const p of comp) isBg[p] = 1;
        }
      }
    }
  }
  // ---- bóng sàn dưới chân: dải xám mờ nằm giữa / dưới hai giày. Chạy thêm một lượt flood-fill NỚI LỎNG nhưng chỉ ở sát đáy ảnh ----
  if (neutralBg) {
    let fy0 = h, fy1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!isBg[y * w + x]) { if (y < fy0) fy0 = y; if (y > fy1) fy1 = y; }
    if (fy1 > fy0) {
      const yMin = Math.round(fy0 + (fy1 - fy0) * 0.9), loose2 = (opts.floorStep ?? 12) ** 2, lo = bgLum * 0.4, hi = bgLum * 1.03;
      const st2 = [];
      for (let y = yMin; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x; if (isBg[p]) continue;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        if (nb.some((q) => q >= 0 && isBg[q])) st2.push(p);
      }
      const ok2 = (q, p) => {
        const i = q * 4, j = p * 4, lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
        return lum >= lo && lum <= hi && chromaOf(i) <= 11 && dist2(d[i], d[i + 1], d[i + 2], [d[j], d[j + 1], d[j + 2]]) <= loose2;
      };
      // st2 = điểm KHÔNG phải nền sát nền; thử "nuốt" chúng nếu giống bóng, rồi lan tiếp
      const q2 = [];
      for (const p of st2) {
        const x = p % w, y = (p / w) | 0, nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        const src = nb.find((q) => q >= 0 && isBg[q]);
        if (src >= 0 && ok2(p, src)) { isBg[p] = 1; q2.push(p); }
      }
      while (q2.length) {
        const p = q2.pop(), x = p % w, y = (p / w) | 0;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > yMin ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && !isBg[q] && ok2(q, p)) { isBg[q] = 1; q2.push(q); }
        }
      }
    }
  }
  // ---- làm sạch VIỀN: ảnh render / ảnh chụp có viền mờ trộn lẫn màu nền (quầng trắng) ----
  // dEdge[p] = khoảng cách (px) từ điểm ảnh tới điểm nền gần nhất, chỉ tính tới 3px
  const R = 3, dEdge = new Float32Array(w * h).fill(99);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (isBg[p]) { d[p * 4 + 3] = 0; continue; }
    let best = 99;
    for (let dy = -R; dy <= R; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w || !isBg[yy * w + xx]) continue;
        const dd = Math.hypot(dx, dy); if (dd < best) best = dd;
      }
    }
    dEdge[p] = best;
  }
  const tol = Math.sqrt(tol2), sm = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const src = new Uint8ClampedArray(d);                       // bản gốc để lấy màu "ruột" của nhân vật
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (isBg[p] || dEdge[p] > 2.2) continue;
    // 1) độ trong suốt: càng giống màu nền càng trong, chuyển sắc nét trong ~1px thay vì dải mờ 3px
    const t = Math.sqrt(dist2(src[i], src[i + 1], src[i + 2], bg)) / tol;
    d[i + 3] = Math.round(255 * sm((t - 0.8) / 1.4));
    // 2) khử quầng: điểm viền còn nhiều màu nền (sáng) thì mượn màu của phần ruột nhân vật ở gần nó
    if (t < 2.4) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -4; dy <= 4; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -4; dx <= 4; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx; if (isBg[q] || dEdge[q] <= 2.2) continue;
          const j = q * 4; sr += src[j]; sg += src[j + 1]; sb += src[j + 2]; n++;
        }
      }
      if (n) { d[i] = sr / n; d[i + 1] = sg / n; d[i + 2] = sb / n; }
    }
  }
  return bgSpread;
}
/**
 * img: HTMLImageElement | ImageBitmap | canvas
 * Trả về { canvas, hadAlpha, bgSpread, srcSize } – canvas là texture đã cắt sát hình, nền trong suốt.
 */
export function cleanImage(img, maxSide = PUPPET_VIEW.TEXTURE_MAX) {
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) transparent++;
  const hadAlpha = transparent > w * h * 0.01;
  let bgSpread = 0;
  if (!hadAlpha) {
    bgSpread = removeBackground(d, w, h);
    ctx.putImageData(id, 0, 0);
  }
  // ---- cắt sát hình + chừa lề ----
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 40) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return { canvas: c, hadAlpha, bgSpread, srcSize: [sw, sh], empty: true };
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.05);
  const cx0 = Math.max(0, minX - pad), cy0 = Math.max(0, minY - pad);
  const cx1 = Math.min(w, maxX + 1 + pad), cy1 = Math.min(h, maxY + 1 + pad);
  const out = document.createElement("canvas");
  out.width = cx1 - cx0; out.height = cy1 - cy0;
  out.getContext("2d", { willReadFrequently: true }).drawImage(c, cx0, cy0, out.width, out.height, 0, 0, out.width, out.height);
  const touches = (minX <= 1) + (minY <= 1) + (maxX >= w - 2) + (maxY >= h - 2);
  return { canvas: out, hadAlpha, bgSpread, srcSize: [sw, sh], touchesBorder: touches };
}
/* ------------------------------------------------------------------ */
/*  2. Quét hình bóng -> điểm neo                                      */
/* ------------------------------------------------------------------ */
const smooth = (arr, win) => {
  const out = new Float32Array(arr.length), r = Math.max(1, win >> 1);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(arr.length - 1, i + r); j++) { s += arr[j]; n++; }
    out[i] = s / n;
  }
  return out;
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const P = (x, y) => ({ x, y });
const lerpP = (a, b, t) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
/** Tỉ lệ cơ thể mặc định (khi thuật toán quét thất bại) – tính theo khung giới hạn. */
export function templateRig(w, h, bounds = { x: 0, y: 0, w, h }) {
  const { x, y, w: bw, h: bh } = bounds;
  const cx = x + bw / 2, at = (fx, fy) => P(x + bw * fx, y + bh * fy);
  const j = {
    head: at(0.5, 0.1), neck: at(0.5, 0.19),
    shoulderR: at(0.37, 0.26), elbowR: at(0.2, 0.26), wristR: at(0.07, 0.26),
    shoulderL: at(0.63, 0.26), elbowL: at(0.8, 0.26), wristL: at(0.93, 0.26),
    hip: at(0.5, 0.54), hipR: at(0.45, 0.54), kneeR: at(0.45, 0.76), ankleR: at(0.45, 0.94),
    hipL: at(0.55, 0.54), kneeL: at(0.55, 0.76), ankleL: at(0.55, 0.94),
  };
  return {
    version: 1, image: { w, h }, bounds, axisX: cx, manual: [], confidence: 0.2, notes: ["Template proportions used"],
    joints: j,
    widths: { head: bh * 0.09, torso: bw * 0.16, arm: bh * 0.035, thigh: bw * 0.07, shin: bw * 0.06 },
  };
}
/**
 * Quét ImageData (nền trong suốt) và trả về { rig, report }.
 * Giả định hình T-pose: tay dang ngang, hai chân tách nhau, thân đứng thẳng.
 */
export function analyzeRig(imageData) {
  const { width: w, height: h, data } = imageData;
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 40) {
      mask[y * w + x] = 1; count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const report = { coverage: count / (w * h), armRatio: 0, legsSplit: false, neckDistinct: false, symmetric: true, ok: false, empty: count === 0 };
  if (count === 0) return { rig: templateRig(w, h), report };
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const bounds = { x: minX, y: minY, w: bw, h: bh };
  report.bounds = bounds;
  const GAP = 1;                       // chỉ nối khe 1px (khe giữa hai chân thường rất hẹp)
  const MINRUN = Math.max(2, Math.round(bw * 0.02));
  // ---- thống kê từng hàng: các đoạn liền (runs), mép trái/phải, độ rộng ----
  const rows = new Array(h);
  const ext = new Float32Array(h);
  for (let y = minY; y <= maxY; y++) {
    const runs = []; let start = -1, last = -1;
    for (let x = minX; x <= maxX; x++) {
      if (mask[y * w + x]) { if (start < 0) start = x; else if (x - last > GAP) { runs.push([start, last]); start = x; } last = x; }
    }
    if (start >= 0) runs.push([start, last]);
    const left = runs.length ? runs[0][0] : 0, right = runs.length ? runs[runs.length - 1][1] : -1;
    rows[y] = { runs, left, right, ext: right - left + 1 };
    ext[y] = right - left + 1;
  }
  const extS = smooth(ext, Math.max(3, Math.round(bh * 0.012)));
  // ---- (a) dải tay: hàng rộng nhất ở nửa trên ----
  const yA0 = Math.round(minY + bh * 0.10), yA1 = Math.round(minY + bh * 0.55);
  let peakY = yA0, peak = 0;
  for (let y = yA0; y <= yA1; y++) if (extS[y] > peak) { peak = extS[y]; peakY = y; }
  let top = peakY, bot = peakY;
  while (top > yA0 && extS[top - 1] >= peak * 0.8) top--;
  while (bot < yA1 && extS[bot + 1] >= peak * 0.8) bot++;
  let yBand = (top + bot) / 2;
  // ---- (b) thân: độ rộng ngay dưới dải tay ----
  const tw = [], tc = [];
  for (let y = Math.round(bot + bh * 0.05); y <= Math.round(bot + bh * 0.16) && y <= maxY; y++) {
    if (rows[y]?.runs.length) { tw.push(rows[y].ext); tc.push((rows[y].left + rows[y].right) / 2); }
  }
  const torsoW = Math.max(bw * 0.1, median(tw) || bw * 0.25);
  const cx = tc.length ? median(tc) : minX + bw / 2;
  report.armRatio = peak / torsoW;
  const tpose = report.armRatio >= 1.5;
  if (!tpose) { yBand = minY + bh * 0.26; report.symmetric = false; }
  // ---- (c) hai đầu tay + trục tay (lần theo đường giữa của cánh tay, kể cả khi tay xuôi xuống chéo – dáng chữ A) ----
  let xL = maxX, xR = minX;
  for (let y = top; y <= bot; y++) if (rows[y]?.runs.length) { xL = Math.min(xL, rows[y].left); xR = Math.max(xR, rows[y].right); }
  if (!tpose) { xL = minX; xR = maxX; }
  const shR = cx - torsoW * 0.44, shL = cx + torsoW * 0.44;
  const armLenR = Math.max(10, shR - xL), armLenL = Math.max(10, xR - shL);
  const wR = xL + Math.min(armLenR * 0.2, bw * 0.08), wL = xR - Math.min(armLenL * 0.2, bw * 0.08);
  // các đoạn dọc (runs) của một cột ảnh trong khoảng [y0, y1]
  const colRuns = (x, y0, y1) => {
    const out = []; let a = -1, last = -1;
    for (let y = y0; y <= y1; y++) {
      if (mask[y * w + x]) { if (a < 0) a = y; else if (y - last > GAP) { out.push([a, last]); a = y; } last = y; }
    }
    if (a >= 0) out.push([a, last]);
    return out;
  };
  // Đi từ đầu bàn tay vào phía thân: ở mỗi cột chọn đoạn nối tiếp với tâm cột trước; dừng khi bề dày tăng vọt (đã chạm thân / vai).
  const traceArm = (xTip, inward) => {
    const y0 = Math.round(minY + bh * 0.05), y1 = Math.round(minY + bh * 0.72);
    // y của đầu bàn tay = trung bình các hàng chạm mép ngoài cùng
    let sy = 0, n = 0;
    for (let y = y0; y <= y1; y++) { const r = rows[y]; if (r?.runs.length && (inward > 0 ? r.left <= xTip + 1 : r.right >= xTip - 1)) { sy += y; n++; } }
    let prev = n ? sy / n : yBand;
    const pts = [], xEnd = inward > 0 ? cx - torsoW * 0.3 : cx + torsoW * 0.3;
    for (let x = xTip + inward * 2; inward > 0 ? x < xEnd : x > xEnd; x += inward) {
      let best = null, bd = Infinity;
      for (const [a, b2] of colRuns(x, y0, y1)) {
        const c = (a + b2) / 2, dd = a <= prev && prev <= b2 ? 0 : Math.min(Math.abs(a - prev), Math.abs(b2 - prev));
        if (dd < bd) { bd = dd; best = { c, t: b2 - a + 1, a, b: b2 }; }
      }
      if (!best || bd > Math.max(6, best.t * 0.5)) break;
      if (pts.length > 14) {
        const med = median(pts.slice(-14).map((q) => q.t));
        if (best.t > med * 1.9 || best.t > bh * 0.3) break;
      }
      pts.push({ x, c: best.c, t: best.t }); prev = best.c;
    }
    return pts;
  };
  // Khớp đường thẳng y = a + m x qua phần giữa cánh tay (bỏ bàn tay ở đầu và chỗ nối thân ở cuối)
  const fitArm = (pts) => {
    if (pts.length < 12) return null;
    const i0 = Math.floor(pts.length * 0.25), i1 = Math.ceil(pts.length * 0.9), q = pts.slice(i0, Math.max(i1, i0 + 6));
    const mx = q.reduce((s, p) => s + p.x, 0) / q.length, my = q.reduce((s, p) => s + p.c, 0) / q.length;
    let sxx = 0, sxy = 0; for (const p of q) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.c - my); }
    const m = sxx > 1e-6 ? sxy / sxx : 0;
    const thick = median(q.map((p) => p.t));
    return { m: Math.max(-1.2, Math.min(1.2, m)), a: my - m * mx, thick };
  };
  const trR = traceArm(xL, 1), trL = traceArm(xR, -1);
  const fR = fitArm(trR), fL = fitArm(trL);
  report.armSlopeDeg = fR && fL ? Math.round((Math.atan(Math.abs(fR.m)) + Math.atan(Math.abs(fL.m))) / 2 * 180 / Math.PI) : 0;
  const lineY = (f, x) => f.a + f.m * x;
  // dự phòng (không lần được trục tay): dùng đường nằm ngang như trước
  const colCenter = (x0, x1) => {
    const x = Math.round((x0 + x1) / 2); let a = -1, b = -1;
    for (let y = Math.round(yBand - bh * 0.12); y <= Math.round(yBand + bh * 0.12); y++) if (mask[y * w + x]) { if (a < 0) a = y; b = y; }
    return a < 0 ? null : { c: (a + b) / 2, t: b - a + 1 };
  };
  const cR = colCenter(wR, shR), cL = colCenter(shL, wL);
  const yJflat = cR && cL ? (cR.c + cL.c) / 2 : yBand;
  const yShR = fR ? lineY(fR, shR) : yJflat, yShL = fL ? lineY(fL, shL) : yJflat;
  const yWrR = fR ? lineY(fR, wR) : yJflat, yWrL = fL ? lineY(fL, wL) : yJflat;
  const yJ = (yShR + yShL) / 2;
  const cosR = fR ? Math.cos(Math.atan(fR.m)) : 1, cosL = fL ? Math.cos(Math.atan(fL.m)) : 1;
  const armThick = fR && fL ? (fR.thick * cosR + fL.thick * cosL) / 2 : cR && cL ? (cR.t + cL.t) / 2 : bh * 0.06;
  const armBottom = Math.max(...[...trR, ...trL].map((q) => q.c + q.t / 2), yJ);          // hàng thấp nhất của hai cánh tay
  // ---- kiểu vai: "pin" (tay là khối riêng có nét viền bao quanh đầu tròn, vẽ đè lên thân – như con rối giấy) hay
  //      "blend" (tay áo liền khối với thân, không có nét viền ranh giới – ảnh render 3D / đồ liền thân) ----
  // Đi dọc trục tay từ giữa tay vào phía thân; nếu gặp một NÉT MẢNH TỐI (bề rộng <= 7px, tối hơn hẳn hai bên) thì là kiểu "pin".
  const lumAt = (x, y) => {
    const i = (Math.round(y) * w + Math.round(x)) * 4;
    return data[i + 3] < 128 ? null : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  const hasOutline = (f, inward, xFrom, xTo) => {
    if (!f) return false;
    const prof = [];
    for (let x = xFrom; inward > 0 ? x <= xTo : x >= xTo; x += inward) prof.push(lumAt(x, lineY(f, x)));
    const ok = prof.filter((v) => v !== null);
    if (ok.length < 20) return false;
    const ref = median(ok.slice(0, Math.max(6, Math.floor(ok.length * 0.4))));       // độ sáng của tay
    let i = 0;
    while (i < prof.length) {
      if (prof[i] !== null && prof[i] < ref * 0.55) {
        let j = i; while (j < prof.length && prof[j] !== null && prof[j] < ref * 0.6) j++;
        const width = j - i, before = prof[i - 4] ?? null, after = prof[j + 4] ?? null;
        if (width <= 7 && before !== null && after !== null && before > ref * 0.7 && after > ref * 0.7) return true;
        i = j;
      } else i++;
    }
    return false;
  };
  const midR = (xL + shR) / 2, midL = (shL + xR) / 2;
  report.shoulderStyle = hasOutline(fR, 1, Math.round(midR), Math.round(cx - torsoW * 0.1)) || hasOutline(fL, -1, Math.round(midL), Math.round(cx + torsoW * 0.1)) ? "pin" : "blend";
  // ---- (d) cổ: hàng hẹp nhất giữa đỉnh đầu và vai ----
  // hàng rộng nhất của phần đầu (bỏ qua tai / chỏm tóc ở trên) -> cổ nằm SAU hàng đó
  let headWidY = Math.round(minY + bh * 0.08), headWid = 0;
  for (let y = Math.round(minY + bh * 0.04); y <= Math.round(yJ - bh * 0.08); y++) if (extS[y] > headWid) { headWid = extS[y]; headWidY = y; }
  const nA = headWidY + Math.round(bh * 0.03), nB = Math.round(yJ - bh * 0.02);
  let neckY = Math.round(minY + bh * 0.2), neckMin = Infinity, headMax = headWid;
  for (let y = nA; y <= nB; y++) if (extS[y] < neckMin) { neckMin = extS[y]; neckY = y; }
  report.neckDistinct = neckMin <= headMax * 0.8 && neckY > minY + bh * 0.08;
  if (!report.neckDistinct) neckY = Math.round(minY + bh * 0.2);
  const hc = []; let headExt = 0;
  for (let y = Math.max(minY, Math.round(neckY - bh * 0.14)); y <= neckY; y++) if (rows[y]?.runs.length) { hc.push((rows[y].left + rows[y].right) / 2); headExt = Math.max(headExt, rows[y].ext); }
  const headR = Math.max(bh * 0.05, headExt / 2 * 0.95);
  const headX = hc.length ? median(hc) : cx;
  const headY = Math.max(minY + headR * 0.7, neckY - headR * 0.85);
  // ---- (e) chân: quét từ dưới lên tới hàng cuối cùng còn thấy 2 đoạn ----
  const nRuns = (y) => rows[y].runs.filter((r) => r[1] - r[0] + 1 >= MINRUN).length;
  let crotch = -1, single = 0;
  // Chỉ quét phía DƯỚI hai cánh tay: khi tay xuôi xuống (dáng chữ A), khe giữa tay và thân cũng cho 2-3 đoạn liền
  // và bị nhận nhầm là khe giữa hai chân -> hông bị đặt ngang ngực.
  const legTop = Math.max(Math.round(minY + bh * 0.4), Math.ceil(armBottom + 2));
  for (let y = Math.round(maxY - bh * 0.08); y >= legTop; y--) {
    if (nRuns(y) >= 2) { crotch = y; single = 0; } else if (crotch >= 0 && ++single >= 3) break;
  }
  report.legsSplit = crotch >= 0 && crotch <= minY + bh * 0.82;
  // Đường may / bóng tối giữa hai ống quần (dọc trục thân): cho biết chân bắt đầu tách ở đâu kể cả khi hai chân dính liền
  // và silhouette không có khe. Trả về hàng ảnh nơi đường tối này bắt đầu (từ dưới đi lên), hoặc null.
  const lumRow = (x, y) => { const i = (y * w + x) * 4; return data[i + 3] < 128 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const seamCrotch = () => {
    const gb = Math.max(3, Math.round(bw * 0.02)), yA = Math.max(legTop, Math.round(minY + bh * 0.4)), yB = Math.round(maxY - bh * 0.12);
    const o1 = Math.round(bw * 0.07), o2 = Math.round(bw * 0.12), ys = [], D = [];
    for (let y = yA; y <= yB; y++) {
      let side = 0, n = 0;
      for (const sgn of [-1, 1]) for (let o = o1; o <= o2; o += 2) { const x = Math.round(cx + sgn * o); if (x >= 0 && x < w && mask[y * w + x]) { side += lumRow(x, y); n++; } }
      let cm = 255; for (let x = Math.round(cx - gb); x <= Math.round(cx + gb); x++) if (x >= 0 && x < w && mask[y * w + x]) cm = Math.min(cm, lumRow(x, y));
      ys.push(y); D.push(n >= 4 && side > 0 ? ((side / n) - cm) / (side / n) : 0);
    }
    // làm mượt 5 hàng rồi tìm đoạn liền dài nhất có D > ngưỡng, kết thúc gần chân
    const sm = D.map((_, i) => { let a = 0, c = 0; for (let k = -2; k <= 2; k++) if (D[i + k] !== undefined) { a += D[i + k]; c++; } return a / c; });
    let best = null, start = -1, gap = 0;
    for (let i = 0; i <= sm.length; i++) {
      const on = i < sm.length && sm[i] > 0.07;
      if (on) { if (start < 0) start = i; gap = 0; }
      else if (start >= 0) { if (++gap > 4 || i === sm.length) { const end = i - gap; if (!best || end - start > best.end - best.start) best = { start, end }; start = -1; gap = 0; } }
    }
    if (!best) return null;
    const top = ys[best.start], bottom = ys[best.end];
    return bottom >= maxY - bh * 0.3 && bottom - top >= bh * 0.1 ? top : null;
  };
  report.seamCrotch = seamCrotch();
  if (!report.legsSplit) {
    // hai chân dính liền: ưu tiên đường may giữa hai ống quần, nếu không thấy thì dùng tỉ lệ cơ thể điển hình
    // đường may thường bắt đầu cao hơn chỗ chia chân một chút (cạp quần / khóa kéo) nên cộng thêm ~4.5% chiều cao
    crotch = report.seamCrotch != null ? Math.round(report.seamCrotch + bh * 0.045) : Math.round(minY + bh * 0.6);
    report.crotchSource = report.seamCrotch ? "seam" : "proportion";
  } else report.crotchSource = "gap";
  const hipY = crotch - bh * 0.04;
  const legLen = maxY - hipY;
  const twoRuns = (y) => {
    const rs = rows[Math.max(minY, Math.min(maxY, Math.round(y)))].runs.filter((r) => r[1] - r[0] + 1 >= MINRUN).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 2).sort((a, b) => a[0] - b[0]);
    return rs.length === 2 ? rs : null;
  };
  const rowThigh = crotch + (maxY - crotch) * 0.18, rowAnkle = maxY - (maxY - crotch) * 0.14;
  // Hai chân dính liền (một khối) -> chia đôi khối đó ở giữa, mỗi nửa là một chân
  const splitRun = (y) => {
    const r = rows[Math.max(minY, Math.min(maxY, Math.round(y)))].runs.filter((q) => q[1] - q[0] + 1 >= MINRUN).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
    if (!r) return null;
    const m = (r[0] + r[1]) / 2;
    return [[r[0], m - 1], [m + 1, r[1]]];
  };
  const tR = (report.legsSplit && twoRuns(rowThigh)) || splitRun(rowThigh), aR = (report.legsSplit && twoRuns(rowAnkle)) || splitRun(rowAnkle);
  const hipSep = bw * 0.07;
  const hipRx = tR ? (tR[0][0] + tR[0][1]) / 2 : cx - hipSep, hipLx = tR ? (tR[1][0] + tR[1][1]) / 2 : cx + hipSep;
  const ankRx = aR ? (aR[0][0] + aR[0][1]) / 2 : hipRx, ankLx = aR ? (aR[1][0] + aR[1][1]) / 2 : hipLx;
  const ankleY = maxY - legLen * 0.07;
  const thighR = tR ? (tR[0][1] - tR[0][0] + 1 + tR[1][1] - tR[1][0] + 1) / 4 : bw * 0.07;
  const shinR = aR ? (aR[0][1] - aR[0][0] + 1 + aR[1][1] - aR[1][0] + 1) / 4 : thighR * 0.9;
  const J = {
    head: P(headX, headY), neck: P(headX, neckY),
    shoulderR: P(shR, yShR), wristR: P(wR, yWrR), elbowR: P((shR + wR) / 2, (yShR + yWrR) / 2),
    shoulderL: P(shL, yShL), wristL: P(wL, yWrL), elbowL: P((shL + wL) / 2, (yShL + yWrL) / 2),
    hipR: P(hipRx, hipY), ankleR: P(ankRx, ankleY), kneeR: P((hipRx + ankRx) / 2, (hipY + ankleY) / 2),
    hipL: P(hipLx, hipY), ankleL: P(ankLx, ankleY), kneeL: P((hipLx + ankLx) / 2, (hipY + ankleY) / 2),
    hip: P((hipRx + hipLx) / 2, hipY),
  };
  report.symmetric = report.symmetric && Math.abs(headX - cx) < bw * 0.08;
  const notes = [];
  if (!tpose) notes.push("Arms are not stretched out sideways (T-pose).");
  if (tpose && report.armSlopeDeg > 30) notes.push("Arms are angled down quite a lot – a flatter T-pose works best.");
  if (!report.legsSplit) notes.push("Legs are not clearly separated.");
  if (!report.neckDistinct) notes.push("Neck line is unclear.");
  const confidence = 0.35 * (tpose ? 1 : 0) + 0.3 * (report.legsSplit ? 1 : 0) + 0.2 * (report.neckDistinct ? 1 : 0) + 0.15 * (report.symmetric ? 1 : 0);
  report.ok = confidence >= 0.65;
  return {
    rig: {
      version: 1, image: { w, h }, bounds, axisX: cx, manual: [], confidence, notes, joints: J,
      shoulderStyle: report.shoulderStyle, shoulderInset: report.shoulderStyle === "pin" ? 0.85 : 0.35,
      widths: { head: headR, torso: torsoW / 2, arm: Math.max(bh * 0.02, armThick / 2 * 1.1), thigh: Math.max(bw * 0.03, thighR), shin: Math.max(bw * 0.025, shinR) },
    },
    report,
  };
}
/* ------------------------------------------------------------------ */
/*  3. Chỉnh tay & dữ liệu                                             */
/* ------------------------------------------------------------------ */
const MIRROR = { shoulderR: "shoulderL", shoulderL: "shoulderR", elbowR: "elbowL", elbowL: "elbowR", wristR: "wristL", wristL: "wristR", hipR: "hipL", hipL: "hipR", kneeR: "kneeL", kneeL: "kneeR", ankleR: "ankleL", ankleL: "ankleR" };
export const mirrorName = (n) => MIRROR[n] || null;
/** Cập nhật các khớp suy ra (hông giữa, khuỷu/đầu gối nếu chưa chỉnh tay) sau khi có thay đổi */
export function refreshDerived(rig) {
  const j = rig.joints, man = new Set(rig.manual);
  j.hip = lerpP(j.hipR, j.hipL, 0.5);
  if (!man.has("elbowR")) j.elbowR = lerpP(j.shoulderR, j.wristR, 0.5);
  if (!man.has("elbowL")) j.elbowL = lerpP(j.shoulderL, j.wristL, 0.5);
  if (!man.has("kneeR")) j.kneeR = lerpP(j.hipR, j.ankleR, 0.5);
  if (!man.has("kneeL")) j.kneeL = lerpP(j.hipL, j.ankleL, 0.5);
  return rig;
}
/** Kéo một khớp tới (x, y). mirror = true thì khớp đối xứng cũng đi theo (qua trục thân). */
export function moveJoint(rig, name, x, y, mirror = false) {
  const w = rig.image.w, h = rig.image.h;
  const cl = (v, m) => Math.max(0, Math.min(m, v));
  rig.joints[name] = P(cl(x, w), cl(y, h));
  if (!rig.manual.includes(name) && name !== "hip") rig.manual.push(name);
  const m = mirrorName(name);
  if (mirror && m) {
    rig.joints[m] = P(cl(2 * rig.axisX - x, w), cl(y, h));
    if (!rig.manual.includes(m)) rig.manual.push(m);
  }
  if (name === "hip") {
    const dx = x - (rig.joints.hipR.x + rig.joints.hipL.x) / 2, dy = y - rig.joints.hipR.y;
    rig.joints.hipR = P(rig.joints.hipR.x + dx, rig.joints.hipR.y + dy);
    rig.joints.hipL = P(rig.joints.hipL.x + dx, rig.joints.hipL.y + dy);
  }
  return refreshDerived(rig);
}
export const cloneRig = (rig) => JSON.parse(JSON.stringify(rig));
export const serializeRig = (rig) => JSON.stringify(rig);
export const deserializeRig = (s) => JSON.parse(s);
/** Độ dài từng đoạn xương (đơn vị điểm ảnh của texture) */
export function boneLengths(rig) {
  const j = rig.joints, d = (a, b) => Math.hypot(j[a].x - j[b].x, j[a].y - j[b].y);
  return {
    upperArmR: d("shoulderR", "elbowR"), foreArmR: d("elbowR", "wristR"),
    upperArmL: d("shoulderL", "elbowL"), foreArmL: d("elbowL", "wristL"),
    thighR: d("hipR", "kneeR"), shinR: d("kneeR", "ankleR"),
    thighL: d("hipL", "kneeL"), shinL: d("kneeL", "ankleL"),
    torso: Math.hypot(j.neck.x - j.hip.x, j.neck.y - j.hip.y),
  };
}
/* ------------------------------------------------------------------ */
/*  4. Kiểm tra hợp lệ (hiện trên bảng hướng dẫn của Uploader)         */
/* ------------------------------------------------------------------ */
/** Trả về { ok, items:[{level:"ok"|"warn"|"error", text}] } */
export function validatePuppet({ clean, report, rig }) {
  const items = [];
  const add = (level, text) => items.push({ level, text });
  const [sw, sh] = clean.srcSize || [0, 0];
  if (clean.empty || report.empty) { add("error", "No character found – the picture looks empty."); return { ok: false, items }; }
  if (Math.min(sw, sh) < PUPPET_VIEW.MIN_SIDE) add("error", `Image is too small (${sw}×${sh}). Use at least ${PUPPET_VIEW.MIN_SIDE}px on the short side.`);
  else add("ok", "Image size is fine.");
  if (clean.hadAlpha) add("ok", "Transparent background detected.");
  else if (clean.bgSpread > 18) add("warn", "Background is not a single flat colour – edges may look rough. A transparent or plain white background is best.");
  else add("ok", "Plain background removed automatically.");
  if (report.coverage < 0.04) add("warn", "The character looks very small in the picture – crop closer.");
  const ratio = report.bounds ? report.bounds.h / report.bounds.w : 1;
  if (ratio < 0.7 || ratio > 3.2) add("warn", "Unusual proportions – the figure should be a standing full-body character.");
  if (clean.touchesBorder >= 2) add("warn", "The character touches the picture edge – hands or feet may be cut off.");
  add(report.armRatio >= 1.5 ? "ok" : "warn", report.armRatio >= 1.5 ? "Arms stretched out sideways (T-pose)." : "Arms are not stretched out sideways – the arm joints may be wrong. Use a T-pose picture or adjust by hand.");
  add(report.legsSplit ? "ok" : "warn", report.legsSplit ? "Both legs found." : "Legs are touching or cut off – leave a small gap between the legs.");
  add(report.neckDistinct ? "ok" : "warn", report.neckDistinct ? "Head and neck found." : "Head/neck line is unclear – check the head and neck points.");
  const ok = !items.some((i) => i.level === "error");
  return { ok, confidence: rig.confidence, items };
}