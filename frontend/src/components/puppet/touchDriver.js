// frontend/src/components/puppet/touchDriver.js
// ĐIỀU KHIỂN CẢM ỨNG cho Puppet Stage – CHỈ dùng trên điện thoại (IS_PHONE).
//  - TouchDriver: giả lập "bàn tay" từ cần trượt / vùng kéo trên màn hình, trả về đúng dữ liệu game vẫn đọc từ HandDriver.
//  - mountPhoneUI: dựng giao diện (cần trượt, vùng vợt, 3 nút ném, ngăn kéo chọn item) và ẩn khung webcam.
import { HandDriver } from "./handDriver.js";
import { FINGERS, LAYOUT, TRACKING, RACKET_FINGER, userWalkX } from "./puppetConfig.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PALM_IDX = [0, 5, 9, 13, 17];
// Tư thế nghỉ của từng ngón – KHỚP với V0 trong puppetStage.js
const REST = {
  thumb: { x: -1.1, y: -0.7 }, index: { x: -0.5, y: -2.3 }, middle: { x: 0, y: -2.5 },
  ring: { x: 0.5, y: -2.2 }, pinky: { x: 1.0, y: -1.7 },
};
const MOVE_SPEED = { x: 0.9, y: 0.75 };   // tốc độ đi khi gạt hết cần (đơn vị khung hình / giây) – chỉnh ở đây nếu thấy nhanh/chậm
const AIM_REACH = 1.15;                    // kéo hết vùng vợt thì đầu ngón cái lệch bao nhiêu (đơn vị bàn tay)

export class TouchDriver extends HandDriver {
  constructor(opts = {}) {
    super({ onStatus: opts.onStatus, external: true });
    this.touch = true;
    this.move = { x: 0, y: 0 };            // cần trượt trái, -1..1
    this.aim = { x: 0, y: 0 };             // vùng vợt phải, -1..1
    this.home = true;                      // trước trận / đếm 3-2-1 / sau trận: đứng đúng chỗ khởi tạo
    this.locked = false;                   // đòn đặc biệt: giữ nguyên chỗ đứng
    this._s = { px: 0.5, py: 0.5, ax: 0, ay: 0, t: 0, last: 0 };
    this._tip = {};
    for (const f of Object.keys(FINGERS)) this._tip[f] = { ...REST[f] };
    this.resetPos();
  }
  async start() {                          // KHÔNG mở camera, KHÔNG nạp MediaPipe
    if (this.running) return this.mode;
    this.running = true; this.mode = "sim"; this.resetPos();
    return this.mode;
  }
  stop() {
    super.stop();
    this.move.x = this.move.y = 0; this.aim.x = this.aim.y = 0;
    this._s.ax = this._s.ay = 0; this.resetPos();
  }
  setMove(x, y) { this.move.x = x; this.move.y = y; }
  setAim(x, y) { this.aim.x = x; this.aim.y = y; }
  setPhase(home, locked) { this.home = home; this.locked = locked; }
  /** Đưa "bàn tay" về đúng vị trí ứng với chỗ khởi tạo của con rối (để lúc giao bóng không bị giật) */
  resetPos() {
    const s = this._s, wk = userWalkX(LAYOUT.STAND_Y);
    const [x0, x1] = TRACKING.ROOT_X_RANGE, [y0, y1] = TRACKING.ROOT_Y_RANGE;
    s.px = x0 + ((LAYOUT.USER_START_X - wk.min) / (wk.max - wk.min)) * (x1 - x0);
    s.py = y0 + ((LAYOUT.STAND_Y - LAYOUT.DEPTH_Y_MIN) / (LAYOUT.DEPTH_Y_MAX - LAYOUT.DEPTH_Y_MIN)) * (y1 - y0);
  }
  /** Không nhận cú vung từ chuyển động – chỉ nhận từ nút HIGH / MID / LOW (forceSwing) */
  _detectSwing() { this.swingLevel *= 0.92; }
  /** Sau khi tính xong, ghi đè vec bằng giá trị chính xác (tư thế nghỉ + độ lệch của vợt) */
  _ingest(pts, now, isSim) {
    super._ingest(pts, now, isSim);
    for (const name of Object.keys(FINGERS)) { this.vec[name].x = this._tip[name].x; this.vec[name].y = this._tip[name].y; }
  }
  /** Dựng 21 landmark giả (chưa lật gương) từ trạng thái cảm ứng */
  _simLandmarks(now) {
    const s = this._s, dt = Math.min(0.05, (now - (s.last || now)) / 1000); s.last = now; s.t += dt;
    if (this.home) this.resetPos();
    else if (!this.locked) {
      const [x0, x1] = TRACKING.ROOT_X_RANGE, [y0, y1] = TRACKING.ROOT_Y_RANGE;
      s.px = clamp(s.px + this.move.x * MOVE_SPEED.x * dt, x0, x1);
      s.py = clamp(s.py + this.move.y * MOVE_SPEED.y * dt, y0, y1);
    }
    const k = Math.min(1, dt * 22);
    s.ax += (this.aim.x - s.ax) * k; s.ay += (this.aim.y - s.ay) * k;
    const wob = Math.sin(s.t * 3) * 0.06;
    const tip = {
      thumb: { ...REST.thumb }, index: { x: REST.index.x, y: REST.index.y + wob }, middle: { ...REST.middle },
      ring: { x: REST.ring.x, y: REST.ring.y - wob }, pinky: { ...REST.pinky },
    };
    const rf = RACKET_FINGER;
    tip[rf] = { x: REST[rf].x + s.ax * AIM_REACH, y: REST[rf].y + s.ay * AIM_REACH };
    this._tip = tip;
    const hs = 0.14, lean = this.move.x * 0.2;
    const pm = { x: 1 - s.px, y: s.py };
    const at = (dx, dy) => ({ x: pm.x - dx * hs, y: pm.y + dy * hs });
    const pts = new Array(21);
    pts[0] = at(0, 1.0);
    const mcp = { 1: [-0.6, 0.55], 5: [-0.55, -0.1], 9: [1.2 * Math.tan(lean), -0.2], 13: [0.45, -0.1], 17: [0.85, 0.1] };
    for (const [i, [x, y]] of Object.entries(mcp)) pts[i] = at(x, y);
    for (const [name, f] of Object.entries(FINGERS)) {
      const base = pts[f.base === 2 ? 1 : f.base], tp = at(tip[name].x, tip[name].y);
      const chain = name === "thumb" ? [2, 3, 4] : [f.base + 1, f.base + 2, f.base + 3];
      chain.forEach((idx, n) => { const t = (n + 1) / chain.length; pts[idx] = { x: base.x + (tp.x - base.x) * t, y: base.y + (tp.y - base.y) * t }; });
    }
    // dịch cả bàn tay để lòng bàn tay (trung bình 5 điểm) đúng bằng (px, py)
    let mx = 0, my = 0;
    for (const i of PALM_IDX) { mx += 1 - pts[i].x; my += pts[i].y; }
    const ox = s.px - mx / 5, oy = s.py - my / 5;
    for (const p of pts) { p.x -= ox; p.y += oy; }
    return pts;
  }
}

