// frontend/src/components/puppet/puppetRenderer.js
// RENDERER: vẽ sân khấu 2.5D lên canvas – nền, con rối (từng bộ phận xoay quanh khớp), vợt / vũ khí,
// quả cầu, bóng bàn tay hắt lên phông + sợi dây, và hiệu ứng.
//
// CON RỐI ĐƯỢC DỰNG NHƯ SAU (đã làm lại để bớt "rời rạc"):
//  - Thân / đầu / đoạn thẳng của tay chân: mỗi bộ phận là một khối cứng, "nướng" một lần thành canvas nhỏ (viền mịn).
//  - Chỗ UỐN (khuỷu, đầu gối, háng): vùng quanh khớp được cắt thành rất nhiều lát mỏng (~1.5px texture). Mỗi lát xoay quanh
//    khớp một góc nội suy mượt (smoothstep) giữa hai xương -> cong liền mạch, viền không còn răng cưa / bậc thang.
//  - Háng: đáy thân dừng ĐÚNG ngang gấu áo (không ăn xuống chân); đùi nối vào bằng vùng chuyển bắt đầu từ trọng số 0.
//  - Vai: tay xoay quanh tâm đầu tròn của tay (poseSolver.restShoulderPivot) nên đầu tay đứng yên như được ghim đinh.
//  - Khi mờ dần / nháy trắng, cả con rối được vẽ vào một lớp riêng rồi mới trộn.
import { STAGE, LAYOUT, PHYSICS } from "./puppetConfig.js";
import { applyXf, pivotXf, restShoulderPivot } from "./poseSolver.js";
import { IS_PHONE } from "../device.js";

/** Các núm chỉnh. Muốn đổi cảm giác con rối chỉ cần sửa ở đây. */
export const PUPPET_FIT = {
  SOFT_BEND: true,    // false = quay về kiểu khớp cứng (mỗi đoạn xương một khối)
  SLICE: 1.5,         // bề dày mỗi lát (px texture). Nhỏ hơn = mịn hơn nhưng nhiều lệnh vẽ hơn (1.0 ~ 2.0 là hợp lý)
  BLEND: 1.6,         // chiều dài vùng uốn mỗi bên khuỷu / gối = BLEND x nửa bề rộng chi (tăng = kiểu "ống cao su")
  HIP_BLEND: 0,       // 0 = đùi bám THẲNG vào gấu áo (mép ngoài đi thẳng xuống). >0 = vùng chuyển mềm (HIP_BLEND x nửa bề rộng đùi), nhưng mép ngoài sẽ lõm nhẹ
  SHOULDER_BLEND: 1.6, // kiểu vai "blend" (tay áo liền thân): chiều dài vùng chuyển thân -> tay = SHOULDER_BLEND x nửa bề rộng tay
  HIP_TUCK: 1.1,      // (khi HIP_BLEND = 0) đầu đùi được nối dài lên dưới gấu áo HIP_TUCK x nửa bề rộng đùi để lấp khe hở khi đùi xoè ra
  HIP_TO_CROTCH: 0.04, // khoảng cách từ khớp háng tới đáy gấu áo / chỗ chia chân (x chiều cao nhân vật) – khớp với rigEngine
  PAD_ARM: 1.12,      // nới bề rộng vùng cắt của tay so với bề rộng đo được (để không cắt mất nét viền)
  PAD_LEG: 1.12,      // như trên cho chân
  OVERLAP: 1.5,       // px texture – các mảnh chồng lên nhau tối thiểu bấy nhiêu để không hở
  EDGE: 2,            // px texture đệm quanh mỗi mảnh khi nướng
};

/* ------------------------------------------------------------------ */
/*  Hình học: mỗi shape = { path: Path2D, box: [x0,y0,x1,y1] }          */
/* ------------------------------------------------------------------ */
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (v) => { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x / d, y: v.y / d }; };
const at = (o, u, t) => ({ x: o.x + u.x * t, y: o.y + u.y * t });
const ext = (a, b, k) => ({ x: b.x + (b.x - a.x) * k, y: b.y + (b.y - a.y) * k });
const shape = (path, box) => ({ path, box });
const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

