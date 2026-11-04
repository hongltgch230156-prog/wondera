// frontend/src/components/puppet/puppetRenderer.js
// RENDERER: vẽ sân khấu 2.5D lên canvas – nền, con rối (từng bộ phận xoay quanh khớp), vợt / vũ khí,
// quả cầu, bóng bàn tay hắt lên phông + sợi dây, và hiệu ứng.
import { STAGE, LAYOUT, PHYSICS } from "./puppetConfig.js";

/* ------------------------------------------------------------------ */
/*  Con rối: chia texture thành các bộ phận theo rig                   */
/* ------------------------------------------------------------------ */
function capsule(a, b, ra, rb) {
  const p = new Path2D();
  const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang), ny = Math.cos(ang);
  p.moveTo(a.x + nx * ra, a.y + ny * ra);
  p.lineTo(b.x + nx * rb, b.y + ny * rb);
  p.arc(b.x, b.y, rb, ang + Math.PI / 2, ang - Math.PI / 2, true);
  p.lineTo(a.x - nx * ra, a.y - ny * ra);
  p.arc(a.x, a.y, ra, ang - Math.PI / 2, ang + Math.PI / 2, true);
  p.closePath();
  return p;
}
const circle = (c, r) => { const p = new Path2D(); p.arc(c.x, c.y, r, 0, Math.PI * 2); return p; };
const rect = (x, y, w, h) => { const p = new Path2D(); p.rect(x, y, w, h); return p; };
const ellipse = (x, y, rx, ry) => { const p = new Path2D(); p.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); return p; };
const ext = (a, b, k) => ({ x: b.x + (b.x - a.x) * k, y: b.y + (b.y - a.y) * k });

/** Dựng danh sách bộ phận (vùng cắt ở tư thế nghỉ) – chỉ làm một lần cho mỗi rig */
export function buildParts(rig) {
  const J = rig.joints, W = rig.widths, b = rig.bounds, bottom = b.y + b.h;
  const armR = W.arm, legGap = Math.abs(J.ankleR.x - J.ankleL.x) / 2 - 1;
  const foot = (a) => {
    const rx = Math.max(W.shin, Math.min(W.shin * 1.9, legGap)), cy = (a.y + bottom) / 2;
    return ellipse(a.x, cy, rx, Math.max(W.shin * 0.7, (bottom - a.y) / 2 + 2));
  };
  const hand = (w, e) => {
    const d = Math.hypot(w.x - e.x, w.y - e.y) || 1;
    return circle({ x: w.x + (w.x - e.x) / d * armR * 0.8, y: w.y + (w.y - e.y) / d * armR * 0.8 }, armR * 1.5);
  };
  const headW = W.head * 1.9;
  return [
    { xf: "thighR", shapes: [capsule(J.hipR, J.kneeR, W.thigh * 1.05, W.shin * 1.05)] },
    { xf: "thighL", shapes: [capsule(J.hipL, J.kneeL, W.thigh * 1.05, W.shin * 1.05)] },
    { xf: "shinR", shapes: [capsule(J.kneeR, ext(J.kneeR, J.ankleR, 0.2), W.shin * 1.05, W.shin), foot(J.ankleR)] },
    { xf: "shinL", shapes: [capsule(J.kneeL, ext(J.kneeL, J.ankleL, 0.2), W.shin * 1.05, W.shin), foot(J.ankleL)] },
    { xf: "torso", shapes: [
      capsule(J.neck, J.hip, W.torso * 1.02, W.torso * 1.08),
      circle(J.shoulderR, armR * 1.2), circle(J.shoulderL, armR * 1.2),
      capsule(J.hipR, J.hipL, W.thigh * 1.15, W.thigh * 1.15),
    ] },
    { xf: "upperArmR", shapes: [capsule(J.shoulderR, J.elbowR, armR * 1.08, armR)] },
    { xf: "foreArmR", shapes: [capsule(J.elbowR, J.wristR, armR, armR), hand(J.wristR, J.elbowR)] },
    { xf: "upperArmL", shapes: [capsule(J.shoulderL, J.elbowL, armR * 1.08, armR)] },
    { xf: "foreArmL", shapes: [capsule(J.elbowL, J.wristL, armR, armR), hand(J.wristL, J.elbowL)] },
    { xf: "head", shapes: [rect(J.head.x - headW, 0, headW * 2, J.neck.y + W.head * 0.18)] },
  ];
}