/* ================================================================== */
/*  GIAO DIỆN ĐIỆN THOẠI                                               */
/* ================================================================== */
const ICON_ITEMS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1.6"/><rect x="14" y="4" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export function mountPhoneUI({ dom, driver }) {
  const { root, stage, video, puppetTiles } = dom;
  root.classList.add("ps-phone");
  if (getComputedStyle(root).position === "static") root.style.position = "relative";

  /* ---- 1) Ngăn kéo = panel đang chứa 3 thẻ chọn (giữ nguyên style của thẻ) ---- */
  const sel = puppetTiles.closest(".ps-sel");
  let drawer = sel && sel.parentElement;
  if (!drawer || drawer === root || drawer.contains(stage)) {      // phòng khi 3 thẻ không nằm trong panel riêng
    drawer = document.createElement("div");
    root.appendChild(drawer);
    for (const id of ["#ps-sel-puppet", "#ps-sel-equip", "#ps-sel-ball"]) { const n = root.querySelector(id); if (n) drawer.appendChild(n); }
  }
  drawer.classList.add("ps-drawer");
  const head = document.createElement("div");
  head.className = "ps-drawer-head";
  head.innerHTML = `<span>PUPPET &amp; ITEMS</span><button type="button" class="ps-drawer-x" aria-label="Close">${ICON_X}</button>`;
  drawer.prepend(head);

  /* ---- 2) Ẩn khối webcam (không bao giờ ẩn khối chứa 3 thẻ hoặc sân khấu) ---- */
  let cam = video;
  while (cam.parentElement && cam.parentElement !== root && cam.parentElement !== drawer
    && !cam.parentElement.contains(stage) && !cam.parentElement.contains(puppetTiles)) cam = cam.parentElement;
  cam.classList.add("ps-phone-hide");
  for (const n of [dom.camOverlay, dom.live]) n?.classList.add("ps-phone-hide");

  /* ---- 3) Nút điều khiển ---- */
  const ui = document.createElement("div");
  ui.className = "ps-tc";
  ui.innerHTML = `
    <button type="button" class="ps-tc-menu" aria-label="Choose puppet and items" aria-expanded="false">${ICON_ITEMS}</button>
    <div class="ps-tc-pads">
      <div class="ps-tc-stick ps-tc-stick--move"><i class="ps-tc-knob"></i><span class="ps-tc-cap">MOVE</span></div>
      <div class="ps-tc-stick ps-tc-stick--aim"><i class="ps-tc-knob"></i><span class="ps-tc-cap">RACKET</span></div>
      <div class="ps-tc-throw">
        <button type="button" data-dir="-1">HIGH</button>
        <button type="button" data-dir="0">MID</button>
        <button type="button" data-dir="1">LOW</button>
      </div>
    </div>`;
  const backdrop = document.createElement("div");
  backdrop.className = "ps-drawer-backdrop";
  root.append(ui, backdrop);
  const menuBtn = ui.querySelector(".ps-tc-menu");
  const setDrawer = (open) => { root.classList.toggle("is-drawer-open", open); menuBtn.setAttribute("aria-expanded", String(open)); };
  menuBtn.addEventListener("click", () => setDrawer(true));
  backdrop.addEventListener("click", () => setDrawer(false));
  head.querySelector(".ps-drawer-x").addEventListener("click", () => setDrawer(false));
  drawer.addEventListener("click", (e) => { if (e.target.closest("[data-upload]")) setTimeout(() => setDrawer(false), 0); });   // mở khung upload thì đóng ngăn kéo

  /** Một cần trượt: kéo bằng ngón cái, đa chạm (mỗi cần một pointerId riêng) */
  function bindStick(pad, deadzone, onChange) {
    const knob = pad.querySelector(".ps-tc-knob");
    let id = null, cx = 0, cy = 0, R = 1;
    const apply = (e) => {
      let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      const m = Math.hypot(dx, dy);
      if (m < deadzone) onChange(0, 0);
      else { const sc = (m - deadzone) / (1 - deadzone) / m; onChange(dx * sc, dy * sc); }
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; pad.classList.remove("is-on"); knob.style.transform = ""; onChange(0, 0);
    };
    pad.addEventListener("pointerdown", (e) => {
      if (id !== null) return;
      e.preventDefault(); id = e.pointerId;
      const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width * 0.36;
      try { pad.setPointerCapture(id); } catch { /* bỏ qua */ }
      pad.classList.add("is-on"); apply(e);
    });
    pad.addEventListener("pointermove", (e) => { if (e.pointerId === id) { e.preventDefault(); apply(e); } });
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(t, end);
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
    return () => { id = null; pad.classList.remove("is-on"); knob.style.transform = ""; onChange(0, 0); };
  }
  const releaseMove = bindStick(ui.querySelector(".ps-tc-stick--move"), 0.12, (x, y) => driver.setMove(x, y));
  const releaseAim = bindStick(ui.querySelector(".ps-tc-stick--aim"), 0.04, (x, y) => driver.setAim(x, y));
  const throwBtns = [...ui.querySelectorAll(".ps-tc-throw button")];
  throwBtns.forEach((b) => b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    driver.forceSwing(Number(b.dataset.dir));        // -1 = CAO, 0 = GIỮA, 1 = THẤP (khớp rallyEngine._resolve)
    navigator.vibrate?.(25);
  }));

  let finisher = false, guard = -1;
  return {
    /** gọi mỗi khung hình: chỉ đổi DOM khi giá trị thật sự thay đổi */
    sync(phase, g) {
      const f = phase === "finisher";
      if (f !== finisher) { finisher = f; ui.classList.toggle("is-finisher", f); if (f) releaseAim(); }
      const gg = f ? g : -1;
      if (gg !== guard) { guard = gg; throwBtns.forEach((b, i) => b.classList.toggle("is-guarded", i === gg)); }
    },
    closeDrawer: () => setDrawer(false),
    reset() { releaseMove(); releaseAim(); finisher = false; guard = -1; ui.classList.remove("is-finisher"); throwBtns.forEach((b) => b.classList.remove("is-guarded")); setDrawer(false); },
  };
}