function capsule(a, b, ra, rb) {
  const p = new Path2D();
  const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang), ny = Math.cos(ang);
  p.moveTo(a.x + nx * ra, a.y + ny * ra);
  p.lineTo(b.x + nx * rb, b.y + ny * rb);
  p.arc(b.x, b.y, rb, ang + Math.PI / 2, ang - Math.PI / 2, true);
  p.lineTo(a.x - nx * ra, a.y - ny * ra);
  p.arc(a.x, a.y, ra, ang - Math.PI / 2, ang + Math.PI / 2, true);
  p.closePath();
  return shape(p, [Math.min(a.x - ra, b.x - rb), Math.min(a.y - ra, b.y - rb), Math.max(a.x + ra, b.x + rb), Math.max(a.y + ra, b.y + rb)]);
}
const circle = (c, r) => { const p = new Path2D(); p.arc(c.x, c.y, r, 0, Math.PI * 2); return shape(p, [c.x - r, c.y - r, c.x + r, c.y + r]); };
const rect = (x, y, w, h) => { const p = new Path2D(); p.rect(x, y, w, h); return shape(p, [x, y, x + w, y + h]); };

/** Thanh chữ nhật dọc theo đoạn P0->P1, nửa bề rộng hw, kéo dài thêm ov0 phía P0 và ov1 phía P1 */
function bar(P0, P1, hw, ov0 = 0, ov1 = 0) {
  const u = unit(sub(P1, P0)), n = { x: -u.y, y: u.x };
  const A = at(P0, u, -ov0), B = at(P1, u, ov1);
  const c = [
    { x: A.x + n.x * hw, y: A.y + n.y * hw }, { x: B.x + n.x * hw, y: B.y + n.y * hw },
    { x: B.x - n.x * hw, y: B.y - n.y * hw }, { x: A.x - n.x * hw, y: A.y - n.y * hw },
  ];
  const p = new Path2D(); p.moveTo(c[0].x, c[0].y); for (let i = 1; i < 4; i++) p.lineTo(c[i].x, c[i].y); p.closePath();
  const xs = c.map((q) => q.x), ys = c.map((q) => q.y);
  return shape(p, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
}

/* ------------------------------------------------------------------ */
/*  Uốn mềm                                                            */
/* ------------------------------------------------------------------ */
/** mA: ma trận xương trên, mB: xương dưới, pivot: khớp (toạ độ texture lúc nghỉ), w: 0 = như xương trên, 1 = như xương dưới */
export function blendXf(mA, mB, pivot, w) {
  const thA = Math.atan2(mA.b, mA.a), thB = Math.atan2(mB.b, mB.a);
  let d = thB - thA;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const s = Math.hypot(mA.a, mA.b) * (1 - w) + Math.hypot(mB.a, mB.b) * w;
  return pivotXf(pivot, applyXf(mB, pivot), thA + d * w, s);   // khớp luôn nằm đúng vị trí khuỷu / đầu gối hiện tại
}

/**
 * "Dải" uốn mềm: một dải hình chữ nhật dọc theo xương, được cắt thành nhiều lát mỏng.
 * Lát ở vị trí lx (dọc dải) có trọng số w = smoothstep(t0 + (t1-t0) * lx/len) giữa xương a và xương b, xoay quanh pivot.
 */
function ribbon(F, { O, u, hw, len, a, b, pivot, t0, t1 }) {
  return { ribbon: true, O, u, n: { x: -u.y, y: u.x }, hw, len, a, b, pivot, t0, t1, count: Math.max(2, Math.ceil(len / F.SLICE)) };
}

/** Duyệt các lát của dải trong tư thế hiện tại; cb(m, x0, x1) với m = ma trận (rest -> sân khấu) của lát, [x0,x1] = đoạn dọc dải */
export function forEachSlice(rb, xf, cb) {
  const mA = xf[rb.a], mB = xf[rb.b];
  const thA = Math.atan2(mA.b, mA.a);
  let dTh = Math.atan2(mB.b, mB.a) - thA;
  while (dTh > Math.PI) dTh -= 2 * Math.PI;
  while (dTh < -Math.PI) dTh += 2 * Math.PI;
  const sA = Math.hypot(mA.a, mA.b), sB = Math.hypot(mB.a, mB.b), cur = applyXf(mB, rb.pivot), p = rb.pivot;
  const sw = rb.len / rb.count;
  // chỗ gập càng gấp thì mép ngoài càng "toác" giữa hai lát kề nhau -> cho các lát chồng nhau nhiều hơn (tỉ lệ với góc gập mỗi lát)
  const stepAng = Math.abs(dTh) * 1.5 * Math.abs(rb.t1 - rb.t0) * sw / rb.len, ov = Math.min(6, 0.6 + 1.6 * rb.hw * stepAng);
  for (let i = 0; i < rb.count; i++) {
    const lx0 = i * sw, lx1 = lx0 + sw;
    const w = smooth01(rb.t0 + (rb.t1 - rb.t0) * ((lx0 + lx1) / 2 / rb.len));
    const th = thA + dTh * w, s = sA * (1 - w) + sB * w, a = Math.cos(th) * s, b = Math.sin(th) * s;
    cb({ a, b, c: -b, d: a, e: cur.x - (a * p.x - b * p.y), f: cur.y - (b * p.x + a * p.y) }, Math.max(0, lx0 - ov), Math.min(rb.len, lx1 + ov));
  }
}

/**
 * Một chi hai đoạn: S (khớp gốc: vai / hông) -> M (khuỷu / gối) -> E (cổ tay / mắt cá).
 * root (chỉ chân): khoá xương mà đoạn gốc phải chuyển dần từ đó sang ("torso"); drop: khoảng cách từ khớp tới nơi chân bắt đầu lộ ra.
 */
function limbParts(F, { S, M, E, hwA, hwB, keyA, keyB, tail, root = null, rootZone = 0, tuck = false, drop = 0, rootCap = false }) {
  const dA = unit(sub(M, S)), dB = unit(sub(E, M));
  const lenA = dist(S, M), lenB = dist(M, E);
  const out = [];
  const zr0 = root ? Math.min(rootZone, 0.3 * lenA) : 0;
  const z = Math.min(F.BLEND * Math.max(hwA, hwB), 0.42 * Math.min(lenA - drop - zr0, lenB));
  if (!F.SOFT_BEND || z < 3) {                             // kiểu khớp cứng (dự phòng)
    out.push({ xf: keyA, shapes: [capsule(S, M, hwA, hwB)] });
    out.push({ xf: keyB, shapes: [capsule(M, E, hwB, hwB), ...tail] });
    return out;
  }
  const ov = Math.max(F.OVERLAP, 1);
  const zr = root && zr0 > 2 ? zr0 : 0;                      // 0 = đùi bám thẳng vào gấu áo, không có vùng chuyển
  // --- khối cứng: đoạn thẳng của xương trên (sau vùng háng, trước vùng gối) và của xương dưới ---
  // Khi không có vùng chuyển: đoạn đùi bắt đầu NGAY DƯỚI nét viền gấu áo (bỏ qua nét viền để nó không xoay theo chân),
  // và được nối dài lên dưới gấu áo bằng cách kéo dãn hàng pixel ruột chân ngay dưới gấu áo (xem drawExtrude).
  const GAP = 1.5;
  const startA = root ? at(S, dA, drop + (zr || (tuck ? GAP : 0))) : S;
  if (root && tuck && !zr && F.HIP_TUCK > 0) out.push({ extrude: true, xf: keyA, O: startA, u: dA, n: { x: -dA.y, y: dA.x }, hw: hwA, ext: F.HIP_TUCK * hwA, len: 2 });
  out.push({ xf: keyA, shapes: [bar(startA, at(M, dA, -z), hwA, root && zr ? ov : 0, ov), ...(rootCap ? [circle(S, hwA / F.PAD_ARM * 0.97)] : [])] });
  out.push({ xf: keyB, shapes: [bar(at(M, dB, z), E, hwB, ov, 0), circle(E, hwB), ...tail] });
  // --- háng: dải chuyển từ thân sang đùi, bắt đầu đúng ở gấu áo với trọng số 0 (liền mạch, không bậc, không hở) ---
  if (zr) {
    const o0 = 1, o1 = ov;
    out.push(ribbon(F, { O: at(S, dA, drop - o0), u: dA, hw: hwA, len: zr + o0 + o1, a: root, b: keyA, pivot: S, t0: -o0 / zr, t1: (zr + o1) / zr }));
  }
  // --- khuỷu / gối: hai dải (trên & dưới khớp), trọng số trải đều theo smoothstep trên cả đoạn 2z ---
  const e0 = ov;
  out.push(ribbon(F, { O: at(M, dA, -z - e0), u: dA, hw: hwA, len: z + e0 + 1, a: keyA, b: keyB, pivot: M, t0: -e0 / (2 * z), t1: (z + 1) / (2 * z) }));
  out.push(ribbon(F, { O: at(M, dB, -1), u: dB, hw: hwB, len: 1 + z + e0, a: keyA, b: keyB, pivot: M, t0: 0.5 - 1 / (2 * z), t1: 0.5 + (z + e0) / (2 * z) }));
  return out;
}

/** Dựng danh sách bộ phận (vùng cắt ở tư thế nghỉ) – chỉ làm một lần cho mỗi rig */
export function buildParts(rig, F = PUPPET_FIT) {
  const J = rig.joints, W = rig.widths, b = rig.bounds, bottom = b.y + b.h;
  const armR = W.arm;
  // hai chân không được "ăn" sang nhau: bề rộng cắt không vượt quá nửa khoảng cách giữa hai chân
  const sep = Math.min(Math.abs(J.hipR.x - J.hipL.x), Math.abs(J.kneeR.x - J.kneeL.x), Math.abs(J.ankleR.x - J.ankleL.x)) / 2 * 0.96;
  const legHw = (w) => Math.min(w * F.PAD_LEG, Math.max(w * 0.95, sep));
  const armHw = armR * F.PAD_ARM;

  // Bàn chân = hình chữ nhật từ mắt cá tới đáy khung (ellipse cũ cắt mất 4 góc của đế giày).
  // Phía trong dừng ở giữa hai chân để không ăn sang giày bên kia; phía ngoài nới rộng cho mũi giày.
  const foot = (side) => {
    const a = J["ankle" + side], o = J[side === "R" ? "ankleL" : "ankleR"];
    const toward = Math.sign(o.x - a.x) || (side === "R" ? 1 : -1);
    const outer = W.shin * 3.2, inner = Math.max(W.shin * 1.3, Math.abs(o.x - a.x) / 2 - 1);
    const x0 = toward > 0 ? a.x - outer : a.x - inner, x1 = toward > 0 ? a.x + inner : a.x + outer;
    const top = a.y - W.shin * 0.5, bot = bottom + 4;
    return rect(x0, top, x1 - x0, Math.max(4, bot - top));
  };
  const hand = (w, e) => {
    const d = Math.hypot(w.x - e.x, w.y - e.y) || 1;
    return circle({ x: w.x + (w.x - e.x) / d * armR * 0.8, y: w.y + (w.y - e.y) / d * armR * 0.8 }, armR * 1.5);
  };
  const headW = W.head * 1.2;                         // đủ rộng cho đầu + tai nghe / sừng, không ăn vào vai
  const crotchDrop = F.HIP_TO_CROTCH * b.h;
  const torsoAxis = unit(sub(J.hip, J.neck));
  const pelvisHw = Math.max(W.torso * 1.08, Math.abs(J.hipL.x - J.hipR.x) / 2 + legHw(W.thigh));
  const leg = (side) => limbParts(F, {
    S: J["hip" + side], M: J["knee" + side], E: ext(J["knee" + side], J["ankle" + side], 0.2),
    hwA: legHw(Math.max(W.thigh, W.shin)), hwB: legHw(W.shin),
    keyA: "thigh" + side, keyB: "shin" + side, tail: [foot(side)], root: "torso", rootZone: F.HIP_BLEND * legHw(Math.max(W.thigh, W.shin)), tuck: true, drop: crotchDrop,
  });
  // Kiểu vai: "pin" (mặc định, giữ nguyên như con mèo): đầu tròn của tay xoay tại chỗ. "blend": tay áo liền khối với thân
  // -> không có đầu tròn riêng, đoạn đầu tay chuyển dần từ "xoay theo thân" sang "xoay theo tay" (không còn khối chữ nhật dính ở vai).
  const blendShoulder = rig.shoulderStyle === "blend";
  const arm = (side) => limbParts(F, {
    S: restShoulderPivot(rig, side), M: J["elbow" + side], E: J["wrist" + side],
    hwA: armHw, hwB: armHw,
    keyA: "upperArm" + side, keyB: "foreArm" + side, tail: [hand(J["wrist" + side], J["elbow" + side])],
    ...(blendShoulder ? { root: "torso", rootZone: F.SHOULDER_BLEND * armHw } : { rootCap: true }),
  });

  return [
    ...leg("R"), ...leg("L"),
    { xf: "torso", shapes: [
      // Đáy thân PHẲNG, dừng ĐÚNG ngang gấu áo (hông + HIP_TO_CROTCH x cao). Phần đầu chân không bị sao chép vào thân nữa.
      // Vai không còn vòng tròn riêng: đầu tròn của tay nằm trong khối tay và xoay tại chỗ.
      circle(J.neck, W.torso * 1.02),
      bar(J.neck, J.hip, W.torso * 1.06),
      bar(at(J.hip, torsoAxis, -W.torso * 0.4), at(J.hip, torsoAxis, crotchDrop), pelvisHw),
    ] },
    ...arm("R"), ...arm("L"),
    { xf: "head", shapes: [rect(J.head.x - headW, 0, headW * 2, J.neck.y + W.head * 0.18)] },
  ];
}

/* ------------------------------------------------------------------ */
/*  Nướng bộ phận thành canvas nhỏ                                      */
/* ------------------------------------------------------------------ */
function makeCanvas(w, h) {
  if (typeof document !== "undefined") { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

/** Khối cứng: mặt nạ = hợp các hình, nhân với texture */
function bake(part, texture, q, edge) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of part.shapes) { x0 = Math.min(x0, s.box[0]); y0 = Math.min(y0, s.box[1]); x1 = Math.max(x1, s.box[2]); y1 = Math.max(y1, s.box[3]); }
  if (!isFinite(x0)) return null;
  x0 = Math.floor(x0 - edge); y0 = Math.floor(y0 - edge); x1 = Math.ceil(x1 + edge); y1 = Math.ceil(y1 + edge);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const qq = Math.min(q, 2048 / Math.max(w, h));
  const cw = Math.max(1, Math.ceil(w * qq)), ch = Math.max(1, Math.ceil(h * qq));
  const c = makeCanvas(cw, ch), g = c.getContext("2d");
  g.setTransform(qq, 0, 0, qq, -x0 * qq, -y0 * qq);
  g.fillStyle = "#000";
  for (const s of part.shapes) g.fill(s.path);               // mặt nạ = hợp các hình
  g.globalCompositeOperation = "source-in";
  g.imageSmoothingQuality = "high";
  g.drawImage(texture, 0, 0);                                // chỉ giữ texture nằm trong mặt nạ
  return { c, x: x0, y: y0, w: cw / qq, h: ch / qq };
}

/** Dải uốn: "trải thẳng" vùng quanh xương ra một canvas nằm ngang (trục = trục x), để cắt lát bằng các hình chữ nhật thẳng */
function bakeRibbon(rb, texture, q) {
  const qq = Math.min(q, 2048 / Math.max(rb.len, 2 * rb.hw));
  const cw = Math.max(1, Math.ceil(rb.len * qq)), ch = Math.max(1, Math.ceil(2 * rb.hw * qq));
  const c = makeCanvas(cw, ch), g = c.getContext("2d");
  const { O, u, n, hw } = rb;
  g.setTransform(qq * u.x, qq * n.x, qq * u.y, qq * n.y, -qq * (u.x * O.x + u.y * O.y), qq * (hw - (n.x * O.x + n.y * O.y)));
  g.imageSmoothingQuality = "high";
  g.drawImage(texture, 0, 0);
  return { c, qq, ch };
}

export class PuppetSprite {
  /** texture: canvas đã làm sạch, rig: kết quả rigEngine */
  constructor(texture, rig, name = "Puppet") {
    this.texture = texture; this.rig = rig; this.name = name;
    this.scale = LAYOUT.PUPPET_H / rig.bounds.h;     // px sân khấu / px texture
    this.rebuild();
  }
  rebuild() {
    this.parts = buildParts(this.rig);               // các mảnh được nướng lười ở lần vẽ đầu tiên
    this.bakeQ = Math.min(2, Math.max(1, this.scale * 1.5));
    // vị trí hông & chân so với khung giới hạn (để đặt chân đứng đúng sàn)
    this.hipToFeet = (this.rig.bounds.y + this.rig.bounds.h - this.rig.joints.hip.y) * this.scale;
  }
}

function drawExtrude(ctx, ex, sprite, xf) {
  const k = ex.baked !== undefined ? ex.baked : (ex.baked = bakeRibbon(ex, sprite.texture, sprite.bakeQ));
  const M = xf[ex.xf], { u, n, O, hw } = ex, La = u.x, Lb = u.y, Lc = n.x, Ld = n.y, Le = O.x - n.x * hw, Lf = O.y - n.y * hw;
  ctx.save();
  ctx.transform(M.a * La + M.c * Lb, M.b * La + M.d * Lb, M.a * Lc + M.c * Ld, M.b * Lc + M.d * Ld, M.a * Le + M.c * Lf + M.e, M.b * Le + M.d * Lf + M.f);
  // kéo dãn 2px ruột chân thành một dải dài nằm phía TRÊN điểm bắt đầu (lx âm), chồng 0.5px lên đoạn đùi
  ctx.drawImage(k.c, 0, 0, k.c.width, k.ch, -ex.ext, 0, ex.ext + 0.5, k.ch / k.qq);
  ctx.restore();
}

function drawRibbon(ctx, rb, sprite, xf) {
  const k = rb.baked !== undefined ? rb.baked : (rb.baked = bakeRibbon(rb, sprite.texture, sprite.bakeQ));
  const { u, n, O, hw } = rb, La = u.x, Lb = u.y, Lc = n.x, Ld = n.y, Le = O.x - n.x * hw, Lf = O.y - n.y * hw;
  const dh = k.ch / k.qq;
  forEachSlice(rb, xf, (M, x0, x1) => {
    ctx.save();
    ctx.transform(M.a * La + M.c * Lb, M.b * La + M.d * Lb, M.a * Lc + M.c * Ld, M.b * Lc + M.d * Ld, M.a * Le + M.c * Lf + M.e, M.b * Le + M.d * Lf + M.f);
    ctx.drawImage(k.c, x0 * k.qq, 0, (x1 - x0) * k.qq, k.ch, x0, 0, x1 - x0, dh);
    ctx.restore();
  });
}

function drawParts(ctx, sprite, pose) {
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  for (const part of sprite.parts) {
    if (part.ribbon) { drawRibbon(ctx, part, sprite, pose.xf); continue; }
    if (part.extrude) { drawExtrude(ctx, part, sprite, pose.xf); continue; }
    const k = part.baked !== undefined ? part.baked : (part.baked = bake(part, sprite.texture, sprite.bakeQ, PUPPET_FIT.EDGE));
    if (!k) continue;
    const m = pose.xf[part.xf];
    ctx.save();
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(k.c, k.x, k.y, k.w, k.h);
    ctx.restore();
  }
}

let layer = null;                                    // lớp tạm dùng chung cho alpha / flash
export function drawPuppet(ctx, sprite, pose, { alpha = 1, flash = 0 } = {}) {
  if (alpha >= 0.999 && flash <= 0) { ctx.save(); drawParts(ctx, sprite, pose); ctx.restore(); return; }
  const cv = ctx.canvas;
  if (!layer || layer.width !== cv.width || layer.height !== cv.height) layer = makeCanvas(cv.width, cv.height);
  const g = layer.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, layer.width, layer.height);
  g.setTransform(ctx.getTransform());
  drawParts(g, sprite, pose);
  if (flash > 0) {                                   // nháy trắng đúng theo hình dáng con rối
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-atop"; g.fillStyle = `rgba(255,255,255,${flash})`;
    g.fillRect(0, 0, layer.width, layer.height);
    g.globalCompositeOperation = "source-over";
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(layer, 0, 0); ctx.restore();
}

/** Vẽ vợt / vũ khí / khiên theo frame từ poseSolver.equipmentFrame */
export function drawEquipment(ctx, img, spec, frame, glow = 0) {
  ctx.save();
  ctx.translate(frame.grip.x, frame.grip.y);
  ctx.rotate(frame.angle);
  ctx.scale(frame.k, frame.k);
  if (glow > 0) { ctx.shadowColor = "rgba(255,230,140,.95)"; ctx.shadowBlur = 28 * glow; }
  ctx.drawImage(img, -spec.grip[0], -spec.grip[1]);
  ctx.restore();
}
/* ------------------------------------------------------------------ */
/*  Bóng bàn tay + sợi dây                                             */
/* ------------------------------------------------------------------ */
const CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20]];
const PALM = [0, 1, 5, 9, 13, 17];
let hsCanvas = null;                       // canvas nhỏ dùng chung để "làm nhòe" bóng bàn tay (thay cho ctx.filter = blur)
const HS_SIZE = 640, HS_Q = 0.22;          // vùng 640x640 px sân khấu quanh bàn tay, vẽ ở 22% kích thước rồi phóng to -> tự nhòe

