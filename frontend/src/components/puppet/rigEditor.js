// frontend/src/components/puppet/rigEditor.js
// CHỈNH TAY điểm neo: hiện texture + các chấm khớp, kéo thả để sửa (có chế độ đối xứng trái/phải, phím mũi tên để nhích từng px).
import { JOINT_NAMES } from "./puppetConfig.js";
import { moveJoint } from "./rigEngine.js";

const COLORS = { head: "#3b82f6", neck: "#f59e0b", hip: "#eab308", shoulder: "#ef4444", elbow: "#f97316", wrist: "#ec4899", hipJ: "#a855f7", knee: "#8b5cf6", ankle: "#6366f1" };
const colorOf = (n) => (n === "head" ? COLORS.head : n === "neck" ? COLORS.neck : n === "hip" ? COLORS.hip : n.startsWith("shoulder") ? COLORS.shoulder : n.startsWith("elbow") ? COLORS.elbow : n.startsWith("wrist") ? COLORS.wrist : n.startsWith("hip") ? COLORS.hipJ : n.startsWith("knee") ? COLORS.knee : COLORS.ankle);
const LABEL = { head: "Head", neck: "Neck", hip: "Hip", shoulderR: "Shoulder (R)", shoulderL: "Shoulder (L)", elbowR: "Elbow (R)", elbowL: "Elbow (L)", wristR: "Wrist (R)", wristL: "Wrist (L)", hipR: "Hip (R)", hipL: "Hip (L)", kneeR: "Knee (R)", kneeL: "Knee (L)", ankleR: "Ankle (R)", ankleL: "Ankle (L)" };
const BONES = [["neck", "hip"], ["shoulderR", "shoulderL"], ["shoulderR", "elbowR"], ["elbowR", "wristR"], ["shoulderL", "elbowL"], ["elbowL", "wristL"], ["hipR", "hipL"], ["hipR", "kneeR"], ["kneeR", "ankleR"], ["hipL", "kneeL"], ["kneeL", "ankleL"], ["head", "neck"]];

export class RigEditor {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d");
    this.onChange = onChange || (() => {});
    this.tex = null; this.rig = null; this.mirror = true;
    this.drag = null; this.hover = null; this.sel = null;
    this.k = 1; this.ox = 0; this.oy = 0;
    canvas.tabIndex = 0;
    this._d = (e) => this._down(e); this._m = (e) => this._move(e); this._u = (e) => this._up(e); this._k = (e) => this._key(e);
    canvas.addEventListener("pointerdown", this._d); canvas.addEventListener("pointermove", this._m);
    canvas.addEventListener("pointerup", this._u); canvas.addEventListener("pointercancel", this._u); canvas.addEventListener("keydown", this._k);
    this._ro = new ResizeObserver(() => { this.fit(); this.draw(); }); this._ro.observe(canvas);
  }
  destroy() {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this._d); c.removeEventListener("pointermove", this._m);
    c.removeEventListener("pointerup", this._u); c.removeEventListener("pointercancel", this._u); c.removeEventListener("keydown", this._k);
    this._ro.disconnect();
  }
  load(texture, rig) { this.tex = texture; this.rig = rig; this.sel = null; this.fit(); this.draw(); }
  setMirror(v) { this.mirror = !!v; }

  fit() {
    const c = this.canvas, r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.dpr = dpr;
    if (!this.tex) return;
    const pad = 18 * dpr;
    this.k = Math.min((w - pad * 2) / this.tex.width, (h - pad * 2) / this.tex.height);
    this.ox = (w - this.tex.width * this.k) / 2; this.oy = (h - this.tex.height * this.k) / 2;
  }
  _pt(n) { const j = this.rig.joints[n]; return { x: this.ox + j.x * this.k, y: this.oy + j.y * this.k }; }
  _toTex(e) {
    const r = this.canvas.getBoundingClientRect(), s = this.canvas.width / r.width;
    return { x: ((e.clientX - r.left) * s - this.ox) / this.k, y: ((e.clientY - r.top) * s - this.oy) / this.k };
  }
  _pick(e) {
    const r = this.canvas.getBoundingClientRect(), s = this.canvas.width / r.width;
    const mx = (e.clientX - r.left) * s, my = (e.clientY - r.top) * s;
    let best = null, bd = (16 * this.dpr) ** 2;
    for (const n of JOINT_NAMES) { const p = this._pt(n), d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }
  _down(e) {
    if (!this.rig) return;
    const n = this._pick(e); if (!n) return;
    this.drag = n; this.sel = n; this.canvas.setPointerCapture(e.pointerId); this.canvas.focus(); this.draw();
  }
  _move(e) {
    if (!this.rig) return;
    if (this.drag) { const p = this._toTex(e); moveJoint(this.rig, this.drag, p.x, p.y, this.mirror); this.onChange(this.rig); this.draw(); return; }
    const h = this._pick(e); if (h !== this.hover) { this.hover = h; this.canvas.style.cursor = h ? "grab" : "default"; this.draw(); }
  }
  _up() { this.drag = null; }
  _key(e) {
    if (!this.rig || !this.sel) return;
    const step = e.shiftKey ? 5 : 1, j = this.rig.joints[this.sel];
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault(); moveJoint(this.rig, this.sel, j.x + d[0], j.y + d[1], this.mirror); this.onChange(this.rig); this.draw();
  }

  draw() {
    const g = this.ctx, c = this.canvas;
    g.clearRect(0, 0, c.width, c.height);
    if (!this.tex || !this.rig) return;
    // nền caro để thấy vùng trong suốt
    const s = 14 * this.dpr;
    for (let y = 0; y < c.height; y += s) for (let x = 0; x < c.width; x += s) { g.fillStyle = ((x / s + y / s) & 1) ? "#efe6f5" : "#fbf7fd"; g.fillRect(x, y, s, s); }
    g.drawImage(this.tex, this.ox, this.oy, this.tex.width * this.k, this.tex.height * this.k);
    g.lineWidth = 2.2 * this.dpr; g.strokeStyle = "rgba(34,197,94,.9)"; g.lineCap = "round";
    for (const [a, b] of BONES) { const A = this._pt(a), B = this._pt(b); g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke(); }
    for (const n of JOINT_NAMES) {
      const p = this._pt(n), active = n === this.sel || n === this.hover;
      g.beginPath(); g.arc(p.x, p.y, (active ? 8.5 : 6.5) * this.dpr, 0, 6.283);
      g.fillStyle = colorOf(n); g.fill(); g.lineWidth = 2 * this.dpr; g.strokeStyle = "#fff"; g.stroke();
    }
    const n = this.hover || this.sel;
    if (n) {
      const p = this._pt(n); g.font = `800 ${12 * this.dpr}px Nunito, sans-serif`;
      const w = g.measureText(LABEL[n]).width + 12 * this.dpr, x = Math.min(c.width - w - 4, Math.max(4, p.x - w / 2)), y = p.y - 26 * this.dpr;
      g.fillStyle = "rgba(60,40,110,.92)"; g.beginPath(); g.roundRect(x, y - 13 * this.dpr, w, 20 * this.dpr, 8 * this.dpr); g.fill();
      g.fillStyle = "#fff"; g.textAlign = "center"; g.fillText(LABEL[n], x + w / 2, y + 2 * this.dpr);
    }
  }
}