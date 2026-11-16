// frontend/src/components/puppet/puppetStage.js
// ĐIỀU PHỐI Puppet Stage: nối giao diện (tab) + camera/bàn tay + engine luật chơi + renderer.
// Handlab gọi: initPuppetStage() (một lần), startPuppetStage() khi vào tab, stopPuppetStage() khi rời tab / đóng Hand Lab.
import { LAYOUT as L, TRACKING, HAND_ROLES, LIMB_BY_FINGER, FINGER_GAIN, FINGERS, fingerOfLimb, armWithRole, WEAPON_FINGER, depthScale, userWalkX } from "./puppetConfig.js";
import { PRESET_PUPPETS, AI_PUPPET, EQUIPMENT, BALLS, svgUrl, loadImage, findBall, findEquipment } from "./puppetAssets.js";
import { packageFromImage, listSaved, savePackage, removeSaved, restorePackage } from "./puppetStore.js";
import { createUploader } from "./puppetUploader.js";
import { cleanImage } from "./rigEngine.js";
import { HandDriver } from "./handDriver.js";
import { RallyEngine, GUARDS } from "./rallyEngine.js";
import { solvePose, equipmentFrame } from "./poseSolver.js";
import { StageRenderer, PuppetSprite } from "./puppetRenderer.js";
import { Effects } from "./puppetEffects.js";
import { fetchExports, isLoggedIn, loadAccountImage } from "./accountImages.js";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EQUIP_K = 0.55;                         // tỉ lệ vẽ vợt / vũ khí (nhân thêm tỉ lệ phối cảnh theo độ sâu)
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const LOCKED = new Set(["climax", "finisher", "strike"]);   // đòn đặc biệt: giữ nguyên chỗ đứng (tay vung không được làm con rối trượt / đổi độ sâu)
const HOME = new Set(["idle", "countdown", "result"]);      // trước trận, lúc đếm 3-2-1 và sau trận: đứng đúng vị trí khởi tạo
const ACTIVE = new Set(["countdown", "serve", "rally", "point", "climax", "finisher", "strike"]);
const ICON_UP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M7 10l5-5 5 5M5 20h14"/></svg>';
const HEART = (on) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z" fill="${on ? "#e5598b" : "none"}" stroke="${on ? "#a8305f" : "#b9a6d6"}" stroke-width="2" stroke-linejoin="round"/></svg>`;
const S = {
  ready: false, running: false, initPromise: null,
  dom: null, renderer: null, driver: null, engine: null, fx: new Effects(), uploader: null,
  registry: new Map(), pkgCache: new Map(),         // con rối: id -> { id, name, thumb, load() }
  userId: null, userSprite: null, aiSprite: null,
  equip: { armR: "pingpong", armL: "sword" }, equipHand: "armL", equipImgs: new Map(), shieldImg: null,
  ballId: "pearl", ballImg: null, customBalls: [],
  raf: 0, last: 0, t: 0,
  // Vị trí con rối người chơi TRÊN MẶT SÀN: X = trái/phải, Y = độ sâu (y của đế giày; nhỏ = lùi vào trong). Độ cao khi bay là tham số RIÊNG (engine.user.jump).
  userX: L.USER_START_X, userY: L.STAND_Y, knockX: 0, knockTarget: 0, tgtF: {}, prevJ: null,
  rkPrev: null, rkVel: { x: 0, y: 0 },
  banner: { text: "", until: 0 }, shown: {}, paused: false,
};
/* ================================================================== */
/*  KHỞI TẠO                                                           */
/* ================================================================== */
export function initPuppetStage() {
  if (S.initPromise) return S.initPromise;
  S.initPromise = (async () => {
    const root = document.getElementById("tab-puppet-stage");
    if (!root) throw new Error("Puppet Stage markup (#tab-puppet-stage) not found");
    const q = (s) => root.querySelector(s);
    S.dom = {
      root, stage: q("#ps-stage"), canvas: q("#ps-canvas"), video: q("#ps-webcam"), camOverlay: q("#ps-cam-overlay"), live: q("#ps-live"),
      overlay: q("#ps-overlay"), ovTitle: q("#ps-overlay [data-title]"), ovText: q("#ps-overlay [data-text]"), ovBtn: q("#ps-overlay [data-act='start']"),
      hud: q("#ps-hud"), lives: q("#ps-lives"), su: q("#ps-score-user"), sa: q("#ps-score-ai"), energy: q("#ps-energy"), bannerEl: q("#ps-banner"), guard: q("#ps-guard"), tip: q("#ps-tip"),
      puppetTiles: q("#ps-sel-puppet .ps-tiles"), equipTiles: q("#ps-sel-equip .ps-tiles"), ballTiles: q("#ps-sel-ball .ps-tiles"),
      puppetName: q("#ps-puppet-name"), ballName: q("#ps-ball-name"), seg: q("#ps-sel-equip .ps-seg"),
    };
    // thanh "SWING" (hiện ở giai đoạn kết liễu) và danh sách luật chơi trên màn chờ – tạo bằng JS nên không phải sửa index.html
    S.dom.swing = document.createElement("div");
    S.dom.swing.className = "ps-swing"; S.dom.swing.hidden = true;
    S.dom.swing.innerHTML = `<span>${WEAPON_FINGER.toUpperCase()} SWING</span><div class="ps-swing-bar"><i></i></div>`;
    S.dom.hud.appendChild(S.dom.swing); S.dom.swingFill = S.dom.swing.querySelector("i");
    const rules = document.createElement("ul");
    rules.className = "ps-ov-rules";
    rules.innerHTML = [
      "Hit the ball back with your <b>racket</b> – every good return charges <b>POWER</b>.",
      "When POWER is full (or you reach <b>match point</b>) your puppet leaps and the ball freezes in the air.",
      `Then flick or sweep your <b>${WEAPON_FINGER}</b> finger <b>left → right</b> to <b>throw your weapon</b>. Hit where the AI’s shield is <b>not</b> to win!`,
    ].map((t) => `<li>${t}</li>`).join("");
    S.dom.ovText.after(rules);
    S.renderer = new StageRenderer(S.dom.canvas);
    S.engine = new RallyEngine(onEvent);
    S.driver = new HandDriver({ video: S.dom.video, overlay: S.dom.camOverlay, onStatus: setStatus, external: true });
    S.driver.simArea = S.dom.stage;
    S.uploader = createUploader(S.dom.stage, { onUse: (pkg) => addCustomPuppet(pkg) });
    bindUi(root);
    // con rối + tài nguyên
    for (const p of PRESET_PUPPETS) registerPreset(p);
    for (const e of listSaved()) S.registry.set(e.id, { id: e.id, name: e.name, thumb: e.png, saved: true, load: async () => restorePackage(e) });
    renderPuppetTiles(); renderEquipTiles(); renderBallTiles();
    await Promise.all([S.renderer.loadBackground(), selectPuppet(PRESET_PUPPETS[0].id), loadAi(), loadShield(), selectBall("pearl", true), preloadEquip()]);
    S.ready = true;
    showOverlay("PUPPET STAGE", "Show your hand to the camera – your fingers pull the puppet’s strings.", "START");
  })();
  return S.initPromise;
}
function registerPreset(p) {
  S.registry.set(p.id, { id: p.id, name: p.name, thumb: svgUrl(p.svg), load: async () => packageFromImage(await loadImage(svgUrl(p.svg)), p.name).pkg });
}
async function loadAi() { S.aiSprite = new PuppetSprite(...spriteArgs(await packageFromImage(await loadImage(svgUrl(AI_PUPPET.svg)), AI_PUPPET.name).pkg)); }
const spriteArgs = (pkg) => [pkg.texture, pkg.rig, pkg.name];
async function loadShield() { S.shieldImg = await loadImage(svgUrl(EQUIPMENT.shield.svg)); }
async function preloadEquip() {
  const all = [...EQUIPMENT.racket, ...EQUIPMENT.weapon];
  await Promise.all(all.map(async (e) => S.equipImgs.set(e.id, await loadImage(svgUrl(e.svg)))));
}
/* ================================================================== */
/*  GIAO DIỆN: ô chọn con rối / trang bị / quả cầu                      */
/* ================================================================== */
function bindUi(root) {
  // nút mũi tên cuộn danh sách
  root.querySelectorAll(".ps-sel").forEach((sec) => {
    const tiles = sec.querySelector(".ps-tiles");
    sec.querySelectorAll(".ps-arrow").forEach((b) => b.addEventListener("click", () => tiles.scrollBy({ left: Number(b.dataset.dir) * tiles.clientWidth * 0.8, behavior: "smooth" })));
  });
  // chọn con rối / trang bị / bóng
  S.dom.puppetTiles.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { e.stopPropagation(); removeCustomPuppet(rm.dataset.rm); return; }
    const t = e.target.closest(".ps-tile"); if (!t) return;
    if (t.dataset.upload) S.uploader.open(); else selectPuppet(t.dataset.id);
  });
  S.dom.equipTiles.addEventListener("click", (e) => { const t = e.target.closest(".ps-tile"); if (t) { S.equip[S.equipHand] = t.dataset.id; renderEquipTiles(); } });
  S.dom.seg.addEventListener("click", (e) => { const b = e.target.closest("button[data-hand]"); if (!b) return; S.equipHand = b.dataset.hand; renderEquipTiles(); });
  S.dom.ballTiles.addEventListener("click", (e) => {
    const t = e.target.closest(".ps-tile"); if (!t) return;
    if (t.dataset.upload) openBallPicker(); else selectBall(t.dataset.id);
  });
  S.dom.ovBtn.addEventListener("click", startGame);
}
const tile = ({ id, label, img, selected, upload, removable }) =>
  `<button type="button" class="ps-tile${selected ? " is-selected" : ""}${upload ? " ps-tile--upload" : ""}" ${upload ? 'data-upload="1"' : `data-id="${esc(id)}"`} role="option" aria-selected="${!!selected}" title="${esc(label)}">
     ${upload ? `<span class="ps-tile-ico">${ICON_UP}</span>` : `<img src="${esc(img)}" alt="" draggable="false" />`}
     <span class="ps-tile-cap">${esc(label)}</span>${removable ? `<i class="ps-tile-rm" data-rm="${esc(id)}" role="button" aria-label="Remove">×</i>` : ""}
   </button>`;
