// frontend/src/components/puppet/puppetUploader.js
// UPLOADER: bảng hướng dẫn chuẩn bị ảnh -> chọn ảnh (file / kéo thả / My 2D Exports) -> làm sạch + tự đặt điểm neo
// -> kiểm tra hợp lệ -> chỉnh tay bằng RigEditor + xem thử con rối cử động -> "Use this puppet".
import { fetchExports, loadAccountImage, isLoggedIn } from "./accountImages.js";
import { PRESET_PUPPETS, svgUrl, loadImage } from "./puppetAssets.js";
import { cleanImage, analyzeRig, validatePuppet } from "./rigEngine.js";
import { RigEditor } from "./rigEditor.js";
import { makePackage } from "./puppetStore.js";
import { solvePose } from "./poseSolver.js";
import { PuppetSprite, drawPuppet } from "./puppetRenderer.js";
import { PUPPET_VIEW } from "./puppetConfig.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---- hình minh hoạ "đúng / sai" cho bảng hướng dẫn (nét đơn giản, không cần file ảnh) ---- */
function stick({ arms = "out", legs = "apart", crop = false, busy = false }) {
  const arm = arms === "out" ? '<path d="M14 36 L66 36"/>' : '<path d="M30 36 L24 70 M50 36 L56 70"/>';
  const leg = legs === "apart" ? '<path d="M40 62 L30 100 M40 62 L50 100"/>' : '<path d="M40 62 L40 100"/>';
  const bg = busy ? '<g stroke="#c9b3e8" stroke-width="2" fill="none"><path d="M2 20 L22 4 M60 6 L78 24 M2 80 L18 96 M62 92 L78 74"/></g>' : "";
  const cut = crop ? '<rect x="0" y="84" width="80" height="20" fill="#fff"/>' : "";
  return `<svg viewBox="0 0 80 104" class="ps-ex-svg" aria-hidden="true">${bg}<g stroke="#6e5e9c" stroke-width="5" stroke-linecap="round" fill="none"><circle cx="40" cy="16" r="9" fill="#fff"/><path d="M40 26 L40 62"/>${arm}${leg}</g>${cut}</svg>`;
}
const EXAMPLES = [
  { ok: true, label: "Good", html: `<img src="${svgUrl(PRESET_PUPPETS[0].svg)}" alt="Good example: T-pose" />` },
  { ok: false, label: "Arms down", html: stick({ arms: "down" }) },
  { ok: false, label: "Legs together", html: stick({ legs: "together" }) },
  { ok: false, label: "Cut off / busy", html: stick({ crop: true, busy: true }) },
];
const ICON_UP = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M7 10l5-5 5 5M5 20h14"/></svg>';

