// frontend/src/components/puppet/handDriver.js
// ĐỌC BÀN TAY -> dữ liệu điều khiển con rối.
//  - Chế độ "camera": MediaPipe HandLandmarker (nạp từ CDN, độc lập với memeDetector.js).
//  - Chế độ "sim"   : giả lập bằng chuột/bàn phím khi không có webcam (và để test).
// Mỗi khung hình sinh ra một "mẫu" (sample) đã lọc nhiễu: vị trí lòng bàn tay, vector từng ngón, góc nghiêng, cú vung.
import { FINGERS, TRACKING, WEAPON_FINGER } from "./puppetConfig.js";

const PALM_IDX = [0, 5, 9, 13, 17];
export const SKELETON = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [9, 10], [10, 11], [11, 12], [5, 9], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class HandDriver {
  /**
   * opts: { video, overlay, onStatus(text, level) }
   *  video/overlay: <video> và <canvas> của khung "HAND TRACKING AREA" (được lật gương bằng CSS)
   */
  constructor(opts = {}) {
    this.video = opts.video || null;
    this.overlay = opts.overlay || null;
    this.onStatus = opts.onStatus || (() => {});
    this.external = !!opts.external;   // true = vòng lặp của puppetStage tự gọi tick() mỗi khung (nhận diện + dựng tư thế + vẽ trong CÙNG một khung)
    this.delegate = "";                // "GPU" | "CPU"
    this.detMs = 0; this.detN = 0;     // thời gian nhận diện trung bình (ms) và số lần nhận diện (để đo)
    this._rectT = -1e9;
    this.mode = "off";                // "off" | "camera" | "sim"
    this.landmarker = null;
    this.stream = null;
    this.raf = 0;
    this.lastVideoTime = -1;
    this.running = false;

    // ---- trạng thái hiện tại ----
    this.present = false;
    this.lastSeen = 0;
    this.lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })); // đã lọc, ĐÃ lật gương (x' = 1 - x)
    this.raw = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 })); // chưa lật gương – để vẽ lên overlay
    this.palm = { x: 0.5, y: 0.5 };
    this.hs = 0.12;                    // kích thước bàn tay (cổ tay -> khớp ngón giữa)
    this.vec = {};                     // vector từng ngón so với lòng bàn tay, chuẩn hoá theo hs
    for (const f of Object.keys(FINGERS)) this.vec[f] = { x: 0, y: -2 };
    this.roll = 0;                     // nghiêng bàn tay (rad), 0 = thẳng đứng
    this._swing = null;
    this._swingCooldown = 0;
    this._prevRing = null;
    this._vRing = { x: 0, y: 0 };
    this._hist = [];                   // lịch sử vị trí lòng bàn tay để nhận cú quét chậm
    this.swingLevel = 0;               // 0..1: "thanh lực vung" hiển thị cho người chơi
    this._sim = { x: 0.35, y: 0.55, hs: 0.14, t: 0, keys: new Set(), last: 0, vx: 0, vy: 0, tx: 0.35, ty: 0.55 };
    this._bind = null;
  }

  /* ---------------------------------------------------------------- */
  async start() {
    if (this.running) return this.mode;
    this.running = true;
    this.onStatus("Starting camera…", "info");
    try {
      await this._startCamera();
      await this._loadLandmarker();
      this.mode = "camera";
      this.onStatus("Show your hand to the camera", "ok");
    } catch (err) {
      console.warn("[HandDriver] camera/MediaPipe unavailable, using mouse simulation:", err);
      this._stopCamera();
      this.startSim();
      this.onStatus("No camera – move the mouse to control the puppet (Space = swing)", "warn");
    }
    if (!this.external) this._loop();
    return this.mode;
  }

  async _startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia not supported");
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 }, facingMode: "user" }, audio: false });
    if (!this.video) throw new Error("no <video> element");
    this.video.srcObject = this.stream;
    this.video.muted = true; this.video.playsInline = true;
    await this.video.play();
  }

  async _loadLandmarker() {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    const make = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: TRACKING.MODEL_URL, delegate },
      runningMode: "VIDEO", numHands: 1,
      minHandDetectionConfidence: TRACKING.MIN_CONFIDENCE, minHandPresenceConfidence: TRACKING.MIN_CONFIDENCE, minTrackingConfidence: TRACKING.MIN_CONFIDENCE,
    });
    //try { this.landmarker = await make("GPU"); } catch { this.landmarker = await make("CPU"); }
    try { this.landmarker = await make("GPU"); this.delegate = "GPU"; }
    catch (e) { console.warn("[HandDriver] GPU delegate failed, falling back to CPU:", e); this.landmarker = await make("CPU"); this.delegate = "CPU"; }
    console.log("[HandDriver] delegate:", this.delegate);

    // đo tốc độ: in ra Console mỗi giây, cùng kiểu với Snap & Solve
    const rawDetect = this.landmarker.detectForVideo.bind(this.landmarker);
    let n = 0, ms = 0, t0 = performance.now();
    this.landmarker.detectForVideo = (...a) => {
      const t = performance.now(); const r = rawDetect(...a); ms += performance.now() - t; n++;
      if (performance.now() - t0 >= 1000) { console.log(`puppet tracking ${n} fps, ${(ms / n).toFixed(1)} ms/frame`); n = 0; ms = 0; t0 = performance.now(); }
      return r;
    };
  }

  _stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this._stopCamera();
    try { this.landmarker?.close(); } catch { /* bỏ qua */ }
    this.landmarker = null;
    this.stopSim();
    this.mode = "off"; this.present = false;
    this._clearOverlay();
  }

  /* ---------------------------------------------------------------- */
  _loop = () => {
    if (!this.running) return;
    this.tick();
    this.raf = requestAnimationFrame(this._loop);
  };

  /** Một nhịp xử lý: nhận diện (khi camera có khung mới) rồi vẽ khung xương. */
  tick() {
    if (!this.running) return;
    const now = performance.now();
    let fresh = false;
    if (this.mode === "camera" && this.landmarker && this.video?.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const res = this.landmarker.detectForVideo(this.video, now);
      this.detMs += (performance.now() - now - this.detMs) * 0.1; this.detN++;
      const pts = res?.landmarks?.[0];
      if (pts) this._ingest(pts, now); else this._missing(now);
      fresh = true;
    } else if (this.mode === "sim") {
      this._ingest(this._simLandmarks(now), now, true);
      fresh = true;
    }
    if (fresh) this._drawOverlay();      // chỉ vẽ lại khung xương khi có dữ liệu mới (trước đây vẽ ở MỌI khung hình)
  }

  _missing(now) {
    if (this.present && now - this.lastSeen > TRACKING.LOST_MS) { this.present = false; this._prevRing = null; this._hist.length = 0; this.swingLevel = 0; }
  }

  /** pts: 21 điểm landmark chuẩn hoá (chưa lật gương) */
  _ingest(pts, now, isSim = false) {
    const a = this.present ? TRACKING.SMOOTH : 1;
    for (let i = 0; i < 21; i++) {
      this.raw[i].x = pts[i].x; this.raw[i].y = pts[i].y;
      const mx = 1 - pts[i].x, my = pts[i].y;
      this.lm[i].x += (mx - this.lm[i].x) * a;
      this.lm[i].y += (my - this.lm[i].y) * a;
    }
    this.present = true; this.lastSeen = now;
    let px = 0, py = 0;
    for (const i of PALM_IDX) { px += this.lm[i].x; py += this.lm[i].y; }
    this.palm.x = px / PALM_IDX.length; this.palm.y = py / PALM_IDX.length;
    const hsRaw = Math.hypot(this.lm[0].x - this.lm[9].x, this.lm[0].y - this.lm[9].y);
    this.hs += (Math.max(0.04, hsRaw) - this.hs) * 0.3;
    for (const [name, f] of Object.entries(FINGERS)) {
      const t = this.lm[f.tip];
      this.vec[name].x = (t.x - this.palm.x) / this.hs;
      this.vec[name].y = (t.y - this.palm.y) / this.hs;
    }
    this.roll = Math.atan2(this.lm[9].x - this.lm[0].x, -(this.lm[9].y - this.lm[0].y));
    this._detectSwing(now, isSim);
  }

  /**
   * Cú vung = đầu ngón cầm vũ khí (WEAPON_FINGER) đi sang PHẢI, bằng một trong hai cách:
   *  - GẠT NHANH: tốc độ đầu ngón >= SWING_SPEED (đơn vị bàn tay / giây)
   *  - QUÉT CHẬM: cả bàn tay đi sang phải >= SWEEP_DIST bề rộng khung hình trong SWEEP_MS
   * swingLevel (0..1) cho biết đang gần ngưỡng tới đâu, để giao diện vẽ thanh lực vung.
   */
  _detectSwing(now) {
    const f = FINGERS[WEAPON_FINGER] || FINGERS.ring, tip = this.lm[f.tip];
    let flickRatio = 0, flick = null;
    if (this._prevRing) {
      const dt = Math.max(0.001, (now - this._prevRing.t) / 1000);
      const vx = (tip.x - this._prevRing.x) / dt / this.hs, vy = (tip.y - this._prevRing.y) / dt / this.hs;
      this._vRing.x += (vx - this._vRing.x) * 0.6; this._vRing.y += (vy - this._vRing.y) * 0.6;
      const speed = Math.hypot(this._vRing.x, this._vRing.y), dirX = speed ? this._vRing.x / speed : 0;
      if (dirX >= TRACKING.SWING_MIN_DIR_X) { flickRatio = speed / TRACKING.SWING_SPEED; if (flickRatio >= 1) flick = { speed, dirX, dirY: this._vRing.y / speed }; }
    }
    this._prevRing = { x: tip.x, y: tip.y, t: now };
    // quét chậm: so với điểm TRÁI nhất của lòng bàn tay trong cửa sổ thời gian
    this._hist.push({ t: now, x: this.palm.x, y: this.palm.y });
    while (this._hist.length && now - this._hist[0].t > TRACKING.SWEEP_MS) this._hist.shift();
    let left = this._hist[0];
    for (const h of this._hist) if (h.x < left.x) left = h;
    const dx = this.palm.x - left.x, dy = this.palm.y - left.y;
    const sweepRatio = Math.max(0, dx) / TRACKING.SWEEP_DIST;
    const sweepOk = sweepRatio >= 1 && dx > Math.abs(dy) * 0.8;
    // thanh lực vung: lên nhanh, xuống từ từ
    const lvl = Math.min(1, Math.max(flickRatio, sweepRatio));
    this.swingLevel = lvl > this.swingLevel ? lvl : this.swingLevel * 0.92;
    if ((flick || sweepOk) && now > this._swingCooldown) {
      const n = Math.hypot(dx, dy) || 1;
      this._swing = flick
        ? { ...flick, t: now }
        : { speed: TRACKING.SWING_SPEED, dirX: dx / n, dirY: dy / n, t: now };
      this._swingCooldown = now + TRACKING.SWING_COOLDOWN_MS;
      this.swingLevel = 1; this._hist.length = 0;
    }
  }
  /** Lấy (và xoá) cú vung gần nhất, nếu có */
  consumeSwing(maxAgeMs = 400) {
    const s = this._swing; this._swing = null;
    return s && performance.now() - s.t <= maxAgeMs ? s : null;
  }
  /** Chủ động phát một cú vung (phím Space ở chế độ sim, hoặc nút "Swing!" trên màn hình cảm ứng) */
  forceSwing(dirY = 0) {
    const now = performance.now(); this.swingLevel = 1;
    this._swing = { speed: TRACKING.SWING_SPEED * 1.6, dirX: 0.95, dirY, t: now };
    this._swingCooldown = now + TRACKING.SWING_COOLDOWN_MS;
  }
  get lostForMs() { return this.present ? 0 : performance.now() - this.lastSeen; }

  /* ---------------------------------------------------------------- */
  /*  Overlay: khung xương bàn tay trong ô webcam                      */
  /* ---------------------------------------------------------------- */
  _clearOverlay() {
    const c = this.overlay; if (!c) return;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }
  _drawOverlay() {
    const c = this.overlay; if (!c) return;
    const tNow = performance.now();
    if (tNow - this._rectT > 500) {                     // đo kích thước (buộc trình duyệt tính layout) tối đa 2 lần / giây
      this._rectT = tNow;
      const r = c.getBoundingClientRect();
      if (c.width !== Math.round(r.width) || c.height !== Math.round(r.height)) { c.width = Math.round(r.width); c.height = Math.round(r.height); }
    }
    const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
    if (!this.present) return;
    // video dùng object-fit: cover => đổi toạ độ chuẩn hoá của camera sang toạ độ khung
    const vw = this.video?.videoWidth || 640, vh = this.video?.videoHeight || 480;
    const k = Math.max(c.width / vw, c.height / vh), ox = (c.width - vw * k) / 2, oy = (c.height - vh * k) / 2;
    const P = (p) => ({ x: ox + p.x * vw * k, y: oy + p.y * vh * k });
    g.save();
    g.lineCap = "round"; g.lineJoin = "round";
    // viền tối bên dưới
    g.lineWidth = 2.7; g.strokeStyle = "#4a3f73";
    for (const [a, b] of SKELETON) { const A = P(this.raw[a]), B = P(this.raw[b]); g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke(); }
    // nét tím Wondera bên trên
    g.lineWidth = 1.6; g.strokeStyle = "#6e5e9c";
    for (const [a, b] of SKELETON) { const A = P(this.raw[a]), B = P(this.raw[b]); g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke(); }
    // khớp cam viền tối
    g.fillStyle = "#f2a93b"; g.strokeStyle = "#4a3f73"; g.lineWidth = 0.9;
    for (const p of this.raw) { const q = P(p); g.beginPath(); g.arc(q.x, q.y, 2.3, 0, 6.283); g.fill(); g.stroke(); }
    g.restore();
  }

  /* ---------------------------------------------------------------- */
  /*  Giả lập bằng chuột                                               */
  /* ---------------------------------------------------------------- */
  startSim(target = window) {
    this.mode = "sim";
    const s = this._sim;
    const move = (e) => {
      const el = this.simArea || document.body, r = el.getBoundingClientRect();
      s.tx = clamp((e.clientX - r.left) / r.width, 0.05, 0.95); s.ty = clamp((e.clientY - r.top) / r.height, 0.1, 0.95);
    };
    const kd = (e) => { if (e.code === "Space") { e.preventDefault(); this.forceSwing(); } s.keys.add(e.code); };
    const ku = (e) => s.keys.delete(e.code);
    target.addEventListener("pointermove", move); target.addEventListener("keydown", kd); target.addEventListener("keyup", ku);
    this._bind = () => { target.removeEventListener("pointermove", move); target.removeEventListener("keydown", kd); target.removeEventListener("keyup", ku); };
  }
  stopSim() { this._bind?.(); this._bind = null; }

  /** Dựng 21 landmark giả quanh vị trí chuột (đã ở toạ độ CHƯA lật gương) */
  _simLandmarks(now) {
    const s = this._sim, dt = Math.min(0.05, (now - (s.last || now)) / 1000); s.last = now; s.t += dt;
    s.x += (s.tx - s.x) * Math.min(1, dt * 14); s.y += (s.ty - s.y) * Math.min(1, dt * 14);
    const hs = s.hs, wob = Math.sin(s.t * 3) * 0.06;
    // vector đầu ngón (đơn vị bàn tay) – phím 1..5 gập từng ngón để thử chân/tay
    const tipVec = {
      thumb: { x: -1.1, y: -0.7 }, index: { x: -0.5, y: -2.3 + wob }, middle: { x: 0, y: -2.5 },
      ring: { x: 0.5, y: -2.2 - wob }, pinky: { x: 1.0, y: -1.7 },
    };
    const keyMap = { Digit1: "thumb", Digit2: "index", Digit3: "middle", Digit4: "ring", Digit5: "pinky" };
    for (const [k, f] of Object.entries(keyMap)) if (s.keys.has(k)) tipVec[f] = { x: tipVec[f].x * 0.35, y: -0.5 };
    // toạ độ chưa lật gương = 1 - mirrored
    const pm = { x: 1 - s.x, y: s.y };
    const pts = new Array(21);
    const at = (dx, dy) => ({ x: pm.x - dx * hs, y: pm.y + dy * hs });   // dx tính theo ảnh đã lật => trừ
    pts[0] = at(0, 1.0);
    const mcp = { 1: [-0.6, 0.55], 5: [-0.55, -0.1], 9: [-0.05, -0.2], 13: [0.45, -0.1], 17: [0.85, 0.1] };
    for (const [i, [x, y]] of Object.entries(mcp)) pts[i] = at(x, y);
    for (const [name, f] of Object.entries(FINGERS)) {
      const base = pts[f.base === 2 ? 1 : f.base], tipV = tipVec[name], tip = at(tipV.x, tipV.y);
      const chain = name === "thumb" ? [2, 3, 4] : [f.base + 1, f.base + 2, f.base + 3];
      if (name === "thumb") pts[1] = base;
      chain.forEach((idx, n) => { const t = (n + 1) / chain.length; pts[idx] = { x: base.x + (tip.x - base.x) * t, y: base.y + (tip.y - base.y) * t }; });
    }
    return pts;
  }
}