function renderPuppetTiles() {
  const list = [...S.registry.values()];
  S.dom.puppetTiles.innerHTML = tile({ label: "T-POSE", upload: true }) + list.map((p) => tile({ id: p.id, label: p.name.replace(/^Paper /, ""), img: p.thumb, selected: p.id === S.userId, removable: p.custom || p.saved })).join("");
  const cur = S.registry.get(S.userId); S.dom.puppetName.textContent = (cur?.name || "").toUpperCase();
}
function renderEquipTiles() {
  const role = HAND_ROLES[S.equipHand], list = EQUIPMENT[role] || [];
  S.dom.equipTiles.innerHTML = list.map((e) => tile({ id: e.id, label: e.name, img: svgUrl(e.svg), selected: S.equip[S.equipHand] === e.id })).join("");
  S.dom.seg.querySelectorAll("button").forEach((b) => { const on = b.dataset.hand === S.equipHand; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", String(on)); });
}
function renderBallTiles() {
  const all = [...BALLS.map((b) => ({ id: b.id, name: b.name, img: svgUrl(b.svg) })), ...S.customBalls.map((b) => ({ id: b.id, name: b.name, img: b.url }))];
  S.dom.ballTiles.innerHTML = tile({ label: "UPLOAD", upload: true }) + all.map((b) => tile({ id: b.id, label: b.name.replace(/^Dragon /, ""), img: b.img, selected: b.id === S.ballId })).join("");
  S.dom.ballName.textContent = (all.find((b) => b.id === S.ballId)?.name || "").toUpperCase();
}
async function selectPuppet(id) {
  const entry = S.registry.get(id); if (!entry) return;
  let pkg = S.pkgCache.get(id);
  if (!pkg) { pkg = await entry.load(); S.pkgCache.set(id, pkg); }
  S.userId = id; S.userSprite = new PuppetSprite(...spriteArgs(pkg));
  renderPuppetTiles();
}
function addCustomPuppet(pkg) {
  S.pkgCache.set(pkg.id, pkg);
  S.registry.set(pkg.id, { id: pkg.id, name: pkg.name, thumb: pkg.texture.toDataURL("image/png"), custom: true, load: async () => pkg });
  savePackage(pkg); selectPuppet(pkg.id);
}
function removeCustomPuppet(id) {
  S.registry.delete(id); S.pkgCache.delete(id); removeSaved(id);
  if (S.userId === id) selectPuppet(PRESET_PUPPETS[0].id); else renderPuppetTiles();
}
async function selectBall(id, silent) {
  const custom = S.customBalls.find((b) => b.id === id);
  S.ballId = id;
  S.ballImg = custom ? await loadImage(custom.url) : await loadImage(svgUrl(findBall(id).svg));
  if (!silent || S.dom) renderBallTiles();
}
/* ---- chọn bóng/vật phẩm từ file hoặc My 2D Exports ---- */
function openBallPicker() {
  const ov = document.createElement("div");
  ov.className = "ps-up"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
  ov.innerHTML = `<div class="ps-up-card ps-up-card--small"><div class="ps-up-head"><span class="ps-up-title">CHOOSE A BALL / ITEM</span><button type="button" class="ps-up-x" data-x aria-label="Close">×</button></div>
    <div class="ps-up-body ps-up-body--single"><section class="ps-up-work">
      <div class="ps-up-drop"><span class="ps-up-drop-ico">${ICON_UP}</span><p>Any picture works – the background is removed automatically.</p>
        <div class="ps-up-btns"><button type="button" class="ps-btn" data-file>Choose file</button><button type="button" class="ps-btn ps-btn--ghost" data-exp>My 2D exports</button></div>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden /></div>
      <div class="ps-up-exports" hidden></div></section></div>
    <div class="ps-up-foot"><span class="ps-up-status" data-s></span></div></div>`;
  S.dom.stage.appendChild(ov);
  const close = () => ov.remove(), status = ov.querySelector("[data-s]"), input = ov.querySelector("input"), exp = ov.querySelector(".ps-up-exports"), drop = ov.querySelector(".ps-up-drop");
  const take = async (img, name) => {
    try {
      const c = cleanImage(img, 160).canvas, side = Math.max(c.width, c.height), out = document.createElement("canvas");
      out.width = out.height = 128; const g = out.getContext("2d"), k = 116 / side;
      g.drawImage(c, (128 - c.width * k) / 2, (128 - c.height * k) / 2, c.width * k, c.height * k);
      const item = { id: "cb" + Date.now().toString(36), name: (name || "My item").slice(0, 16), url: out.toDataURL("image/png") };
      S.customBalls = [item, ...S.customBalls].slice(0, 4);
      await selectBall(item.id); close();
    } catch { status.textContent = "Could not use this picture."; }
  };
  ov.addEventListener("click", async (e) => {
    if (e.target === ov || e.target.closest("[data-x]")) return close();
    if (e.target.closest("[data-file]")) return input.click();
    const tileBtn = e.target.closest("[data-url]");
    if (tileBtn) { status.textContent = "Loading…"; try { await take(await loadAccountImage(tileBtn.dataset.url), tileBtn.dataset.name); } catch { status.textContent = "Could not load that picture."; } return; }
    if (e.target.closest("[data-back]")) { exp.hidden = true; drop.hidden = false; return; }
    if (e.target.closest("[data-exp]")) {
      drop.hidden = true; exp.hidden = false;
      const back = '<button type="button" class="ps-btn ps-btn--ghost" data-back>Back</button>';
      if (!isLoggedIn()) { exp.innerHTML = `<p class="ps-up-empty">Log in to use your 2D exports.</p>${back}`; return; }
      exp.innerHTML = '<p class="ps-up-empty">Loading…</p>';
      try {
        const items = await fetchExports();
        exp.innerHTML = items.length ? `<div class="ps-up-grid">${items.map((i) => `<button type="button" class="ps-up-tile" data-url="${esc(i.url)}" data-name="${esc(i.name)}"><img src="${esc(i.thumb)}" alt="" loading="lazy"><span>${esc(i.name)}</span></button>`).join("")}</div>${back}` : `<p class="ps-up-empty">No exports yet.</p>${back}`;
      } catch { exp.innerHTML = `<p class="ps-up-empty">Could not load your exports.</p>${back}`; }
    }
  });
  input.addEventListener("change", async () => {
    const f = input.files[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    try { await take(await loadImage(url), f.name.replace(/\.[^.]+$/, "")); } catch { status.textContent = "Could not open this picture."; } finally { URL.revokeObjectURL(url); }
  });
  ov.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  ov.querySelector(".ps-up-x").focus();
}
/* ================================================================== */
/*  VÒNG ĐỜI                                                           */
/* ================================================================== */
export async function startPuppetStage() {
  await initPuppetStage();
  if (S.running) return;
  S.running = true; S.last = performance.now();
  S.driver.start();                              // camera + MediaPipe (hoặc chuột nếu không có camera)
  S.raf = requestAnimationFrame(frame);
}
export function stopPuppetStage() {
  if (!S.initPromise) return;
  S.running = false; cancelAnimationFrame(S.raf);
  S.driver?.stop();
  S.engine?.reset(); S.fx.clear(); resetPositions();
  S.uploader?.close();
  if (S.dom) { setLive("off", "OFF"); showOverlay("PUPPET STAGE", "Show your hand to the camera – your fingers pull the puppet’s strings.", "START"); S.dom.hud.hidden = true; }
}
function startGame() {
  if (!S.ready) return;
  S.fx.clear(); resetPositions(); S.engine.start();
  S.dom.overlay.hidden = true; S.dom.hud.hidden = false; S.dom.guard.hidden = true;
  S.dom.tip.textContent = S.driver.mode === "sim" ? "Mouse mode: move the mouse, Space = swing, keys 1-5 fold a finger" : "Move your hand – each finger pulls one of the puppet’s limbs";
  updateHud(true);
}
/** Đưa MỌI trạng thái di chuyển về điểm xuất phát: vị trí, độ sâu, lực giật lùi, bộ lọc tay, bộ nhớ khuỷu, vận tốc vợt (độ cao / vũ khí / hoạt ảnh tấn công do engine.reset() lo) */
function resetPositions() {
  S.userX = L.USER_START_X; S.userY = L.STAND_Y; S.knockX = 0; S.knockTarget = 0;
  S.tgtF = {}; S.prevJ = null; S.rkPrev = null; S.rkVel = { x: 0, y: 0 };
}
function showOverlay(title, text, btn, mode = "idle") {
  S.dom.ovTitle.textContent = title; S.dom.ovText.textContent = text; S.dom.ovBtn.textContent = btn;
  S.dom.overlay.dataset.mode = mode;                 // "idle" hiện luật chơi, "result" thì ẩn
  S.dom.overlay.hidden = false;
}
function setLive(state, text) { S.dom.live.dataset.state = state; S.dom.live.querySelector("b").textContent = text; }
function setStatus(text, level) {
  if (!S.dom) return;
  S.dom.tip.textContent = text;
  if (S.driver.mode === "camera") setLive("on", "LIVE"); else if (S.driver.mode === "sim") setLive("sim", "MOUSE"); else setLive(level === "error" ? "off" : "wait", level === "error" ? "NO CAM" : "…");
}
/* ================================================================== */
/*  SỰ KIỆN TỪ ENGINE                                                  */
/* ================================================================== */
function say(text, sec = 1) { S.banner = { text, until: S.t + sec }; }
function onEvent(type, d) {
  const fx = S.fx;
  switch (type) {
    case "countdown": say(String(d.n), 0.95); break;
    case "serve": say("RALLY!", 0.8); break;
    case "hit": fx.hit(d.x, d.y, d.power); fx.float(d.x, d.y - 24, "+" + d.gain, "#fff3b0"); break;
    case "aiReturn": fx.hit(d.x, d.y, 0.6, "#ffd0a0"); break;
    case "bounce": fx.bounce(d.x, d.y); break;
    case "point": say(d.who === "user" ? "POINT!" : "MISS!", 1.2); S.dom.tip.textContent = d.reason; updateHud(true); break;
    case "climax": say(d.reason === "match" ? "MATCH POINT!" : "POWER FULL!", 1.4); break;
    case "finisherStart": say("SWING NOW!  →", 99); S.dom.guard.hidden = false; S.dom.tip.textContent = `Flick or sweep your ${WEAPON_FINGER.toUpperCase()} finger LEFT → RIGHT to THROW your weapon. Aim up / across / down – hit where the shield is NOT.`; S.dom.swing.hidden = false; paintGuard(S.engine.ai.guard); break;
    case "guard": paintGuard(d.guard); break;
    case "strike": say("THROW!", 0.7); S.dom.swing.hidden = true; break;
    case "release": fx.hit(d.x, d.y, 0.5, "#ffe9a8"); break;                                   // vũ khí rời tay
    case "impact": fx.clash(d.x, d.y, -1, d.blocked ? "#fff6c8" : "#ffd0a0"); break;           // va chạm với khiên / thân đối thủ
    case "blocked": say("BLOCKED!", 1.2); S.knockTarget = -60; break;                           // bị đánh bật -> con rối giật lùi một chút
    case "catch": fx.hit(d.x, d.y, 0.35, "#fff1b0"); break;                                    // vũ khí về tay
    case "land": fx.dust(S.userX + S.knockX, S.userY, depthScale(S.userY)); break;             // tiếp đất sau đòn bay
    case "shatter": say("K.O.!", 1.4); { const a = S.engine.ai; fx.shards(L.AI_X + a.knockX, 700, 150, 320, ["#c9a46a", "#7b3d2c", "#e8dccb", "#2a1a14"]); } break;
    case "fizzle": say("TOO SLOW…", 1.2); S.dom.guard.hidden = true; S.dom.swing.hidden = true; S.dom.tip.textContent = "Keep rallying to charge the power bar again"; break;
    case "result":
      S.knockTarget = 0;                                                                     // hai con rối về vị trí khởi tạo trong lúc hiện kết quả
      S.dom.guard.hidden = true; S.dom.swing.hidden = true; S.dom.tip.textContent = "";
      if (d.kind === "win") fx.confetti(1484, 1060, ["#ffd34d", "#e9895f", "#8a78c0", "#6fae8a", "#f59fc0"]);
      showOverlay(d.kind === "win" ? "YOU WIN!" : "GAME OVER", d.reason + ` · Score ${d.score.user}–${d.score.ai}`, "PLAY AGAIN", "result");
      break;
    default: break;
  }
}
function paintGuard(g) { S.dom.guard.querySelectorAll("[data-g]").forEach((n) => n.classList.toggle("is-guarded", Number(n.dataset.g) === g)); }
function updateHud(force) {
  const e = S.engine, sh = S.shown;
  if (force || sh.lives !== e.lives) { S.dom.lives.innerHTML = Array.from({ length: 3 }, (_, i) => HEART(i < e.lives)).join(""); sh.lives = e.lives; }
  if (force || sh.su !== e.score.user) { S.dom.su.textContent = e.score.user; sh.su = e.score.user; }
  if (force || sh.sa !== e.score.ai) { S.dom.sa.textContent = e.score.ai; sh.sa = e.score.ai; }
  const en = Math.round(e.energy); if (force || sh.en !== en) { S.dom.energy.style.width = en + "%"; S.dom.energy.parentElement.classList.toggle("is-full", en >= 100); sh.en = en; }
}
/* ================================================================== */
/*  MỖI KHUNG HÌNH                                                     */
/* ================================================================== */

/** Đo hiệu năng (chỉ in khi bạn gõ  window.__psDebug = true  trong Console) */
const PERF = { n: 0, ms: 0, t: 0 };
function perfProbe(ms) {
  PERF.n++; PERF.ms += ms;
  const now = performance.now();
  if (!PERF.t) { PERF.t = now; return; }
  if (now - PERF.t < 2000) return;
  const sec = (now - PERF.t) / 1000, d = S.driver;
  if (window.__psDebug && d) console.log(`[Puppet] ${(PERF.n / sec).toFixed(0)} khung/s | mỗi khung ${(PERF.ms / PERF.n).toFixed(1)} ms | nhận diện ${d.detMs.toFixed(1)} ms x ${(d.detN / sec).toFixed(0)}/s | ${d.delegate || d.mode}`);
  PERF.n = 0; PERF.ms = 0; PERF.t = now; if (d) d.detN = 0;
}
const V0 = { thumb: { x: -1.1, y: -0.7 }, index: { x: -0.5, y: -2.3 }, middle: { x: 0, y: -2.5 }, ring: { x: 0.5, y: -2.2 }, pinky: { x: 1.0, y: -1.7 } };
function frame(now) {
  if (!S.running) return;
  S.raf = requestAnimationFrame(frame);
  const tF = performance.now();
  const dt = Math.min(0.05, (now - S.last) / 1000); S.last = now; S.t += dt;
  if (!S.ready || !S.userSprite || !S.aiSprite) return;
  const h = S.driver, eng = S.engine;
  h.tick();
  // --- tạm dừng khi mất bàn tay giữa trận ---
  const lost = ACTIVE.has(eng.phase) && !h.present && h.lostForMs > TRACKING.LOST_MS && S.driver.mode === "camera";
  if (lost !== S.paused) { S.paused = lost; if (lost) say("SHOW YOUR HAND", 999); else S.banner.until = 0; }
  const user = buildUser(h, dt);
  S.dbg = user;                                          // để debug/test
  const swing = h.consumeSwing();                       // luôn xả cú vung để không bị "tồn" sang giai đoạn sau
  if (!S.paused) {
    eng.update(dt, { racket: user.racket, swing: eng.phase === "finisher" ? swing : null, weapon: user.weapon });
    S.fx.update(dt);
    const w = eng.weapon;
    if (w.state === "fly" && Math.random() < 0.7) S.fx.trail(w.x, w.y);               // tia lửa dọc đường bay
  }
  updateHud(false);
  if (!S.dom.swing.hidden) { const pct = Math.round(clamp(h.swingLevel, 0, 1) * 100); if (S.shown.sw !== pct) { S.shown.sw = pct; S.dom.swingFill.style.width = pct + "%"; } }
  if (S.banner.until && S.t > S.banner.until) S.banner.until = 0;
  const bt = S.banner.until ? S.banner.text : "";
  if (S.shown.banner !== bt) { S.shown.banner = bt; S.dom.bannerEl.textContent = bt; S.dom.bannerEl.classList.toggle("is-on", !!S.banner.until); }
  const ai = buildAi(dt);
  const sh = eng.shake > 0 ? { x: (Math.random() - 0.5) * 18 * eng.shake, y: (Math.random() - 0.5) * 18 * eng.shake } : null;
  const hs = handShadow(h, user.pose);
  S.renderer.render({
    dim: eng.phase === "finisher" || eng.phase === "strike" || eng.phase === "climax" ? 0.18 : 0,
    overlayGlow: eng.phase === "finisher" ? 1 : 0, shake: sh,
    hand: hs?.hand, strings: hs?.strings,
    puppets: [ai.view, user.view],
    ball: eng.ball, ballImg: S.ballImg, thrown: user.thrown, fx: S.fx,
  });
  perfProbe(performance.now() - tF);
}
/** Bộ lọc One-Euro: đứng yên -> mượt, vung nhanh -> bám sát (khử rung do nhiễu camera) */
function smoothTarget(store, key, p, dt) {
  const d = Math.min(0.1, Math.max(dt, 1 / 120));
  const lp = (a, prev, x) => prev + a * (x - prev);
  const alpha = (fc) => 1 / (1 + 1 / (2 * Math.PI * fc * d));
  const st = store[key];
  if (!st) { store[key] = { x: p.x, y: p.y, rx: p.x, ry: p.y, dx: 0, dy: 0 }; return { x: p.x, y: p.y }; }
  st.dx = lp(alpha(1), st.dx, (p.x - st.rx) / d); st.dy = lp(alpha(1), st.dy, (p.y - st.ry) / d);
  st.rx = p.x; st.ry = p.y;
  const a = alpha(TRACKING.TARGET_MIN_CUTOFF + TRACKING.TARGET_BETA * Math.hypot(st.dx, st.dy));
  st.x = lp(a, st.x, p.x); st.y = lp(a, st.y, p.y);
  return { x: st.x, y: st.y };
}
/** Tâm thân vũ khí (điểm nó xoay quanh khi bay) tính từ khung đang cầm trên tay */
function weaponCenter(fr, spec) {
  const mid = spec.tip ? [(spec.grip[0] + spec.tip[0]) / 2, (spec.grip[1] + spec.tip[1]) / 2] : spec.grip;
  const dx = (mid[0] - spec.grip[0]) * fr.k, dy = (mid[1] - spec.grip[1]) * fr.k, c = Math.cos(fr.angle), sn = Math.sin(fr.angle);
  return { x: fr.grip.x + dx * c - dy * sn, y: fr.grip.y + dx * sn + dy * c };
}
/** Con rối người chơi: bàn tay -> tư thế */
function buildUser(h, dt) {
  const sp = S.userSprite, eng = S.engine, rig = sp.rig, present = h.present || h.mode === "sim";
  const ph = eng.phase, locked = LOCKED.has(ph), home = HOME.has(ph);
  // --- VỊ TRÍ TRÊN MẶT SÀN: bàn tay ngang -> trái/phải, bàn tay dọc -> vào trong / ra trước. Bàn tay KHÔNG tác động tới độ cao. ---
  let t = 0.5, ty = L.STAND_Y;
  if (home || !present) { t = (L.USER_START_X - userWalkX(L.STAND_Y).min) / (userWalkX(L.STAND_Y).max - userWalkX(L.STAND_Y).min); }
  else if (!locked) {
    const [r0, r1] = TRACKING.ROOT_X_RANGE, [y0, y1] = TRACKING.ROOT_Y_RANGE;
    t = clamp((h.palm.x - r0) / (r1 - r0), 0, 1);
    ty = lerp(L.DEPTH_Y_MIN, L.DEPTH_Y_MAX, clamp((h.palm.y - y0) / (y1 - y0), 0, 1));       // tay cao = lùi vào trong, tay thấp = tiến ra
  }
  if (!locked) {
    let tx;
    if (home || !present) tx = L.USER_START_X;
    else { const rg = userWalkX(ty); tx = lerp(rg.min, rg.max, t); }                           // dùng trọn tầm tay trong phần sàn cho phép ở độ sâu này
    S.userX += (tx - S.userX) * Math.min(1, dt * (home ? 5 : TRACKING.FOLLOW_X));
    S.userY += ((home || !present ? L.STAND_Y : ty) - S.userY) * Math.min(1, dt * (home ? 5 : TRACKING.FOLLOW_Y));
  }
  S.knockX += (S.knockTarget - S.knockX) * Math.min(1, dt * (ph === "result" ? 5 : 12));
  const wr = userWalkX(S.userY);
  S.userX = clamp(S.userX, wr.min, wr.max);
  const x = clamp(S.userX + S.knockX, wr.min - 10, wr.max);
  const k = depthScale(S.userY), s = sp.scale * k, ek = EQUIP_K * k;                           // phối cảnh: càng vào trong càng nhỏ
  const jump = locked ? eng.user.jump : 0;                                                     // chỉ đòn tấn công đặc biệt mới được rời mặt đất
  const root = { x, y: S.userY - sp.hipToFeet * k - jump };
  const lean = present ? clamp(h.roll * 0.9, -0.5, 0.5) : Math.sin(S.t * 1.3) * 0.03;
  const base = solvePose(rig, { scale: s, root, lean });
  const J = base.joints, vec = present ? h.vec : V0;
  // Mỗi ngón điều khiển bộ phận nào do LIMB_BY_FINGER (puppetConfig.js) quyết định.
  const gain = (r) => (r / TRACKING.FINGER_REACH) * 1.5;
  const rArm = { armR: base.reach.armR, armL: base.reach.armL }, lg = base.reach.legR;
  const sh = { armR: J.shoulderR, armL: J.shoulderL }, hp = { legR: J.hipR, legL: J.hipL };
  const targets = {};
  for (const [finger, limb] of Object.entries(LIMB_BY_FINGER)) {
    if (limb === "head") continue;
    const v = vec[finger], v0 = V0[finger], g = FINGER_GAIN[finger] || 1;
    if (limb.startsWith("arm")) {
      const role = HAND_ROLES[limb], out = limb === "armR" ? -1 : 1;
      const neutral = role === "racket" ? { x: 0.74 * out, y: 0.16 } : { x: 0.5 * out, y: -0.6 };
      targets["wrist" + limb.slice(3)] = { x: sh[limb].x + neutral.x * rArm[limb] + (v.x - v0.x) * gain(rArm[limb]) * g, y: sh[limb].y + neutral.y * rArm[limb] + (v.y - v0.y) * gain(rArm[limb]) * g };
    } else {
      const side = limb === "legR" ? -0.1 : 0.1;
      targets["ankle" + limb.slice(3)] = { x: hp[limb].x + side * lg + (v.x - v0.x) * 0.22 * lg * g, y: hp[limb].y + 0.97 * lg + (v.y - v0.y) * 0.18 * lg * g };
    }
  }
  // làm mượt mục tiêu theo vị trí TƯƠNG ĐỐI so với vai/hông (để tay không bị tụt lại khi thân di chuyển)
  const anchor = { wristR: J.shoulderR, wristL: J.shoulderL, ankleR: J.hipR, ankleL: J.hipL };
  for (const key of Object.keys(targets)) {
    if (ph === "strike") { delete S.tgtF[key]; continue; }                                    // lúc quất tay giữ nguyên, không trễ
    const a = anchor[key], q = smoothTarget(S.tgtF, key, { x: targets[key].x - a.x, y: targets[key].y - a.y }, dt);
    targets[key] = { x: a.x + q.x, y: a.y + q.y };
  }
  const wArm = armWithRole("weapon");
  if (eng.user.strikeT >= 0 && ph === "strike") {                    // tay cầm vũ khí quất ra trước (vũ khí rời tay giữa chừng), rồi dần hạ về tư thế thường
    const p = ease(eng.user.strikeT), hgt = eng.user.strikeHeight, r = rArm[wArm], key = "wrist" + wArm.slice(3);
    const end = [{ x: 2.0, y: -0.6 }, { x: 2.1, y: 0.2 }, { x: 1.9, y: 0.95 }][hgt];
    const sweep = { x: sh[wArm].x + lerp(-0.4, end.x, p) * r, y: sh[wArm].y + lerp(-1.3, end.y, p) * r - Math.sin(Math.PI * p) * 0.25 * r };
    const rc = ease(eng.user.recover), nt = targets[key];
    targets[key] = { x: lerp(sweep.x, nt.x, rc), y: lerp(sweep.y, nt.y, rc) };
  }
  const mid = vec[fingerOfLimb("head")] || vec.middle;
  const pose = solvePose(rig, {
    scale: s, root, lean,
    headTilt: present ? clamp(mid.x * 0.25, -0.45, 0.45) : 0,
    headBob: present ? clamp((-mid.y - 2.4) * 10, -12, 12) : 0,
    targets, prev: S.prevJ,
  });
  S.prevJ = pose.joints;
  // --- vợt / vũ khí ---
  const equip = [], racketArm = Object.keys(HAND_ROLES).find((a) => HAND_ROLES[a] === "racket");
  let racket = null, weapon = null, thrown = null;
  const swinging = ph === "strike" || ph === "finisher" || ph === "climax";
  for (const arm of Object.keys(HAND_ROLES)) {
    const kind = HAND_ROLES[arm], spec = findEquipment(kind, S.equip[arm]); if (!spec) continue;
    const side = arm === "armR" ? "R" : "L";
    const wrist = pose.joints["wrist" + side], elbow = pose.joints["elbow" + side], dir = Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x);
    const fr = kind === "racket"
      ? equipmentFrame(pose, side, spec, ek, clamp(0.4 * (dir + Math.PI / 2), -0.9, 0.9), true)   // vợt luôn dựng gần thẳng đứng
      : swinging
        ? equipmentFrame(pose, side, spec, ek, 0.35)
        : equipmentFrame(pose, side, spec, ek, clamp(0.55 * wrapPi(dir + Math.PI / 2), -1.0, 1.0), true);   // lúc thường: lưỡi kiếm kéo gần phương thẳng đứng
    if (kind === "weapon") {
      const c = weaponCenter(fr, spec);
      weapon = { x: c.x, y: c.y, angle: fr.angle, k: fr.k };                                     // engine cần để biết ném từ đâu và đón về đâu
      const w = eng.weapon;
      if (w.state !== "held") thrown = { img: S.equipImgs.get(spec.id), spec, x: w.x, y: w.y, angle: w.angle, k: w.k, glow: w.state === "fly" ? 0.9 : 0.4, trail: w.trail };
      else equip.push({ img: S.equipImgs.get(spec.id), spec, frame: fr });
    } else equip.push({ img: S.equipImgs.get(spec.id), spec, frame: fr });
    if (arm === racketArm && fr.head) {
      if (S.rkPrev && dt > 0) {
        const vx = (fr.head.x - S.rkPrev.x) / dt, vy = (fr.head.y - S.rkPrev.y) / dt;
        S.rkVel.x += (vx - S.rkVel.x) * 0.5; S.rkVel.y += (vy - S.rkVel.y) * 0.5;
      }
      S.rkPrev = { x: fr.head.x, y: fr.head.y };
      racket = { x: fr.head.x, y: fr.head.y, vx: S.rkVel.x, vy: S.rkVel.y };
    }
  }
  return { pose, racket: present ? racket : null, weapon, thrown, view: { sprite: sp, pose, equip, flash: eng.user.flash, floorY: S.userY, k, lift: jump } };
}
/** Con rối AI: tự động theo engine – luôn đứng đúng một chỗ trên mặt sàn (không nhún lên) */
function buildAi(dt) {
  const sp = S.aiSprite, eng = S.engine, a = eng.ai, k = depthScale(L.STAND_Y), s = sp.scale * k;
  const root = { x: L.AI_X + a.knockX - a.recoil * 22, y: L.STAND_Y - sp.hipToFeet * k };
  const base = solvePose(sp.rig, { scale: s, root });
  const J = base.joints, r = base.reach.armL;
  const pose = solvePose(sp.rig, {
    scale: s, root, lean: -0.03 + Math.sin(S.t * 1.7) * 0.02,
    targets: { wristR: { x: a.shieldX - 6, y: a.shieldY }, wristL: { x: J.shoulderL.x + 0.5 * r + Math.sin(S.t * 2.2) * 8, y: J.shoulderL.y + 0.7 * r } },
  });
  const frame0 = equipmentFrame(pose, "R", EQUIPMENT.shield, 0.62 * k, 0, true);
  return { pose, view: { sprite: sp, pose, alpha: a.shattered ? 0 : 1, flash: a.flash, floorY: L.STAND_Y, k, lift: 0, equip: a.shattered ? [] : [{ img: S.shieldImg, spec: EQUIPMENT.shield, frame: frame0, glow: a.flash }] } };
}
/** Bóng bàn tay khổng lồ hắt lên phông + dây nối tới các khớp con rối */
function handShadow(h, pose) {
  if (!h.present && h.mode !== "sim") return null;
  const U = 78, cx = S.userX + 70, cy = 210, pts = h.lm.map((p) => ({ x: cx + (p.x - h.palm.x) / h.hs * U, y: cy + (p.y - h.palm.y) / h.hs * U }));
  const J = pose.joints, joint = { head: J.head, armR: J.wristR, armL: J.wristL, legR: J.ankleR, legL: J.ankleL };
  return {
    hand: { pts, unit: U * 0.5, alpha: 1 },
    strings: Object.entries(LIMB_BY_FINGER).map(([finger, limb]) => ({ from: pts[FINGERS[finger].tip], to: joint[limb] })),
  };
}
export const __puppetState = S;            // chỉ để debug/test

window.__ps = __puppetState;