export class PuppetSprite {
  /** texture: canvas đã làm sạch, rig: kết quả rigEngine */
  constructor(texture, rig, name = "Puppet") {
    this.texture = texture; this.rig = rig; this.name = name;
    this.parts = buildParts(rig);
    this.scale = LAYOUT.PUPPET_H / rig.bounds.h;     // px sân khấu / px texture
    // vị trí hông & chân so với khung giới hạn (để đặt chân đứng đúng sàn)
    this.hipToFeet = (rig.bounds.y + rig.bounds.h - rig.joints.hip.y) * this.scale;
  }
  rebuild() { this.parts = buildParts(this.rig); this.hipToFeet = (this.rig.bounds.y + this.rig.bounds.h - this.rig.joints.hip.y) * this.scale; }
}

export function drawPuppet(ctx, sprite, pose, { alpha = 1, flash = 0 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const part of sprite.parts) {
    const m = pose.xf[part.xf];
    for (const shape of part.shapes) {
      ctx.save();
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.clip(shape);
      ctx.drawImage(sprite.texture, 0, 0);
      if (flash > 0) { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fill(shape); }
      ctx.restore();
    }
  }
  ctx.restore();
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

/** pts: 21 điểm {x,y} đã đổi sang toạ độ sân khấu; unit: độ dày nét (px) */
export function drawHandShadow(ctx, pts, unit, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = 0.26 * alpha;
  ctx.fillStyle = ctx.strokeStyle = "#4a2a14";
  ctx.lineCap = ctx.lineJoin = "round";
  try { ctx.filter = "blur(3px)"; } catch { /* trình duyệt không hỗ trợ filter */ }
  ctx.beginPath(); PALM.forEach((i, n) => (n ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y))); ctx.closePath(); ctx.fill();
  ctx.lineWidth = unit * 0.9; ctx.stroke();
  CHAINS.forEach((ch, fi) => {
    ctx.lineWidth = unit * (fi === 0 ? 0.62 : 0.5);
    ctx.beginPath(); ch.forEach((i, n) => (n ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y))); ctx.stroke();
  });
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
export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.bg = null;
    this.s = 1; this.ox = 0; this.oy = 0;
    this.resize();
  }
  async loadBackground(url = STAGE.BG_URL) {
    try {
      this.bg = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    } catch { this.bg = null; }
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
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
    this.resize();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const sh = scene.shake || { x: 0, y: 0 };
    ctx.setTransform(this.s, 0, 0, this.s, this.ox + sh.x * this.s, this.oy + sh.y * this.s);
    this._drawBackground(ctx, scene.dim || 0);
    if (scene.hand) drawHandShadow(ctx, scene.hand.pts, scene.hand.unit, scene.hand.alpha ?? 1);
    if (scene.strings?.length) drawStrings(ctx, scene.strings, scene.hand?.alpha ?? 1);
    // bóng đổ dưới chân
    for (const p of scene.puppets || []) {
      const fy = LAYOUT.FLOOR_Y + 8;
      ctx.save(); ctx.globalAlpha = 0.22 * (p.alpha ?? 1); ctx.fillStyle = "#3b2208";
      ctx.beginPath(); ctx.ellipse(p.pose.joints.hip.x, fy, 70 * Math.max(0.5, 1 - Math.max(0, fy - 150 - p.pose.joints.ankleR.y) / 600), 14, 0, 0, 6.283); ctx.fill(); ctx.restore();
    }
    for (const p of scene.puppets || []) {
      drawPuppet(ctx, p.sprite, p.pose, { alpha: p.alpha ?? 1, flash: p.flash || 0 });
      for (const e of p.equip || []) drawEquipment(ctx, e.img, e.spec, e.frame, e.glow || 0);
    }
    if (scene.ball && scene.ball.visible !== false) drawBall(ctx, scene.ball, scene.ballImg);
    scene.fx?.draw(ctx);
    if (scene.overlayGlow) {
      const g = ctx.createRadialGradient(STAGE.W / 2, STAGE.H * 0.5, 60, STAGE.W / 2, STAGE.H * 0.5, STAGE.W * 0.6);
      g.addColorStop(0, `rgba(255,236,170,${0.18 * scene.overlayGlow})`); g.addColorStop(1, "rgba(255,236,170,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, STAGE.W, STAGE.H);
    }
  }
}