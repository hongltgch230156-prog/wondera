// frontend/src/components/puppet/rigEngine.js
// ENGINE KHUNG XƯƠNG: làm sạch ảnh -> quét hình bóng (silhouette) -> tự đặt điểm neo khớp -> kiểm tra hợp lệ.
// File này KHÔNG đụng tới DOM (trừ canvas để đọc điểm ảnh) nên dễ test riêng.
import { PUPPET_VIEW } from "./puppetConfig.js";

/* ------------------------------------------------------------------ */
/*  1. Làm sạch ảnh: tách nền, cắt khung, đổi cỡ                       */
/* ------------------------------------------------------------------ */
const dist2 = (r, g, b, c) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;

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
    // ---- ước lượng màu nền từ viền ảnh (nền trắng / một màu) ----
    const samples = [];
    const push = (x, y) => { const i = (y * w + x) * 4; samples.push([d[i], d[i + 1], d[i + 2]]); };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    const med = (ch) => samples.map((s) => s[ch]).sort((a, b) => a - b)[samples.length >> 1];
    const bg = [med(0), med(1), med(2)];
    bgSpread = Math.sqrt(samples.reduce((a, s) => a + dist2(s[0], s[1], s[2], bg), 0) / samples.length);
    const tol2 = (34 + Math.min(30, bgSpread * 1.2)) ** 2;
    // ---- flood fill từ viền: chỉ xoá vùng nền NỐI với viền ----
    const isBg = new Uint8Array(w * h);
    const stack = [];
    const seed = (x, y) => {
      const p = y * w + x;
      if (isBg[p]) return;
      const i = p * 4;
      if (dist2(d[i], d[i + 1], d[i + 2], bg) <= tol2) { isBg[p] = 1; stack.push(p); }
    };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0;
      if (x > 0) seed(x - 1, y);
      if (x < w - 1) seed(x + 1, y);
      if (y > 0) seed(x, y - 1);
      if (y < h - 1) seed(x, y + 1);
    }
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (isBg[p]) { d[i + 3] = 0; continue; }
      // làm mềm viền: điểm ảnh sát nền và gần màu nền thì mờ bớt
      const nearBg = (p % w > 0 && isBg[p - 1]) || (p % w < w - 1 && isBg[p + 1]) || (p >= w && isBg[p - w]) || (p < w * (h - 1) && isBg[p + w]);
      if (nearBg) {
        const t = Math.sqrt(dist2(d[i], d[i + 1], d[i + 2], bg)) / Math.sqrt(tol2);
        d[i + 3] = Math.max(0, Math.min(255, Math.round((t - 1) * 255 * 1.2 + 120)));
      }
    }
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

  // ---- (c) hai đầu tay + vị trí khớp vai/cổ tay ----
  let xL = maxX, xR = minX;
  for (let y = top; y <= bot; y++) if (rows[y]?.runs.length) { xL = Math.min(xL, rows[y].left); xR = Math.max(xR, rows[y].right); }
  if (!tpose) { xL = minX; xR = maxX; }
  const shR = cx - torsoW * 0.44, shL = cx + torsoW * 0.44;
  const armLenR = Math.max(10, shR - xL), armLenL = Math.max(10, xR - shL);
  const wR = xL + Math.min(armLenR * 0.2, bw * 0.08), wL = xR - Math.min(armLenL * 0.2, bw * 0.08);
  // trung tâm theo chiều dọc của cánh tay (quét cột giữa vai - cổ tay)
  const colCenter = (x0, x1) => {
    const x = Math.round((x0 + x1) / 2); let a = -1, b = -1;
    for (let y = Math.round(yBand - bh * 0.12); y <= Math.round(yBand + bh * 0.12); y++) if (mask[y * w + x]) { if (a < 0) a = y; b = y; }
    return a < 0 ? null : { c: (a + b) / 2, t: b - a + 1 };
  };
  const cR = colCenter(wR, shR), cL = colCenter(shL, wL);
  const yJ = cR && cL ? (cR.c + cL.c) / 2 : yBand;
  const armThick = cR && cL ? (cR.t + cL.t) / 2 : bh * 0.06;

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
  for (let y = Math.round(maxY - bh * 0.08); y >= Math.round(minY + bh * 0.4); y--) {
    if (nRuns(y) >= 2) { crotch = y; single = 0; } else if (crotch >= 0 && ++single >= 3) break;
  }
  report.legsSplit = crotch >= 0 && crotch <= minY + bh * 0.82;
  if (!report.legsSplit) crotch = Math.round(minY + bh * 0.56);
  const hipY = crotch - bh * 0.04;
  const legLen = maxY - hipY;
  const twoRuns = (y) => {
    const rs = rows[Math.max(minY, Math.min(maxY, Math.round(y)))].runs.filter((r) => r[1] - r[0] + 1 >= MINRUN).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 2).sort((a, b) => a[0] - b[0]);
    return rs.length === 2 ? rs : null;
  };
  const rowThigh = crotch + (maxY - crotch) * 0.18, rowAnkle = maxY - (maxY - crotch) * 0.14;
  const tR = report.legsSplit ? twoRuns(rowThigh) : null, aR = report.legsSplit ? twoRuns(rowAnkle) : null;
  const hipSep = bw * 0.07;
  const hipRx = tR ? (tR[0][0] + tR[0][1]) / 2 : cx - hipSep, hipLx = tR ? (tR[1][0] + tR[1][1]) / 2 : cx + hipSep;
  const ankRx = aR ? (aR[0][0] + aR[0][1]) / 2 : hipRx, ankLx = aR ? (aR[1][0] + aR[1][1]) / 2 : hipLx;
  const ankleY = maxY - legLen * 0.07;
  const thighR = tR ? (tR[0][1] - tR[0][0] + 1 + tR[1][1] - tR[1][0] + 1) / 4 : bw * 0.07;
  const shinR = aR ? (aR[0][1] - aR[0][0] + 1 + aR[1][1] - aR[1][0] + 1) / 4 : thighR * 0.9;

  const J = {
    head: P(headX, headY), neck: P(headX, neckY),
    shoulderR: P(shR, yJ), wristR: P(wR, yJ), elbowR: P((shR + wR) / 2, yJ),
    shoulderL: P(shL, yJ), wristL: P(wL, yJ), elbowL: P((shL + wL) / 2, yJ),
    hipR: P(hipRx, hipY), ankleR: P(ankRx, ankleY), kneeR: P((hipRx + ankRx) / 2, (hipY + ankleY) / 2),
    hipL: P(hipLx, hipY), ankleL: P(ankLx, ankleY), kneeL: P((hipLx + ankLx) / 2, (hipY + ankleY) / 2),
    hip: P((hipRx + hipLx) / 2, hipY),
  };
  report.symmetric = report.symmetric && Math.abs(headX - cx) < bw * 0.08;

  const notes = [];
  if (!tpose) notes.push("Arms are not stretched out sideways (T-pose).");
  if (!report.legsSplit) notes.push("Legs are not clearly separated.");
  if (!report.neckDistinct) notes.push("Neck line is unclear.");
  const confidence = 0.35 * (tpose ? 1 : 0) + 0.3 * (report.legsSplit ? 1 : 0) + 0.2 * (report.neckDistinct ? 1 : 0) + 0.15 * (report.symmetric ? 1 : 0);
  report.ok = confidence >= 0.65;

  return {
    rig: {
      version: 1, image: { w, h }, bounds, axisX: cx, manual: [], confidence, notes, joints: J,
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