export function createUploader(host, { onUse } = {}) {
  const root = document.createElement("div");
  root.className = "ps-up";
  root.hidden = true;
  root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Upload your puppet");
  root.innerHTML = `
  <div class="ps-up-card">
    <div class="ps-up-head"><span class="ps-up-title">UPLOAD YOUR PUPPET</span><button type="button" class="ps-up-x" data-act="close" aria-label="Close">×</button></div>
    <div class="ps-up-body">
      <aside class="ps-up-guide">
        <h4>HOW TO PREPARE THE PICTURE</h4>
        <div class="ps-up-examples">${EXAMPLES.map((e) => `<figure class="ps-ex ${e.ok ? "is-ok" : "is-bad"}"><div class="ps-ex-pic">${e.html}<span class="ps-ex-badge">${e.ok ? "✓" : "✕"}</span></div><figcaption>${e.label}</figcaption></figure>`).join("")}</div>
        <ul class="ps-up-rules">
          <li>Full body, standing, front view</li>
          <li><b>T-pose</b>: arms stretched out sideways</li>
          <li>Head, both arms and both legs visible – legs <b>not</b> touching</li>
          <li>Transparent or plain white background</li>
          <li>At least ${PUPPET_VIEW.MIN_SIDE}px on the short side (PNG is best)</li>
        </ul>
      </aside>
      <section class="ps-up-work">
        <div class="ps-up-drop" data-drop tabindex="0">
          <span class="ps-up-drop-ico">${ICON_UP}</span>
          <p>Drop a picture here</p>
          <div class="ps-up-btns">
            <button type="button" class="ps-btn" data-act="file">Choose file</button>
            <button type="button" class="ps-btn ps-btn--ghost" data-act="exports">My 2D exports</button>
          </div>
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-file />
        </div>
        <div class="ps-up-exports" data-exports hidden></div>
        <div class="ps-up-editor" data-editor hidden>
          <div class="ps-up-canvases">
            <div class="ps-up-edit-wrap"><canvas data-edit aria-label="Rig editor – drag the dots"></canvas><span class="ps-up-cap">Drag the dots to fix joints</span></div>
            <div class="ps-up-prev-wrap"><canvas data-prev aria-label="Live test of the rig"></canvas><span class="ps-up-cap">Live test</span></div>
          </div>
          <section class="ps-report" data-report hidden aria-live="polite">
            <header class="ps-report-head"><span class="ps-report-title">PICTURE CHECK</span><span class="ps-report-chip" data-chip></span></header>
            <ul class="ps-report-list" data-checks></ul>
          </section>
          <div class="ps-up-row">
            <label class="ps-up-field">Name <input type="text" maxlength="24" data-name placeholder="My Puppet" /></label>
            <label class="ps-up-check"><input type="checkbox" data-mirror checked /> Mirror left / right</label>
          </div>
        </div>
      </section>
    </div>
    <div class="ps-up-foot">
      <span class="ps-up-status" data-status aria-live="polite"></span>
      <button type="button" class="ps-btn ps-btn--ghost" data-act="redo" hidden>Auto-detect again</button>
      <button type="button" class="ps-btn ps-btn--primary" data-act="use" disabled>Use this puppet</button>
    </div>
  </div>`;
  host.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const el = { report: $("[data-report]"), chip: $("[data-chip]"), drop: $("[data-drop]"), file: $("[data-file]"), exports: $("[data-exports]"), editor: $("[data-editor]"), edit: $("[data-edit]"), prev: $("[data-prev]"), checks: $("[data-checks]"), name: $("[data-name]"), mirror: $("[data-mirror]"), status: $("[data-status]"), redo: $('[data-act="redo"]'), use: $('[data-act="use"]') };
  const st = { img: null, clean: null, rig: null, report: null, sprite: null, raf: 0, name: "", busy: false };
  const editor = new RigEditor(el.edit, { onChange: () => { st.dirty = true; } });
  const say = (t, level = "") => { el.status.textContent = t; el.status.dataset.level = level; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CK_ICON = { ok: "✓", warn: "!", error: "✕" };
  const BUSY_STEPS = ["Reading your picture", "Removing the background", "Finding head and arms", "Finding both legs", "Placing the joints"];
  /** Đang phân tích: các bước hiện lần lượt kèm vòng xoay */
  function showAnalyzing() {
    el.report.hidden = false; el.report.dataset.state = "busy"; delete el.report.dataset.level;
    el.chip.textContent = "Analysing…";
    el.checks.innerHTML = BUSY_STEPS.map((t, n) => `<li class="ps-ck is-busy" style="--i:${n}"><span class="ps-ck-ico"><i class="ps-spin"></i></span><span class="ps-ck-txt">${t}…</span></li>`).join("");
  }
  /** Có kết quả: từng dòng hiện dần (CSS animation-delay theo --i), cuối cùng huy hiệu tổng kết hiện ra */
  function showReport(items) {
    const worst = items.some((i) => i.level === "error") ? "error" : items.some((i) => i.level === "warn") ? "warn" : "ok";
    el.report.hidden = false; el.report.dataset.state = "done"; el.report.dataset.level = worst;
    el.report.style.setProperty("--n", items.length);
    el.chip.textContent = worst === "ok" ? "All good" : worst === "warn" ? "Almost there" : "Needs a fix";
    el.checks.innerHTML = items.map((i, n) => `<li class="ps-ck is-${i.level}" style="--i:${n}"><span class="ps-ck-ico" aria-hidden="true">${CK_ICON[i.level]}</span><span class="ps-ck-txt">${esc(i.text)}</span></li>`).join("");
  }

  /* ------------------------------------------------------------ */
  function showSource() { el.drop.hidden = false; el.editor.hidden = true; el.exports.hidden = true; el.redo.hidden = true; el.use.disabled = true; stopPreview(); say(""); }

  async function process(img, name) {
    if (st.busy) return; st.busy = true; say("Analysing the picture…", "info");
    const t0 = performance.now();
    try {
      el.drop.hidden = true; el.exports.hidden = true; el.editor.hidden = false; el.redo.hidden = true; el.use.disabled = true;
      stopPreview(); showAnalyzing();
      await sleep(60);                                        // cho giao diện kịp vẽ khung phân tích
      st.img = img; st.name = name || "My Puppet";
      st.clean = cleanImage(img);
      await redetect(t0);
    } catch (e) { console.warn(e); showSource(); say("Could not read this picture.", "error"); }
    finally { st.busy = false; }
  }
  async function redetect(t0 = 0) {
    if (t0) await sleep(50);
    const id = st.clean.canvas.getContext("2d").getImageData(0, 0, st.clean.canvas.width, st.clean.canvas.height);
    const { rig, report } = analyzeRig(id);
    st.rig = rig; st.report = report;
    st.sprite = new PuppetSprite(st.clean.canvas, rig);
    const v = validatePuppet({ clean: st.clean, report, rig });
    if (t0) await sleep(Math.max(0, 900 - (performance.now() - t0)));   // đủ thời gian để các bước phân tích hiện lần lượt, không nháy
    showReport(v.items);
    el.name.value = st.name;
    el.drop.hidden = true; el.exports.hidden = true; el.editor.hidden = false; el.redo.hidden = false;
    el.use.disabled = !v.ok;
    editor.setMirror(el.mirror.checked);
    editor.load(st.clean.canvas, rig);
    say(v.ok ? (rig.confidence >= 0.65 ? "Looks good – check the joints, then press “Use this puppet”." : "Some joints may be off – drag the dots to fix them.") : "This picture can’t be used yet.", v.ok ? "ok" : "error");
    startPreview();
  }

  /* ------------------------------------------------------------ */
  /*  Xem thử cử động                                              */
  /* ------------------------------------------------------------ */
  function startPreview() {
    stopPreview();
    let last = performance.now(), sinceBuild = 0;
    const loop = (now) => {
      if (root.hidden || el.editor.hidden || !st.rig) return;
      const dt = (now - last) / 1000; last = now; sinceBuild += dt;
      if (st.dirty && sinceBuild > 0.12) { st.sprite.rebuild(); st.dirty = false; sinceBuild = 0; }
      drawPreview(now / 1000);
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
  }
  function stopPreview() { cancelAnimationFrame(st.raf); st.raf = 0; }
  function drawPreview(t) {
    const c = el.prev, r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d"); g.clearRect(0, 0, w, h);
    const rig = st.rig, s = (h * 0.74) / rig.bounds.h;
    const root0 = { x: w / 2, y: h * 0.13 + (rig.joints.hip.y - rig.bounds.y) * s };
    const base = solvePose(rig, { scale: s, root: root0 });
    // Dáng đứng thả lỏng: hai tay buông xuôi (hơi lệch ra ngoài ~17-22°), đung đưa nhẹ NGƯỢC PHA nhau; hai chân đứng thẳng.
    // (Bản cũ vung tay lên / đá chân liên tục nên khuỷu gập quá mức, nhiều con rối nhìn rất kỳ.)
    const sw = Math.sin(t * 2.2), sw2 = Math.sin(t * 2.2 + Math.PI);
    const aLen = base.reach.armR, lLen = base.reach.legR, J0 = base.joints;
    const ax = (f) => 0.30 + 0.07 * f, ay = (x) => Math.sqrt(Math.max(0, 1 - x * x));   // cánh tay (gần) duỗi thẳng
    const tg = {
      wristR: { x: J0.shoulderR.x - aLen * ax(sw),  y: J0.shoulderR.y + aLen * ay(ax(sw)) },
      wristL: { x: J0.shoulderL.x + aLen * ax(sw2), y: J0.shoulderL.y + aLen * ay(ax(sw2)) },
      ankleR: { x: J0.hipR.x - lLen * 0.07, y: J0.hipR.y + lLen * 0.99 },
      ankleL: { x: J0.hipL.x + lLen * 0.07, y: J0.hipL.y + lLen * 0.99 },
    };
    const pose = solvePose(rig, {
      scale: s, root: root0, lean: 0.015 * sw, headTilt: 0.04 * Math.sin(t * 1.7 + 0.6),
      targets: tg, prev: st.prevJ, limits: { armMaxReach: 0.997 },   // cho phép tay gần như thẳng (game vẫn dùng 0.98)
    });
    st.prevJ = pose.joints;
    drawPuppet(g, st.sprite, pose);
  }

  /* ------------------------------------------------------------ */
  /*  Nguồn ảnh                                                    */
  /* ------------------------------------------------------------ */
  async function fromFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return say("Please choose a PNG, JPG or WebP picture.", "error");
    if (file.size > 8 * 1024 * 1024) return say("The picture is larger than 8 MB.", "error");
    const url = URL.createObjectURL(file);
    try { const img = await loadImage(url); await process(img, file.name.replace(/\.[^.]+$/, "")); }
    catch { say("Could not open this picture.", "error"); }
    finally { URL.revokeObjectURL(url); }
  }
  async function fromUrl(url, name) {
    say("Loading…", "info");
    try { await process(await loadAccountImage(url), name); }
    catch { say("Could not load that picture (check CORS for /exports on the server).", "error"); }
  }
  async function openExports() {
    el.drop.hidden = true; el.editor.hidden = true; el.exports.hidden = false;
    const back = '<button type="button" class="ps-btn ps-btn--ghost" data-act="back">Back</button>';
    if (!isLoggedIn()) { el.exports.innerHTML = `<p class="ps-up-empty">Log in to use your 2D exports.</p>${back}`; return; }
    el.exports.innerHTML = '<p class="ps-up-empty">Loading your exports…</p>';
    try {
      const items = await fetchExports();
      el.exports.innerHTML = items.length
        ? `<div class="ps-up-grid">${items.map((i) => `<button type="button" class="ps-up-tile" data-url="${esc(i.url)}" data-name="${esc(i.name)}"><img src="${esc(i.thumb)}" alt="" loading="lazy"><span>${esc(i.name)}</span></button>`).join("")}</div>${back}`
        : `<p class="ps-up-empty">No exports yet. Export an image from the 3D Forge first.</p>${back}`;
    } catch { el.exports.innerHTML = `<p class="ps-up-empty">Could not load your exports.</p>${back}`; }
  }

  /* ------------------------------------------------------------ */
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act],[data-url]"); if (!t) { if (e.target === root) api.close(); return; }
    if (t.dataset.url) return fromUrl(t.dataset.url, t.dataset.name);
    switch (t.dataset.act) {
      case "close": api.close(); break;
      case "file": el.file.click(); break;
      case "exports": openExports(); break;
      case "back": showSource(); break;
      case "redo": if (st.clean) { st.rig = null; stopPreview(); showAnalyzing(); redetect(performance.now()); } break;
      case "use": {
        if (!st.rig) return;
        const pkg = makePackage({ name: el.name.value.trim() || st.name, texture: st.clean.canvas, rig: st.rig });
        api.close(); onUse?.(pkg); break;
      }
      default: break;
    }
  });
  el.file.addEventListener("change", () => { fromFile(el.file.files[0]); el.file.value = ""; });
  el.mirror.addEventListener("change", () => editor.setMirror(el.mirror.checked));
  ["dragenter", "dragover"].forEach((ev) => el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove("is-over"); }));
  el.drop.addEventListener("drop", (e) => fromFile(e.dataTransfer?.files?.[0]));
  el.drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.file.click(); } });
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); api.close(); } });

  const api = {
    root,
    open() { root.hidden = false; showSource(); $(".ps-up-x").focus(); },
    close() { root.hidden = true; stopPreview(); },
    /** nạp thẳng một ảnh (dùng khi test hoặc kéo thả từ nơi khác) */
    loadImage: process,
    destroy() { stopPreview(); editor.destroy(); root.remove(); },
  };
  return api;
}