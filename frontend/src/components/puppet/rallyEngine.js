// frontend/src/components/puppet/rallyEngine.js
// LUẬT CHƠI: giao tranh (rally) -> tích năng lượng -> cao trào (con rối bật nhảy, quả cầu lơ lửng) -> cú kết liễu.
// Thuần logic, không đụng DOM/canvas. Giao tiếp với giao diện qua onEvent(type, data).
import { LAYOUT as L, PHYSICS as PH, RULES, AI, FINISHER as FN } from "./puppetConfig.js";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const bez = (a, c, b, u) => { const v = 1 - u; return { x: v * v * a.x + 2 * v * u * c.x + u * u * b.x, y: v * v * a.y + 2 * v * u * c.y + u * u * b.y }; };
const bezTan = (a, c, b, u) => ({ x: 2 * (1 - u) * (c.x - a.x) + 2 * u * (b.x - c.x), y: 2 * (1 - u) * (c.y - a.y) + 2 * u * (b.y - c.y) });
const TH = FN.THROW;
export const GUARDS = ["HIGH", "MID", "LOW"];
export const GUARD_Y = [500, 640, 780];       // độ cao tâm khiên của AI theo từng tư thế
export class RallyEngine {
  constructor(onEvent = () => {}, rng = Math.random) {
    this.onEvent = onEvent; this.rng = rng;
    this.reset();
  }
  reset() {
    this.phase = "idle";          // idle | countdown | serve | rally | point | climax | finisher | strike | result
    this.timer = 0;
    this.score = { user: 0, ai: 0 };
    this.lives = RULES.LIVES;
    this.energy = 0;
    this.rallyHits = 0;
    this.result = null;
    this.countShown = null;
    this.ball = this._newBall();
    this.ball.visible = false;
    this.ai = { shieldX: L.AI_X - 120, shieldY: 640, recoil: 0, guard: 1, guardTimer: 0, willReturn: false, decided: false, knockX: 0, knockV: 0, shattered: false, flash: 0 };
    this.user = { jump: 0, strikeT: -1, strikeHeight: 1, knockX: 0, flash: 0, recover: 0 };
    this.finisher = { t: 0, strike: null, impact: false, caughtAt: -1, landed: false };
    // Vũ khí: held (đang cầm) | fly (bay tới đối thủ) | stuck (ghim vào mục tiêu) | rebound (bị khiên đánh bật) | return (bay về tay)
    this.weapon = { state: "held", x: 0, y: 0, angle: 0, k: 0.55, t: 0, from: null, to: null, ctrl: null, a0: 0, vx: 0, vy: 0, spin: 0, trail: [], grip: null };
    this.hitStop = 0;
    this.matchPointPending = false;
    this.shake = 0;
  }
  _newBall() {
    return { x: L.AI_X - 150, y: 520, vx: 0, vy: 0, spin: 0, glow: 0, visible: true, lastHitBy: null, bounceUser: 0, bounceAi: 0, hitCd: 0, still: 0 };
  }
  emit(type, data = {}) { this.onEvent(type, data); }
  start() {
    this.reset();
    this.phase = "countdown"; this.timer = RULES.COUNTDOWN;
    this.emit("start");
  }
  /** Quả cầu bay từ vị trí hiện tại tới (tx, mặt bàn) trong thời gian ~T, nhớ vượt qua cột giữa bàn. */
  _launchTo(tx, T0, clearNet = true) {
    const b = this.ball, ty = L.TABLE_Y - PH.BALL_R;
    for (let T = T0; T <= 1.8; T += 0.05) {
      const vx = (tx - b.x) / T, vy = (ty - b.y - 0.5 * PH.GRAVITY * T * T) / T;
      const crosses = (b.x - L.NET_X) * (tx - L.NET_X) < 0;
      if (!clearNet || !crosses) { b.vx = vx; b.vy = vy; return T; }
      const tn = (L.NET_X - b.x) / vx, yn = b.y + vy * tn + 0.5 * PH.GRAVITY * tn * tn;
      if (yn <= L.NET_TOP - 40) { b.vx = vx; b.vy = vy; return T; }
    }
    b.vx = (tx - b.x) / 1.8; b.vy = -900; return 1.8;
  }
  /* ---------------------------------------------------------------- */
  update(dt, input = {}) {
    dt = Math.min(dt, 0.05);
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.12; }          // khựng hình lúc va chạm: tạo cảm giác lực
    if (input.weapon) this.weapon.grip = { ...input.weapon };           // vị trí / góc vũ khí khi cầm trên tay (để biết ném từ đâu và đón về đâu)
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.ai.flash = Math.max(0, this.ai.flash - dt * 3);
    this.user.flash = Math.max(0, this.user.flash - dt * 3);
    this.ai.recoil = Math.max(0, this.ai.recoil - dt * 4);
    // AI bị đánh bay
    this.ai.knockX += this.ai.knockV * dt; this.ai.knockV *= 0.96;
    switch (this.phase) {
      case "countdown": this._countdown(dt); break;
      case "serve": this._serve(dt); break;
      case "rally": this._rally(dt, input); break;
      case "point": this.timer -= dt; if (this.timer <= 0) this._next(); break;
      case "climax": this._climax(dt); break;
      case "finisher": this._finisher(dt, input); break;
      case "strike": this._strike(dt); break;
      case "result": this.ai.knockV = 0; this.ai.knockX += (0 - this.ai.knockX) * Math.min(1, dt * 3); this.user.recover = Math.min(1, this.user.recover + dt * 2); break;   // đưa AI về chỗ cũ
      default: break;
    }
    if (this.phase !== "climax" && this.phase !== "finisher" && this.phase !== "strike") this.user.jump = Math.max(0, this.user.jump - dt * 700);
    this._aiShield(dt);
  }
  _countdown(dt) {
    this.timer -= dt;
    const n = Math.ceil(this.timer);
    if (n !== this.countShown && n > 0) { this.countShown = n; this.emit("countdown", { n }); }
    if (this.timer <= 0) { this._next(); }
  }
  /** Sau khi có điểm / hết đếm ngược: giao cầu hoặc vào cao trào nếu đang match point */
  _next() {
    if (this.score.user >= RULES.MATCH_POINT) { this.beginClimax("match"); return; }
    this.phase = "serve"; this.timer = RULES.SERVE_DELAY;
    this.ball = this._newBall(); this.ball.visible = true;
    this.rallyHits = 0; this.ai.decided = false;
  }
  _serve(dt) {
    this.timer -= dt;
    this.ball.x = L.AI_X - 150; this.ball.y = 520 + Math.sin(performance.now?.() / 300 || 0) * 4;
    if (this.timer > 0) return;
    this.ball.lastHitBy = "ai"; this.ball.bounceUser = this.ball.bounceAi = 0;
    this._launchTo(lerp(L.TABLE_L + 40, L.NET_X - 120, this.rng()), 0.95);
    this.phase = "rally";
    this.ai.recoil = 1;
    this.emit("serve");
  }
  /* ---------------------------------------------------------------- */
  _rally(dt, input) {
    const b = this.ball, g = PH.GRAVITY, r = PH.BALL_R;
    b.hitCd = Math.max(0, b.hitCd - dt);
    const px = b.x, py = b.y;
    b.vy += g * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.spin += b.vx * dt * 0.02;
    // --- nảy trên mặt bàn ---
    if (b.vy > 0 && py + r <= L.TABLE_Y + 4 && b.y + r >= L.TABLE_Y && b.x > L.TABLE_L && b.x < L.TABLE_R) {
      b.y = L.TABLE_Y - r; b.vy = -b.vy * PH.RESTITUTION_TABLE;
      const side = b.x < L.NET_X ? "user" : "ai";
      if (side === "user") b.bounceUser++; else b.bounceAi++;
      this.emit("bounce", { x: b.x, y: L.TABLE_Y });
      // lỗi: người vừa đánh mà cầu chạm bàn bên mình trước
      if (b.lastHitBy === "user" && side === "user") return this._point("ai", "Your ball bounced on your own side");
      if (b.lastHitBy === "ai" && side === "ai") return this._point("user", "AI hit its own side");
      if (side === "user" && b.bounceUser >= 2) return this._point("ai", "Second bounce");
    }
    // --- cột giữa bàn ---
    if (Math.abs(b.x - L.NET_X) < 10 + r && b.y > L.NET_TOP && b.y < L.TABLE_Y - 4 && Math.sign(b.vx) === Math.sign(L.NET_X - px)) {
      b.vx = -b.vx * 0.45; b.x = px;
    }
    // --- rơi xuống sàn / ra khỏi sân ---
    if (b.y + r >= L.FLOOR_Y + 10 || b.x < -40 || b.x > 1524) {
      this.emit("floor", { x: b.x });
      return this._point(b.x < L.NET_X ? "ai" : "user", b.x < L.NET_X ? "You missed the ball" : "AI missed the ball");
    }
    // --- đứng yên quá lâu ---
    b.still = Math.hypot(b.vx, b.vy) < 25 ? b.still + dt : 0;
    if (b.still > 1.4) return this._point(b.x < L.NET_X ? "ai" : "user", "Ball stopped");
    // --- vợt người chơi ---
    if (input.racket && b.hitCd <= 0 && b.x < L.NET_X + 60) this._userHit(input.racket);
    // --- AI ---
    this._aiLogic(dt);
  }
  _userHit(rk) {
    const b = this.ball, rr = PH.RACKET_R + PH.BALL_R;
    const dx = b.x - rk.x, dy = b.y - rk.y, d = Math.hypot(dx, dy);
    if (d > rr) return;
    const speed = Math.hypot(rk.vx || 0, rk.vy || 0);
    const power = clamp(speed / 1200, 0, 1);
    // cú đánh "hỗ trợ ngắm": chọn điểm rơi bên phía AI theo lực vung, thêm chút ngẫu nhiên cho tự nhiên
    const depth = clamp(0.25 + power * 0.6 + (this.rng() - 0.5) * 0.25, 0.05, 1);
    const tx = lerp(L.NET_X + 120, L.TABLE_R - 55, depth);
    const T0 = clamp(0.95 - power * 0.35, 0.55, 1.0);
    this._launchTo(tx, T0);
    // vợt vung xuống thì cầu bay thấp hơn một chút / vung lên thì cao hơn
    b.vy += clamp((rk.vy || 0) * 0.08, -90, 90);
    b.lastHitBy = "user"; b.bounceUser = b.bounceAi = 0; b.hitCd = 0.25;
    this.rallyHits++;
    this.ai.decided = false;
    let gain = RULES.ENERGY_PER_RETURN + (speed > 900 ? RULES.ENERGY_FAST_BONUS : 0);
    this.energy = clamp(this.energy + gain, 0, RULES.ENERGY_MAX);
    this.shake = 0.35 + power * 0.4;
    this.emit("hit", { x: b.x, y: b.y, power, gain, energy: this.energy });
    if (this.energy >= RULES.ENERGY_MAX) this.beginClimax("energy");
  }
  /* ---------------------------------------------------------------- */
  _aiLogic(dt) {
    const b = this.ball, ai = this.ai;
    if (b.lastHitBy !== "user") return;
    if (!ai.decided && b.vx > 0) {
      ai.decided = true;
      const chance = Math.max(AI.RETURN_CHANCE_MIN, AI.RETURN_CHANCE_START - this.rallyHits * AI.RETURN_DECAY_PER_HIT);
      ai.willReturn = this.rng() < chance;
    }
    if (!ai.willReturn || !ai.decided || b.vx <= 0) return;
    // AI chỉ đỡ khi quả cầu vào vùng với khiên và đã nảy bên bàn của nó (hoặc bay trực tiếp)
    const inZone = b.x >= L.AI_X - AI.REACH_X && b.x <= L.AI_X + 80 && b.y > 430 && b.y < 800;
    if (!inZone) return;
    const speed = AI.SPEED_START + this.rallyHits * AI.SPEED_GAIN;
    const tx = lerp(L.TABLE_L + 30, L.NET_X - 110, this.rng());
    const dist = Math.hypot(tx - b.x, 0);
    b.x = Math.min(b.x, L.AI_X + 10);
    this._launchTo(tx, clamp(dist / speed, 0.55, 1.05));
    b.lastHitBy = "ai"; b.bounceUser = b.bounceAi = 0; b.hitCd = 0.25;
    this.ai.recoil = 1; this.ai.flash = 0.6; this.ai.willReturn = false;
    this.rallyHits++;
    this.emit("aiReturn", { x: b.x, y: b.y });
  }
  _aiShield(dt) {
    const ai = this.ai, b = this.ball;
    let ty = 640, tx = L.AI_X - 120;
    if (this.phase === "rally" && b.visible && b.x > L.NET_X) ty = clamp(b.y, 520, 780);
    if (this.phase === "finisher" || this.phase === "strike" || this.phase === "climax") ty = GUARD_Y[ai.guard];
    ai.shieldY += (ty - ai.shieldY) * Math.min(1, dt * (this.phase === "finisher" ? 14 : 7));
    ai.shieldX += (tx - ai.shieldX) * Math.min(1, dt * 8);
  }
  _point(who, reason) {
    if (this.phase !== "rally") return;
    this.score[who]++;
    if (who === "ai") { this.lives--; this.energy = Math.max(0, this.energy - 25); }
    this.phase = "point"; this.timer = 1.4;
    this.emit("point", { who, reason, score: { ...this.score }, lives: this.lives });
    if (this.lives <= 0) this._finish("lose", "You ran out of lives");
  }
  /* ---------------------------------------------------------------- */
  /*  Cao trào + cú kết liễu                                          */
  /* ---------------------------------------------------------------- */
  beginClimax(reason) {
    if (this.phase === "climax" || this.phase === "finisher" || this.phase === "strike" || this.phase === "result") return;
    this.phase = "climax"; this.timer = 0; this.climaxReason = reason;
    this.ball.visible = true; this.ball.vx = this.ball.vy = 0;
    this.ball.from = { x: this.ball.x, y: this.ball.y };
    this.ai.guard = 1; this.ai.guardTimer = 0;
    this.emit("climax", { reason });
  }
  _climax(dt) {
    this.timer += dt;
    const t = ease(this.timer / FN.INTRO), b = this.ball, to = { x: L.NET_X - 200, y: 420 };
    this.user.jump = FN.JUMP_HEIGHT * t;
    b.x = lerp(b.from.x, to.x, t); b.y = lerp(b.from.y, to.y, t); b.glow = t; b.spin += dt * 3;
    if (this.timer >= FN.INTRO) { this.phase = "finisher"; this.finisher.t = FN.WINDOW; this.ai.guardTimer = FN.GUARD_SWITCH; this.emit("finisherStart", { window: FN.WINDOW }); }
  }
  _finisher(dt, input) {
    const b = this.ball, f = this.finisher, ai = this.ai;
    f.t -= dt; b.glow = 0.8 + Math.sin(performance.now?.() / 120 || 0) * 0.2; b.spin += dt * 4;
    b.y = 420 + Math.sin((FN.WINDOW - f.t) * 3) * 8;
    ai.guardTimer -= dt;
    if (ai.guardTimer <= 0) {
      ai.guardTimer = FN.GUARD_SWITCH;
      let g; do { g = (this.rng() * 3) | 0; } while (g === ai.guard);
      ai.guard = g; this.emit("guard", { guard: g });
    }
    if (input.swing) { this._resolve(input.swing); return; }
    if (f.t <= 0) this._fizzle();
  }
  _fizzle() {
    this.emit("fizzle");
    this.energy = 40; this.ball.glow = 0;
    this.phase = "point"; this.timer = 1.0; this.matchPointPending = false;
    this.score.user = Math.min(this.score.user, RULES.MATCH_POINT - 1);
  }
  _resolve(swing) {
    const dy = swing.dirY ?? 0;
    const height = dy < -0.3 ? 0 : dy > 0.3 ? 2 : 1;            // vung lên = CAO, ngang = GIỮA, xuống = THẤP
    const blocked = this.ai.guard === height;
    this.finisher.strike = { height, blocked, guard: this.ai.guard };
    this.finisher.impact = false; this.finisher.caughtAt = -1; this.finisher.landed = false;
    this.user.strikeT = 0; this.user.strikeHeight = height; this.user.recover = 0;
    this.weapon.state = "held"; this.weapon.trail = [];
    this.phase = "strike"; this.timer = 0;
    this.emit("strike", { height, blocked, guard: this.ai.guard, speed: swing.speed });
  }
  /** Đòn tấn công = NÉM vũ khí: tay quất -> vũ khí rời tay, bay theo cung tới mục tiêu -> va chạm (khiên đỡ / trúng) -> bay về tay -> mới có kết quả. */
  _strike(dt) {
    this.timer += dt;
    const w = this.weapon, f = this.finisher;
    this.user.strikeT = clamp(this.timer / TH.SWEEP, 0, 1);
    this.ball.glow = Math.max(0, 1 - this.timer * 1.5);
    switch (w.state) {
      case "held": if (f.caughtAt < 0 && this.timer >= TH.RELEASE) this._release(); break;
      case "fly": this._fly(dt); break;
      case "stuck": w.t += dt; if (w.t >= TH.STUCK) this._beginReturn(); break;
      case "rebound": this._rebound(dt); break;
      case "return": this._return(dt); break;
      default: break;
    }
    // sau khi ném, con rối rơi xuống sàn (chỉ đòn đặc biệt mới được rời mặt đất) – chạm đất thì báo "land" để hiện bụi
    if (w.state === "stuck" || w.state === "rebound" || w.state === "return" || f.caughtAt >= 0) {   // vũ khí trúng đích rồi con rối mới hạ xuống
      const was = this.user.jump;
      this.user.jump = Math.max(0, was - dt * TH.LAND_SPEED);
      if (was > 0 && this.user.jump === 0 && !f.landed) { f.landed = true; this.emit("land"); }
    }
    this.user.recover = clamp((this.timer - (TH.RELEASE + TH.FLY * 0.5)) / 0.7, 0, 1);       // tay dần trở về tư thế thường
    if (f.caughtAt >= 0 && this.timer - f.caughtAt >= TH.SETTLE) {
      const s = f.strike;
      this._finish(s.blocked ? "lose" : "win", s.blocked ? "The Guardian blocked your strike" : "You shattered the Guardian!");
    } else if (this.timer > 8) {                                                                  // chốt an toàn: không bao giờ kẹt ở phase này
      w.state = "held"; const s = f.strike; this._finish(s.blocked ? "lose" : "win", s.blocked ? "The Guardian blocked your strike" : "You shattered the Guardian!");
    }
  }
  _release() {
    const w = this.weapon, s = this.finisher.strike;
    const g = w.grip || { x: L.USER_START_X + 90, y: 470, angle: 0.4, k: 0.55 };
    const ai = this.ai;
    // khiên đỡ: bay tới đúng tâm khiên; trúng: bay vào thân con rối AI ở tầng đã nhắm
    const to = s.blocked ? { x: ai.shieldX - 6, y: GUARD_Y[ai.guard] } : { x: L.AI_X - 34, y: GUARD_Y[s.height] - 10 };
    w.state = "fly"; w.t = 0; w.from = { x: g.x, y: g.y }; w.to = to; w.a0 = g.angle; w.k = g.k; w.x = g.x; w.y = g.y; w.angle = g.angle; w.trail = [];
    // cung bay: điểm điều khiển cao, đặt muộn về phía đích -> vũ khí vút lên rồi lao xuống; tăng độ cao tới khi vượt qua mặt bàn
    const dx = to.x - g.x, dist = Math.hypot(dx, to.y - g.y);
    let arc = clamp(70 + dist * 0.1, 90, 170);
    for (let i = 0; i < 8; i++) {
      w.ctrl = { x: lerp(g.x, to.x, 0.78), y: Math.min(g.y, to.y) - arc };
      let ok = true;
      for (let u = 0; u <= 1; u += 0.04) { const q = bez(w.from, w.ctrl, w.to, u); if (q.x > L.TABLE_L + 30 && q.x < L.TABLE_R - 10 && q.y > L.TABLE_Y - 70) { ok = false; break; } }
      if (ok) break; arc += 40;
    }
    this.emit("release", { x: g.x, y: g.y });
  }
  _trail(w) { w.trail.push({ x: w.x, y: w.y }); if (w.trail.length > 18) w.trail.shift(); }
  _fly(dt) {
    const w = this.weapon;
    w.t += dt;
    const p = clamp(w.t / TH.FLY, 0, 1), u = p ** 1.35;           // tăng tốc dần: càng gần đích càng nhanh -> cảm giác lực
    const pos = bez(w.from, w.ctrl, w.to, u), v = bezTan(w.from, w.ctrl, w.to, u);
    w.x = pos.x; w.y = pos.y;
    const target = Math.atan2(v.x, -v.y);                         // mũi vũ khí hướng theo chiều bay (0 = mũi hướng lên)
    w.angle = w.a0 + wrapPi(target - w.a0) * ease(p / 0.22);
    this._trail(w);
    if (p >= 1) this._impact();
  }
  _impact() {
    const w = this.weapon, s = this.finisher.strike;
    this.finisher.impact = true; this.shake = 1; this.hitStop = TH.HIT_STOP;
    this.emit("impact", { x: w.to.x, y: w.to.y, blocked: s.blocked, angle: w.angle });
    if (s.blocked) {
      this.ai.flash = 1; this.user.knockX = -1; this.emit("blocked");
      w.state = "rebound"; w.t = 0; w.vx = -560; w.vy = -420; w.spin = -13;                      // bị khiên đánh bật ngược lại
    } else {
      this.ai.shattered = true; this.ai.knockV = 700; this.emit("shatter");
      w.state = "stuck"; w.t = 0;                                                                // ghim lại một nhịp rồi mới bay về
    }
  }
  _rebound(dt) {
    const w = this.weapon;
    w.t += dt; w.vy += 2200 * dt; w.x += w.vx * dt; w.y += w.vy * dt; w.angle += w.spin * dt;
    this._trail(w);
    if (w.t >= TH.REBOUND) this._beginReturn();
  }
  _beginReturn() {
    const w = this.weapon;
    w.state = "return"; w.t = 0; w.from = { x: w.x, y: w.y }; w.a0 = w.angle;
  }
  _return(dt) {
    const w = this.weapon, g = w.grip || { x: L.USER_START_X + 90, y: 470, angle: 0.4, k: w.k };
    w.t += dt;
    const p = clamp(w.t / TH.RETURN, 0, 1), u = 1 - (1 - p) ** 2.2;          // giảm tốc khi gần tay -> "đón" nhẹ nhàng
    const ctrl = { x: lerp(w.from.x, g.x, 0.45), y: Math.min(w.from.y, g.y) - 130 };
    const pos = bez(w.from, ctrl, g, u);
    w.x = pos.x; w.y = pos.y; w.k = g.k;
    w.angle = w.a0 + (wrapPi(g.angle - w.a0) + Math.PI * 4) * u;               // xoay 2 vòng rồi vào đúng góc cầm
    this._trail(w);
    if (p >= 1) {
      w.state = "held"; w.trail = []; this.finisher.caughtAt = this.timer;     // về tay: bắt đầu vẽ lại như vũ khí đang cầm
      this.emit("catch", { x: g.x, y: g.y });
    }
  }
  _finish(kind, reason) {
    if (this.phase === "result") return;
    this.phase = "result"; this.result = { kind, reason, score: { ...this.score } };
    this.emit("result", this.result);
  }
}