/** pts: 21 điểm {x,y} đã đổi sang toạ độ sân khấu; unit: độ dày nét (px) */
export function drawHandShadow(ctx, pts, unit, alpha = 1) {
  if (!hsCanvas) { hsCanvas = document.createElement("canvas"); hsCanvas.width = hsCanvas.height = Math.ceil(HS_SIZE * HS_Q); }
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  const bx = cx / pts.length - HS_SIZE / 2, by = cy / pts.length - HS_SIZE / 2;
  const g = hsCanvas.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, hsCanvas.width, hsCanvas.height);
  g.setTransform(HS_Q, 0, 0, HS_Q, -bx * HS_Q, -by * HS_Q);
  g.fillStyle = g.strokeStyle = "#4a2a14";
  g.lineCap = g.lineJoin = "round";
  g.beginPath(); PALM.forEach((i, n) => (n ? g.lineTo(pts[i].x, pts[i].y) : g.moveTo(pts[i].x, pts[i].y))); g.closePath(); g.fill();
  g.lineWidth = unit * 0.9; g.stroke();
  CHAINS.forEach((ch, fi) => {
    g.lineWidth = unit * (fi === 0 ? 0.62 : 0.5);
    g.beginPath(); ch.forEach((i, n) => (n ? g.lineTo(pts[i].x, pts[i].y) : g.moveTo(pts[i].x, pts[i].y))); g.stroke();
  });
  ctx.save();
  ctx.globalAlpha = 0.28 * alpha;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(hsCanvas, bx, by, HS_SIZE, HS_SIZE);
  ctx.restore();
}
/** Dây từ đầu ngón (bóng) tới khớp của con rối: [{from:{x,y}, to:{x,y}}] */
export function drawStrings(ctx, strings, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = 0.55 * alpha;
  ctx.strokeStyle = "#5b3516"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
  for (const s of strings) {
    const midY = (s.from.y + s.to.y) / 2, sag = Math.min(14, Math.abs(s.to.x - s.from.x) * 0.08);
    ctx.beginPath(); ctx.moveTo(s.from.x, s.from.y);
    ctx.quadraticCurveTo((s.from.x + s.to.x) / 2, midY + sag, s.to.x, s.to.y); ctx.stroke();
    ctx.fillStyle = "#7a4a1f"; ctx.beginPath(); ctx.arc(s.to.x, s.to.y, 3.2, 0, 6.283); ctx.fill();
  }
  ctx.restore();
}
/* ------------------------------------------------------------------ */
/*  Quả cầu                                                            */
/* ------------------------------------------------------------------ */
export function drawBall(ctx, ball, img) {
  const r = PHYSICS.BALL_R;
  // bóng đổ trên mặt bàn
  const overTable = ball.x > LAYOUT.TABLE_L && ball.x < LAYOUT.TABLE_R;
  const sy = overTable ? LAYOUT.TABLE_Y : LAYOUT.FLOOR_Y;
  const h = Math.max(0, sy - ball.y);
  ctx.save();
  ctx.globalAlpha = Math.max(0.08, 0.32 - h / 1400);
  ctx.fillStyle = "#3b2208";
  ctx.beginPath(); ctx.ellipse(ball.x, sy + 6, r * (1.2 - h / 1500), r * 0.34, 0, 0, 6.283); ctx.fill();
  ctx.restore();
  ctx.save();
  if (ball.glow) { ctx.shadowColor = "rgba(255,225,120,.95)"; ctx.shadowBlur = 40 * ball.glow; }
  ctx.translate(ball.x, ball.y); ctx.rotate(ball.spin || 0);
  const d = r * 2.3;
  if (img) ctx.drawImage(img, -d / 2, -d / 2, d, d);
  else { ctx.fillStyle = "#ffd34d"; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill(); }
  ctx.restore();
}
/* ------------------------------------------------------------------ */
/*  Sân khấu                                                           */
/* ------------------------------------------------------------------ */
/** Vũ khí đang BAY (đã rời tay): xoay quanh tâm thân vũ khí, mũi hướng theo angle (0 = mũi hướng lên). w = {x,y,angle,k,glow} */
export function drawThrownWeapon(ctx, img, spec, w) {
  if (!img || !spec) return;
  const mid = spec.tip ? [(spec.grip[0] + spec.tip[0]) / 2, (spec.grip[1] + spec.tip[1]) / 2] : spec.grip;
  ctx.save();
  ctx.translate(w.x, w.y); ctx.rotate(w.angle); ctx.scale(w.k, w.k);
  if (w.glow) { ctx.shadowColor = "rgba(255,236,170,0.95)"; ctx.shadowBlur = (26 * w.glow) / Math.max(0.2, w.k); }
  ctx.drawImage(img, -mid[0], -mid[1]);
  ctx.restore();
}
/** Vệt sáng sau vũ khí đang bay */
export function drawWeaponTrail(ctx, trail, k = 0.55, alpha = 1) {
  if (!trail || trail.length < 2) return;
  ctx.save(); ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    const t = i / trail.length;
    ctx.strokeStyle = `rgba(255,246,206,${0.5 * t * t * alpha})`; ctx.lineWidth = 2 + 20 * t * k;
    ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
  }
  ctx.restore();
}
export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.bg = null;
    this.s = 1; this.ox = 0; this.oy = 0;
    this._dirty = true;                              // chỉ đo lại kích thước canvas khi nó thật sự đổi (getBoundingClientRect mỗi khung = ép layout)
    this._poll = typeof ResizeObserver === "undefined";
    if (!this._poll) new ResizeObserver(() => { this._dirty = true; }).observe(canvas);
    window.addEventListener("resize", () => { this._dirty = true; });
    this.resize(); this._dirty = false;
  }
  async loadBackground(url = STAGE.BG_URL) {
    try {
      this.bg = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    } catch { this.bg = null; }
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = IS_PHONE ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    // "cover": phủ kín khung, cắt phần thừa
    this.s = Math.max(w / STAGE.W, h / STAGE.H);
    this.ox = (w - STAGE.W * this.s) / 2; this.oy = (h - STAGE.H * this.s) / 2;
  }
  /** pixel màn hình -> toạ độ sân khấu */
  toStage(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(), dpr = this.canvas.width / r.width;
    return { x: ((clientX - r.left) * dpr - this.ox) / this.s, y: ((clientY - r.top) * dpr - this.oy) / this.s };
  }
  _drawBackground(ctx, dim) {
    if (this.bg) ctx.drawImage(this.bg, 0, 0, STAGE.W, STAGE.H);
    else {
      const g = ctx.createLinearGradient(0, 0, 0, STAGE.H);
      g.addColorStop(0, "#cdbbe6"); g.addColorStop(0.55, "#f7e4c4"); g.addColorStop(1, "#d9a86a");
      ctx.fillStyle = g; ctx.fillRect(0, 0, STAGE.W, STAGE.H);
      ctx.fillStyle = "#b27a3e"; ctx.fillRect(LAYOUT.TABLE_L, LAYOUT.TABLE_Y, LAYOUT.TABLE_R - LAYOUT.TABLE_L, 34);
      ctx.fillStyle = "#8a5a2c"; ctx.fillRect(LAYOUT.NET_X - 9, LAYOUT.NET_TOP, 18, LAYOUT.TABLE_Y - LAYOUT.NET_TOP);
    }
    if (dim > 0) { ctx.fillStyle = `rgba(40,16,50,${dim})`; ctx.fillRect(0, 0, STAGE.W, STAGE.H); }
  }
  /**
   * scene = {
   *   dim, shake:{x,y}, hand:{pts,unit,alpha}|null, strings:[],
   *   puppets:[{sprite,pose,alpha,flash, equip:[{img,spec,frame,glow}]}] (vẽ theo thứ tự),
   *   ball:{...}, ballImg, fx:Effects, overlayGlow
   * }
   */
  render(scene) {
    if (this._dirty || this._poll) { this._dirty = false; this.resize(); }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const sh = scene.shake || { x: 0, y: 0 };
    ctx.setTransform(this.s, 0, 0, this.s, this.ox + sh.x * this.s, this.oy + sh.y * this.s);
    this._drawBackground(ctx, scene.dim || 0);
    if (scene.hand) drawHandShadow(ctx, scene.hand.pts, scene.hand.unit, scene.hand.alpha ?? 1);
    if (scene.strings?.length) drawStrings(ctx, scene.strings, scene.hand?.alpha ?? 1);
    // bóng đổ dưới chân: nằm đúng dưới đế giày (p.floorY = độ sâu hiện tại trên mặt sàn), co theo phối cảnh (p.k) và nhạt / nhỏ dần khi con rối rời mặt đất (p.lift)
    for (const p of scene.puppets || []) {
      const j = p.pose.joints, k = p.k ?? 1, fy = (p.floorY ?? LAYOUT.STAND_Y) + 1;
      const lift = Math.min(1, Math.max(0, (p.lift || 0) / 300)), a = (p.alpha ?? 1) * (1 - 0.55 * lift), sc = 1 - 0.3 * lift;
      const rx = 78 * k * sc, ry = 15 * k * sc, cx = j.hip.x;
      ctx.save();
      ctx.translate(cx, fy); ctx.scale(1, ry / rx);                 // vòng tròn -> elip dẹt (mặt sàn nhìn nghiêng)
      const g = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
      g.addColorStop(0, `rgba(44,22,6,${0.40 * a})`); g.addColorStop(0.5, `rgba(44,22,6,${0.22 * a})`); g.addColorStop(1, "rgba(44,22,6,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.283); ctx.fill();
      ctx.restore();
      // bóng tiếp xúc đậm ngay dưới hai bàn chân
      const spread = Math.abs(j.ankleR.x - j.ankleL.x) / 2 + 34 * k * sc;
      ctx.save(); ctx.globalAlpha = 0.30 * a; ctx.fillStyle = "#2c1606";
      ctx.beginPath(); ctx.ellipse(cx, fy, spread, 6.5 * k * sc, 0, 0, 6.283); ctx.fill(); ctx.restore();
    }
    for (const p of scene.puppets || []) {
      drawPuppet(ctx, p.sprite, p.pose, { alpha: p.alpha ?? 1, flash: p.flash || 0 });
      for (const e of p.equip || []) drawEquipment(ctx, e.img, e.spec, e.frame, e.glow || 0);
    }
    if (scene.ball && scene.ball.visible !== false) drawBall(ctx, scene.ball, scene.ballImg);
    if (scene.thrown) { drawWeaponTrail(ctx, scene.thrown.trail, scene.thrown.k); drawThrownWeapon(ctx, scene.thrown.img, scene.thrown.spec, scene.thrown); }   // vũ khí đang bay (đã rời tay)
    scene.fx?.draw(ctx);
    if (scene.overlayGlow) {
      const g = ctx.createRadialGradient(STAGE.W / 2, STAGE.H * 0.5, 60, STAGE.W / 2, STAGE.H * 0.5, STAGE.W * 0.6);
      g.addColorStop(0, `rgba(255,236,170,${0.18 * scene.overlayGlow})`); g.addColorStop(1, "rgba(255,236,170,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, STAGE.W, STAGE.H);
    }
  }
}