/**
 * src/components/authScene.js
 * Cảnh 3D (nhà + bục tròn + đảo nhỏ) ở bên phải trang đăng nhập / đăng ký.
 *
 *  - Kéo chuột để xoay 360° quanh cảnh (góc nhìn lên/xuống được giới hạn để cảnh luôn đẹp).
 *  - Khi bấm "Tắt đèn" (class `is-dark` trên .auth-root) cảnh chuyển sang ban đêm: đèn dây và đèn bàn sáng lên.
 *  - Không phải sửa auth.js: file này vẫn export `SCENE_SVG` (tên cũ) nhưng giờ là một khung rỗng,
 *    và tự dựng cảnh 3D khi khung xuất hiện trong trang. Cảnh tự giải phóng GPU khi trang đăng nhập bị gỡ.
 *  - Trình duyệt không có WebGL -> hiện ảnh tĩnh dự phòng (public/media/auth/scene-fallback.webp).
 *
 *  Chỉnh nhanh: kích thước khung ở hằng STYLE (.auth-3d), khoảng cách camera ở BASE_DISTANCE,
 *  độ nặng của bóng đổ ở SHADOW_MAP_SIZE.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const BASE = (import.meta.env && import.meta.env.BASE_URL) || "/";
const FALLBACK_SRC = `${BASE}media/auth/scene-fallback.webp`;

const BASE_DISTANCE = 31;       // camera càng xa, cảnh càng nhỏ
const SHADOW_MAP_SIZE = 1024;   // 2048 cho bóng sắc nét hơn (nặng hơn)

// Tên cũ được giữ lại để auth.js không phải sửa: nội dung giờ là khung chứa cảnh 3D.
export const SCENE_SVG =
  `<div class="auth-3d" role="img" aria-label="Mô hình 3D căn phòng nhỏ, kéo chuột để xoay"></div>`;

/* ------------------------------------------------------------------ */
/*  CSS của khung (tự chèn 1 lần, không cần sửa file scss)             */
/* ------------------------------------------------------------------ */
const STYLE = `
.auth-3d{position:relative;width:100%;aspect-ratio:1.12/1;max-height:88vh;min-height:360px;cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.auth-3d:active{cursor:grabbing}
.auth-3d canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;pointer-events: auto;touch-action: none;}
.auth-3d img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none}
.auth-3d-hint{position:absolute;left:50%;bottom:3%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:7px 15px;border-radius:999px;font:700 13px/1 "Nunito",system-ui,sans-serif;color:#5b4a80;background:rgba(255,255,255,.74);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(80,50,140,.18);pointer-events:none;transition:opacity .5s ease,transform .5s ease}
.auth-3d-hint.is-hidden{opacity:0;transform:translate(-50%,8px)}
.auth-root.is-dark .auth-3d-hint{color:#e8dcff;background:rgba(40,28,70,.62)}
`;
function injectStyle() {
  if (document.getElementById("auth-3d-style")) return;
  const s = document.createElement("style");
  s.id = "auth-3d-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ */
/*  Tiện ích dựng hình                                                 */
/* ------------------------------------------------------------------ */
const { MathUtils } = THREE;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function mulberry32(seed) {          // số ngẫu nhiên lặp lại được: cảnh luôn giống nhau
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const woodFloorTexture = () => canvasTexture(1024, 1024, (g, w, h) => {
  const rnd = mulberry32(7);
  const planks = 8, ph = h / planks;
  for (let i = 0; i < planks; i++) {
    const y = i * ph;
    const light = 56 + rnd() * 8;
    const grad = g.createLinearGradient(0, y, w, y);
    grad.addColorStop(0, `hsl(27 78% ${light - 6}%)`);
    grad.addColorStop(1, `hsl(29 76% ${light - 10}%)`);
    g.fillStyle = grad;
    g.fillRect(0, y, w, ph);
    for (let k = 0; k < 16; k++) {                       // vân gỗ
      g.strokeStyle = `rgba(150,70,20,${0.05 + rnd() * 0.07})`;
      g.lineWidth = 1 + rnd() * 2;
      const yy = y + rnd() * ph;
      g.beginPath(); g.moveTo(0, yy);
      g.bezierCurveTo(w * 0.3, yy + (rnd() - 0.5) * 6, w * 0.7, yy + (rnd() - 0.5) * 6, w, yy + (rnd() - 0.5) * 4);
      g.stroke();
    }
    g.fillStyle = "rgba(110,50,15,.55)";                  // khe giữa 2 tấm
    g.fillRect(0, y, w, 3);
    g.fillRect(rnd() * w, y, 3, ph);                      // mối nối ngang
  }
});

const signTexture = (text) => canvasTexture(512, 160, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#fcefd8";
  roundRectPath(g, 0, 0, w, h, 34); g.fill();
  g.strokeStyle = "rgba(190,120,60,.35)"; g.lineWidth = 6;
  roundRectPath(g, 10, 10, w - 20, h - 20, 26); g.stroke();
  g.fillStyle = "#7a4519";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.font = '800 62px "Baloo 2","Nunito",system-ui,sans-serif';
  if ("letterSpacing" in g) g.letterSpacing = "3px";
  g.fillText(text, w / 2, h / 2 + 4);
});

const pennantTexture = () => canvasTexture(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#7c55d6";
  g.beginPath(); g.moveTo(0, 20); g.lineTo(w, h / 2); g.lineTo(0, h - 20); g.closePath(); g.fill();
  g.fillStyle = "#ffffff";
  g.font = '800 120px "Baloo 2","Nunito",system-ui,sans-serif';
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("W", w * 0.38, h / 2 + 8);
});

const bannerTexture = () => canvasTexture(128, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#b678e8";
  g.beginPath(); g.moveTo(8, 0); g.lineTo(w - 8, 0); g.lineTo(w - 8, h); g.lineTo(w / 2, h - 46); g.lineTo(8, h); g.closePath(); g.fill();
  g.fillStyle = "#ffffff";
  g.font = '800 78px "Baloo 2","Nunito",system-ui,sans-serif';
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("W", w / 2, h * 0.42);
});

const screenTexture = () => canvasTexture(512, 320, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#bfe3ff"); gr.addColorStop(1, "#79b6ff");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffffff";
  g.beginPath(); g.moveTo(40, h - 40); g.lineTo(190, 110); g.lineTo(300, h - 40); g.closePath(); g.fill();
  g.fillStyle = "#d6ecff";
  g.beginPath(); g.moveTo(210, h - 40); g.lineTo(340, 150); g.lineTo(470, h - 40); g.closePath(); g.fill();
  g.fillStyle = "#fff6c9"; g.beginPath(); g.arc(410, 80, 30, 0, 7); g.fill();
});

const glowTexture = () => canvasTexture(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});

const groundShadowTexture = () => canvasTexture(256, 256, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, "rgba(120,80,210,.55)");
  r.addColorStop(0.55, "rgba(140,100,225,.28)");
  r.addColorStop(1, "rgba(160,120,235,0)");
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});

/* ------------------------------------------------------------------ */
/*  Dựng cảnh                                                          */
/* ------------------------------------------------------------------ */
function buildScene() {
  const world = new THREE.Group();
  const materials = [];               // để đổi độ sáng môi trường (bản three.js cũ)
  const disposables = [];
  const glows = [];                   // sprite ánh sáng quanh bóng đèn
  const bulbMats = [];                // đèn dây + bóng đèn bàn (emissive)
  const lampLights = [];              // đèn bàn (PointLight)
  let screenMat = null;

  const mat = (color, o = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...o });
    materials.push(m);
    return m;
  };
  const shadowed = (mesh, cast = true, receive = true) => {
    mesh.castShadow = cast; mesh.receiveShadow = receive; return mesh;
  };
  const rbox = (w, h, d, r, m, seg = 3) =>
    shadowed(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), m));
  const box = (w, h, d, m) => shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m));
  const cyl = (rt, rb, h, m, seg = 32) => shadowed(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m));
  const sph = (r, m, ws = 24, hs = 16) => shadowed(new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m));
  const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
  const glowTex = glowTexture();
  disposables.push(glowTex);

  const addGlow = (parent, pos, size, color = 0xffc46b) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    s.position.copy(pos); s.scale.setScalar(size);
    parent.add(s); glows.push({ s, size });
    return s;
  };

  /* ---------- bục tròn ---------- */
  const platform = new THREE.Group();
  {
    const R = 5.6, H = 0.62, r = 0.2;
    const pts = [new THREE.Vector2(0, -H), new THREE.Vector2(R, -H)];
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector2(R - r + Math.cos(a) * r, -r + Math.sin(a) * r));
    }
    pts.push(new THREE.Vector2(R - r, 0), new THREE.Vector2(0, 0));
    platform.add(shadowed(new THREE.Mesh(new THREE.LatheGeometry(pts, 96), mat(0xe6dcf1, { roughness: 0.55, side: THREE.DoubleSide }))));
    const low = cyl(R - 0.1, R - 0.3, 0.7, mat(0xb09ccc, { roughness: 0.7 }), 96);
    low.position.y = -H - 0.35 + 0.04;
    platform.add(low);
    const under = cyl(R - 0.32, R - 0.8, 0.28, mat(0x8f7bb2, { roughness: 0.8 }), 96);
    under.position.y = -H - 0.7 - 0.1;
    platform.add(under);
  }
  world.add(platform);

  /* ---------- căn phòng ---------- */
  const room = new THREE.Group();
  room.position.set(-0.4, 0, -0.4);
  world.add(room);
  const FLOOR = 0.36;                 // mặt sàn (cao hơn bục)
  const W = 5.4;                      // cạnh phòng
  const WALL_H = 3.1;
  {
    const cream = mat(0xf1dfc4, { roughness: 0.92 });
    const wood = mat(0xd9772c, { roughness: 0.5 });
    const woodTop = mat(0xe8923f, { roughness: 0.5 });

    // sàn
    room.add(at(box(W, FLOOR, W, mat(0xc77a34, { roughness: 0.6 })), 0, FLOOR / 2, 0));
    const floorTex = woodFloorTexture(); disposables.push(floorTex);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, W - 0.02), mat(0xffffff, { map: floorTex, roughness: 0.55 }));
    floor.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    floor.position.set(0, FLOOR + 0.002, 0);
    floor.receiveShadow = true;
    room.add(floor);

    // 2 bức tường (trái: x = -W/2, phải/sau: z = -W/2)
    room.add(at(box(0.2, WALL_H, W, cream), -W / 2, FLOOR + WALL_H / 2, 0));
    room.add(at(box(W - 0.2, WALL_H, 0.2, cream), 0.1, FLOOR + WALL_H / 2, -W / 2));
    // len chân tường
    const trim = mat(0xe7cfae, { roughness: 0.8 });
    room.add(at(box(0.07, 0.2, W - 0.2, trim), -W / 2 + 0.135, FLOOR + 0.1, 0));
    room.add(at(box(W - 0.4, 0.2, 0.07, trim), 0.1, FLOOR + 0.1, -W / 2 + 0.135));

    // xà gỗ trên đỉnh tường
    const beamY = FLOOR + WALL_H + 0.17;
    room.add(at(rbox(0.66, 0.36, W + 0.5, 0.07, wood), -W / 2, beamY, 0.15));
    room.add(at(rbox(W + 0.2, 0.36, 0.66, 0.07, wood), 0.35, beamY, -W / 2));
    room.add(at(rbox(0.5, 0.05, W + 0.3, 0.02, woodTop), -W / 2, beamY + 0.19, 0.15));
    room.add(at(rbox(W, 0.05, 0.5, 0.02, woodTop), 0.45, beamY + 0.19, -W / 2));
  }

  /* ---------- đồ nội thất ---------- */
  {
    const deskWood = mat(0xd98440, { roughness: 0.55 });
    const deskTop = mat(0xe89a52, { roughness: 0.5 });
    // bàn (dọc theo tường sau)
    const desk = new THREE.Group();
    desk.add(at(rbox(2.9, 0.14, 1.35, 0.05, deskTop), 0, 1.18, 0));
    [[-1.3, -0.55], [1.3, -0.55], [-1.3, 0.55], [1.3, 0.55]].forEach(([x, z]) => desk.add(at(box(0.13, 1.14, 0.13, deskWood), x, 0.57, z)));
    desk.add(at(box(2.7, 0.1, 0.06, deskWood), 0, 0.98, -0.62));
    desk.position.set(0.95, FLOOR, -1.85);
    room.add(desk);

    // màn hình
    const frame = mat(0xe3e3ee, { roughness: 0.35 });
    const monitor = new THREE.Group();
    monitor.add(at(rbox(1.7, 1.08, 0.1, 0.05, frame), 0, 0.82, 0));
    const stex = screenTexture(); disposables.push(stex);
    screenMat = new THREE.MeshStandardMaterial({ map: stex, emissive: 0xffffff, emissiveMap: stex, emissiveIntensity: 0.28, roughness: 0.3 });
    materials.push(screenMat);
    monitor.add(at(new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.9), screenMat), 0, 0.84, 0.056));
    monitor.add(at(cyl(0.07, 0.09, 0.32, frame), 0, 0.2, 0));
    monitor.add(at(rbox(0.7, 0.06, 0.4, 0.03, frame), 0, 0.03, 0.02));
    monitor.position.set(0.95, FLOOR + 1.25, -2.0);
    monitor.rotation.y = 0.32;
    room.add(monitor);

    // bàn phím + chuột
    room.add(at(rbox(0.95, 0.05, 0.3, 0.02, mat(0xcfcfdc)), 0.75, FLOOR + 1.27, -1.5));
    room.add(at(rbox(0.16, 0.06, 0.24, 0.03, mat(0xf0f0f6)), 1.55, FLOOR + 1.28, -1.45));

    // đèn bàn
    const lamp = new THREE.Group();
    const dark = mat(0x5b5b6c, { roughness: 0.4 });

    // ĐẾ ĐÈN - giữ nguyên thiết kế cũ
    lamp.add(at(
      cyl(0.22, 0.25, 0.06, mat(0xd6d6e4)),
      0, 0.03, 0
    ));

    // Thanh thân thứ nhất - giữ nguyên
    const arm1 = cyl(0.025, 0.025, 0.8, dark);
    arm1.position.set(0, 0.45, 0);
    arm1.rotation.z = -0.15;
    lamp.add(arm1);

    // Thanh thân thứ hai - hạ thấp một chút
    const arm2 = cyl(0.025, 0.025, 0.65, dark);
    arm2.position.set(0.18, 0.87, 0);
    arm2.rotation.z = -1.15;
    lamp.add(arm2);

    // Chụp đèn - hạ thấp theo thanh thân
    const head = shadowed(new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.32, 28, 1, true),
      mat(0x6b6b7d, { side: THREE.DoubleSide })
    ));

    head.position.set(0.5, 0.95, 0);
    head.rotation.z = 2.3;
    lamp.add(head);

    // Bóng đèn
    const bulbM = new THREE.MeshStandardMaterial({
      color: 0xfff1c9,
      emissive: 0xffd27a,
      emissiveIntensity: 1.2
    });

    materials.push(bulbM);
    bulbMats.push({ m: bulbM, day: 1.2, night: 3.2 });

    lamp.add(at(sph(0.07, bulbM), 0.46, 0.90, 0));

    // Ánh sáng đèn
    const lampLight = new THREE.PointLight(0xffc878, 0.8, 6, 1.6);
    lampLight.position.set(0.5, 0.83, 0.2);
    lamp.add(lampLight);
    lampLights.push({ l: lampLight, day: 0.8, night: 9 });

    addGlow(lamp, V3(0.46, 0.90, 0), 1.1, 0xffcf7a);

    lamp.position.set(1.95, FLOOR + 1.25, -2.15);
    lamp.rotation.y = 0.1;
    room.add(lamp);


    // kệ sách + đồ trang trí
    const shelf = new THREE.Group();
    shelf.add(at(rbox(2.4, 0.1, 0.55, 0.03, mat(0xdb8a45)), 0, 0, 0));
    [0x38b27f, 0x35a6c2, 0xd0478f, 0x6a4fd0, 0xeab83a].forEach((c, i) => {
      const h = 0.52 + (i % 3) * 0.06;
      const b = rbox(0.17, h, 0.36, 0.02, mat(c, { roughness: 0.55 }));
      b.position.set(-0.05 + i * 0.2, 0.05 + h / 2, 0); b.rotation.z = i === 4 ? -0.2 : 0;
      shelf.add(b);
    });
    const pink = mat(0xff8fc2, { roughness: 0.5 });
    const oct = new THREE.Group();                         // bạch tuộc hồng
    oct.add(at(sph(0.2, pink), 0, 0.22, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const t = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 4, 8), pink));
      t.position.set(Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15); t.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      oct.add(t);
    }
    const eyeM = mat(0x2a1a3a);
    oct.add(at(sph(0.025, eyeM), -0.07, 0.25, 0.18), at(sph(0.025, eyeM), 0.07, 0.25, 0.18));
    oct.position.set(0.95, 0.05, 0.02);
    shelf.add(oct);
    shelf.add(at(sph(0.1, mat(0x5ab6ff, { roughness: 0.2, metalness: 0.1 })), 1.18, 0.15, 0.05)); // viên bi xanh
    shelf.position.set(1.45, FLOOR + 2.55, -W / 2 + 0.38);
    room.add(shelf);
    [-0.9, 0.9].forEach((dx) => room.add(at(box(0.07, 0.07, 0.4, mat(0xc9783a)), 1.45 + dx, FLOOR + 2.46, -W / 2 + 0.4))); // nẹp đỡ kệ

    // biểu ngữ tím
    const btex = bannerTexture(); disposables.push(btex);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.0), new THREE.MeshStandardMaterial({ map: btex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }));
    materials.push(banner.material);
    banner.position.set(2.2, FLOOR + 2.0, -W / 2 + 0.115);
    banner.castShadow = true;
    room.add(banner);

    // ghế xoay tím
    const purple = mat(0x7b52d3, { roughness: 0.55 });
    const purpleDark = mat(0x6642b8, { roughness: 0.6 });
    const chair = new THREE.Group();
    chair.add(at(rbox(1.0, 0.22, 1.0, 0.09, purple), 0, 0.95, 0));
    const backrest = rbox(1.0, 1.15, 0.2, 0.09, purple);
    backrest.position.set(0, 1.62, 0.5); backrest.rotation.x = 0.08; chair.add(backrest);
    chair.add(at(rbox(0.1, 0.4, 0.9, 0.04, purpleDark), -0.58, 1.2, 0.0), at(rbox(0.1, 0.4, 0.9, 0.04, purpleDark), 0.58, 1.2, 0.0));

    // Trục giữa: kéo dài xuống để chạm các thanh chân
    chair.add(at(
      cyl(0.07, 0.07, 0.64, mat(0xd6d6e4)),
      0, 0.52, 0
    ));

    const base = mat(0xdadae6, { roughness: 0.45 });

    // 5 thanh chân ghế
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;

      const leg = rbox(0.62, 0.07, 0.11, 0.03, base);

      // Hạ thấp thanh chân để nối với bánh xe
      leg.position.set(
        Math.cos(a) * 0.3,
        0.17,
        Math.sin(a) * 0.3
      );

      leg.rotation.y = -a;
      chair.add(leg);

      // Bánh xe: đáy tiếp xúc mặt sàn
      const wheel = sph(0.07, mat(0x7d7d90));

      wheel.position.set(
        Math.cos(a) * 0.58,
        0.07,
        Math.sin(a) * 0.58
      );

      chair.add(wheel);
    }

    chair.position.set(0.6, FLOOR, -0.55);
    chair.rotation.y = 0.35;
    room.add(chair);

    // tủ xám
    room.add(at(rbox(1.15, 2.05, 1.15, 0.08, mat(0xc4c0d2, { roughness: 0.5 })), -1.75, FLOOR + 1.025, -0.5));
    room.add(at(rbox(0.05, 0.7, 0.06, 0.02, mat(0xb9b4c8)), -1.15, FLOOR + 1.4, -0.12));

    // chậu cây
    const plant = new THREE.Group();
    plant.add(at(cyl(0.34, 0.26, 0.5, mat(0xf2ede6, { roughness: 0.6 })), 0, 0.25, 0));
    plant.add(at(cyl(0.3, 0.3, 0.04, mat(0x6a4326)), 0, 0.5, 0));
    
    const leafColors = [0x58b756, 0x3f9d4d, 0x6fc363];
    const rnd = mulberry32(21);
    const stemM = mat(0x438c43, { roughness: 0.7 });

    for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd();

    const tilt = 0.35 + rnd() * 0.5;

    // Vị trí gốc và ngọn lá
    const base = V3(
        Math.cos(a) * 0.04,
        0.51,
        Math.sin(a) * 0.04
    );

    const tip = V3(
        Math.cos(a) * 0.20,
        0.76 + rnd() * 0.10,
        Math.sin(a) * 0.20
    );

    // Cuống cây nối từ đất lên lá
    const dir = tip.clone().sub(base);

    const stem = cyl(
        0.025,
        0.018,
        dir.length(),
        stemM,
        10
    );

    stem.position.copy(base).add(tip).multiplyScalar(0.5);
    stem.quaternion.setFromUnitVectors(
        V3(0, 1, 0),
        dir.normalize()
    );

    plant.add(stem);

    // Tạo lá
    const leaf = shadowed(new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 14, 10),
        mat(leafColors[i % 3], { roughness: 0.55 })
    ));

    leaf.scale.set(0.55, 1.4 + rnd() * 0.25, 0.3);

    leaf.position.set(tip.x, tip.y, tip.z);

    leaf.rotation.set(
        Math.sin(a) * tilt,
        -a,
        -Math.cos(a) * tilt
    );

    plant.add(leaf);
    }

    plant.position.set(-2.1, FLOOR, 1.35);
    room.add(plant);
  }

  /* ---------- đèn dây trang trí ---------- */
  {
    const wireM = new THREE.MeshStandardMaterial({ color: 0x3a2c28, roughness: 0.8 });
    materials.push(wireM);
    const bulbGeo = new THREE.SphereGeometry(0.075, 14, 10);
    disposables.push(bulbGeo);
    const swagRun = (pts, bulbsPer) => {
      const curve = new THREE.CatmullRomCurve3(pts);
      room.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.014, 6), wireM));
      for (let i = 1; i < bulbsPer; i++) {
        const p = curve.getPoint(i / bulbsPer);
        const bm = new THREE.MeshStandardMaterial({ color: 0xfff0c2, emissive: 0xffc95a, emissiveIntensity: 1.0 });
        materials.push(bm); bulbMats.push({ m: bm, day: 1.0, night: 3.4 });
        const bulb = new THREE.Mesh(bulbGeo, bm); bulb.position.copy(p); room.add(bulb);
        addGlow(room, p, 0.55, 0xffc760);
      }
    };
    const swag = (a, b, sag, n = 10) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n; const p = a.clone().lerp(b, t); p.y -= Math.sin(Math.PI * t) * sag; pts.push(p);
      }
      return pts;
    };
    const y = FLOOR + WALL_H - 0.3;
    const lx = -W / 2 + 0.2, rz = -W / 2 + 0.2;
    swagRun(swag(V3(lx, y, -W / 2 + 0.25), V3(lx, y, 0.0), 0.42), 5);
    swagRun(swag(V3(lx, y, 0.0), V3(lx, y, W / 2 - 0.15), 0.42), 5);
    swagRun(swag(V3(-W / 2 + 0.25, y, rz), V3(0.0, y, rz), 0.42), 5);
    swagRun(swag(V3(0.0, y, rz), V3(W / 2 - 0.3, y, rz), 0.42), 5);
  }

  /* ---------- cột biển chỉ đường (biển nằm bên trái cột) ---------- */
  {
    const post = new THREE.Group();
    const wood = mat(0xd9792b, { roughness: 0.55 });
    post.add(at(cyl(0.14, 0.17, 4.7, wood, 24), 0, 2.35, 0));
    post.add(at(cyl(0.25, 0.25, 0.14, mat(0xe9944a), 24), 0, 4.75, 0));
    post.add(at(cyl(0.2, 0.2, 0.18, wood, 24), 0, 0.09, 0));
    const orange = mat(0xe38a3b, { roughness: 0.5 });
    ["3D FORGE", "MAGIC QR", "HAND LAB"].forEach((label, i) => {
      const sign = new THREE.Group();
      sign.add(at(rbox(2.2, 0.66, 0.14, 0.06, orange), -1.25, 0, 0));
      const tex = signTexture(label); disposables.push(tex);
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, transparent: true });
      materials.push(face);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), face);
      front.position.set(-1.25, 0, 0.075);
      const back = front.clone(); back.position.z = -0.075; back.rotation.y = Math.PI;   // đọc được cả hai mặt
      sign.add(front, back);
      // Thanh đỡ nối bảng với cột
      const support = rbox(
          0.28,
          0.12,
          0.12,
          0.04,
          wood
      );

      support.position.set(-0.05, 0, -0.02);
      sign.add(support);
      sign.position.set(-0.05, 3.7 - i * 0.82, 0);
      post.add(sign);
    });
    post.position.set(-2.2, 0, 3.0);
    post.rotation.y = Math.PI / 4;
    world.add(post);
  }

  /* ---------- đảo nhỏ phía trước ---------- */
  const island = new THREE.Group();
  {
    const R = 2.0;
    const grass = mat(0x4f8c2c, { roughness: 0.85 });
    const pts = [new THREE.Vector2(0, -0.9), new THREE.Vector2(R - 0.45, -0.9), new THREE.Vector2(R - 0.1, -0.55), new THREE.Vector2(R, -0.2), new THREE.Vector2(R, 0), new THREE.Vector2(0, 0)];
    island.add(shadowed(new THREE.Mesh(new THREE.LatheGeometry(pts, 64), mat(0x42742a, { roughness: 0.85, side: THREE.DoubleSide }))));
    island.add(at(cyl(R - 0.02, R - 0.02, 0.1, grass, 64), 0, -0.04, 0));
    // cột cờ
    const pole = new THREE.Group();
    pole.add(at(cyl(0.07, 0.09, 2.7, mat(0x34343f, { roughness: 0.4 })), 0, 1.35, 0));
    pole.add(at(rbox(0.62, 0.4, 0.62, 0.08, mat(0xe9e5f0)), 0, 2.8, 0));
    pole.add(at(rbox(0.7, 0.06, 0.7, 0.03, mat(0x34343f)), 0, 3.04, 0));
    const ptex = pennantTexture(); disposables.push(ptex);
    const pennant = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshStandardMaterial({ map: ptex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7 }));
    materials.push(pennant.material);
    pennant.position.set(0.55, 2.3, 0); pennant.castShadow = true; pole.add(pennant);
    pole.add(at(cyl(0.18, 0.2, 0.1, mat(0x34343f)), 0, 0.05, 0));
    pole.position.set(0.5, 0, -0.5);
    island.add(pole);
    // cậu bé
    const boy = new THREE.Group();
    const skin = mat(0xf3c29c, { roughness: 0.6 }), shirt = mat(0x2f6fd6, { roughness: 0.6 }), pants = mat(0x1f2a52, { roughness: 0.6 }), hair = mat(0x7a4a2a, { roughness: 0.7 });
    boy.add(at(rbox(0.17, 0.5, 0.2, 0.05, pants), -0.12, 0.3, 0), at(rbox(0.17, 0.5, 0.2, 0.05, pants), 0.12, 0.3, 0));
    boy.add(at(rbox(0.5, 0.58, 0.32, 0.1, shirt), 0, 0.85, 0));
    boy.add(at(rbox(0.14, 0.46, 0.16, 0.05, shirt), -0.33, 0.82, 0), at(rbox(0.14, 0.46, 0.16, 0.05, shirt), 0.33, 0.82, 0));
    boy.add(at(sph(0.13, skin), -0.33, 0.55, 0), at(sph(0.13, skin), 0.33, 0.55, 0));
    boy.add(at(sph(0.25, skin), 0, 1.4, 0));
    const hairCap = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hair));
    hairCap.position.set(0, 1.42, -0.02); boy.add(hairCap);
    boy.position.set(-0.8, 0, 0.4); boy.rotation.y = 0.5;
    island.add(boy);
    // hàng rào
    const fenceM = mat(0xdb8a3f, { roughness: 0.55 });
    const fence = new THREE.Group();
    [-0.55, 0, 0.55].forEach((x) => fence.add(at(rbox(0.12, 0.7, 0.12, 0.03, fenceM), x, 0.35, 0)));
    fence.add(at(rbox(1.35, 0.1, 0.07, 0.02, fenceM), 0, 0.5, 0.03), at(rbox(1.35, 0.1, 0.07, 0.02, fenceM), 0, 0.25, 0.03));
    fence.position.set(1.0, 0, 0.6); fence.rotation.y = -0.9;
    island.add(fence);
    // đá + cỏ
    const stone = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), mat(0xe0dce6)));
    stone.position.set(0.1, 0.05, 1.0); stone.scale.set(1.3, 0.55, 0.9); island.add(stone);
    const grassM = mat(0x3f7d26, { roughness: 0.8 });
    const rg = mulberry32(5);
    for (let i = 0; i < 9; i++) {
      const a = rg() * Math.PI * 2, d = 0.9 + rg() * 0.85;
      const tuft = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const blade = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.28, 5), grassM));
        blade.position.set((k - 1) * 0.05, 0.14, 0); blade.rotation.z = (k - 1) * 0.35; tuft.add(blade);
      }
      tuft.position.set(Math.cos(a) * d, 0.02, Math.sin(a) * d); island.add(tuft);
    }
  }
  island.position.set(4.8, -1.45, 5.8);
  world.add(island);

  /* ---------- quầng tím mờ dưới bục (cho cảm giác nổi) ---------- */
  const shTex = groundShadowTexture(); disposables.push(shTex);
  const shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false });
  const g1 = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), shMat);
  g1.rotation.x = -Math.PI / 2; g1.position.set(0.3, -2.2, 0.3); world.add(g1);
  const g2 = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), shMat);
  g2.rotation.x = -Math.PI / 2; g2.position.set(3.9, -2.6, 5.2); world.add(g2);

  /* ---------- ngày <-> đêm (n: 0 = ngày, 1 = đêm) ---------- */
  const lerp = MathUtils.lerp;
  const nightKey = new THREE.Color(0x9fb0ff);
  function applyNight(n, lights) {
    lights.hemi.intensity = lerp(0.5, 0.12, n);
    lights.key.intensity = lerp(2.3, 0.26, n);
    lights.fill.intensity = lerp(0.5, 0.08, n);
    lights.key.color.setHex(0xffecd2).lerp(nightKey, n * 0.6);
    // độ sáng của môi trường: three.js mới dùng scene.environmentIntensity, bản cũ dùng envMapIntensity của vật liệu
    const env = lerp(0.5, 0.05, n);
    if (lights.scene && "environmentIntensity" in lights.scene) lights.scene.environmentIntensity = env;
    else materials.forEach((m) => { if ("envMapIntensity" in m) m.envMapIntensity = env; });
    bulbMats.forEach(({ m, day, night }) => { m.emissiveIntensity = lerp(day, night, n); });
    lampLights.forEach(({ l, day, night }) => { l.intensity = lerp(day, night, n); });
    glows.forEach(({ s, size }) => { s.material.opacity = lerp(0.3, 0.95, n); s.scale.setScalar(size * lerp(1, 1.45, n)); });
    if (screenMat) screenMat.emissiveIntensity = lerp(0.28, 1.1, n);
    shMat.opacity = lerp(1, 0.55, n);
  }

  const dispose = () => {
    world.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      ms.forEach((m) => { m.map && m.map.dispose(); m.dispose(); });
    });
    disposables.forEach((d) => d.dispose && d.dispose());
  };
  return { world, applyNight, dispose };
}

/* ------------------------------------------------------------------ */
/*  Gắn cảnh vào khung                                                 */
/* ------------------------------------------------------------------ */
function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch { return false; }
}

function showFallback(el) {
  el.innerHTML = `<img src="${FALLBACK_SRC}" alt="" draggable="false">`;
  el.style.cursor = "default";
}

export function mountAuthScene(el) {
  if (!el || el.dataset.ready) return;
  el.dataset.ready = "1";
  injectStyle();
  if (!hasWebGL()) return showFallback(el);

  // Chữ trên các biển được vẽ bằng font của trang: đợi font tải xong (tối đa ~1,2 giây) rồi mới dựng cảnh
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fontsReady = document.fonts && document.fonts.load
    ? Promise.race([document.fonts.load('800 62px "Baloo 2"'), wait(1200)]).catch(() => {})
    : Promise.resolve();
  fontsReady.then(() => startScene(el));
}

function startScene(el) {
  if (!el.isConnected) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch { return showFallback(el); }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = parseInt(THREE.REVISION, 10) >= 180 ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  const lights = {
    hemi: new THREE.HemisphereLight(0xfff1e0, 0xb9a2ea, 0.5),
    key: new THREE.DirectionalLight(0xffecd2, 2.3),
    fill: new THREE.DirectionalLight(0xc9b8ff, 0.5),
    scene,
  };
  lights.key.position.set(9, 12, 4);
  lights.key.castShadow = true;
  lights.key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  Object.assign(lights.key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
  lights.key.shadow.radius = 4;
  lights.key.shadow.bias = -0.0004;
  lights.key.shadow.normalBias = 0.03;
  lights.fill.position.set(-6, 4, -5);
  scene.add(lights.hemi, lights.key, lights.fill);

  const built = buildScene();
  scene.add(built.world);

  const camera = new THREE.PerspectiveCamera(24, 1.12, 1, 200);
  const target = new THREE.Vector3(0.5, 0.6, 1.0);   // tâm xoay: gần giữa bục, nhà luôn ở giữa khung
  //const controls = new OrbitControls(camera, renderer.domElement);
  //controls.target.copy(target);
  //controls.enableZoom = false;
  //controls.enablePan = false;
  //controls.enableDamping = true;
  //controls.dampingFactor = 0.08;
  //controls.rotateSpeed = 0.8;
  const controls = new OrbitControls(camera, renderer.domElement);

  // Bật điều khiển camera
  controls.enabled = true;
  controls.enableRotate = true;

  // Chuột trái để xoay
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;

  // Không cho zoom và di chuyển tâm camera
  controls.enableZoom = false;
  controls.enablePan = false;

  // Xoay mượt
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.8;

  controls.target.copy(target);

  controls.minPolarAngle = MathUtils.degToRad(46);
  controls.maxPolarAngle = MathUtils.degToRad(78);

  const START_AZ = 45, START_POLAR = 62;
  let distance = BASE_DISTANCE;
  const placeCamera = (azDeg, polarDeg) => {
    const az = MathUtils.degToRad(azDeg), pl = MathUtils.degToRad(polarDeg);
    camera.position.set(
      target.x + distance * Math.sin(pl) * Math.sin(az),
      target.y + distance * Math.cos(pl),
      target.z + distance * Math.sin(pl) * Math.cos(az),
    );
    camera.lookAt(target);
  };
  placeCamera(START_AZ, START_POLAR);
  controls.update();

  // gợi ý "kéo để xoay"
  const hint = document.createElement("div");
  hint.className = "auth-3d-hint";
  hint.innerHTML = `<span aria-hidden="true">↻</span> Drag to rotate`;
  el.appendChild(hint);

  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let interacted = false;
  controls.addEventListener("start", () => { interacted = true; controls.autoRotate = false; hint.classList.add("is-hidden"); });
  //controls.autoRotate = !reduced;           // đung đưa nhẹ ±10° cho tới khi người dùng chạm vào
  //controls.autoRotateSpeed = 0.7;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0;
  let swayDir = 1;

  // kích thước
  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // khung càng "vuông/cao" càng phải lùi xa để cảnh không bị cắt hai bên
    distance = BASE_DISTANCE * Math.max(1, 1.12 / camera.aspect);
    const off = camera.position.clone().sub(target).setLength(distance);
    camera.position.copy(target).add(off);
    // đẩy hình lên ~9% để thấy trọn đảo nhỏ phía dưới (không làm đổi tâm xoay)
    camera.setViewOffset(w, h, 0, h * 0.09, w, h);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  // ngày / đêm theo class is-dark của .auth-root
  const root = el.closest(".auth-root");
  let nightTarget = root && root.classList.contains("is-dark") ? 1 : 0;
  let night = nightTarget;
  const mo = root ? new MutationObserver(() => { nightTarget = root.classList.contains("is-dark") ? 1 : 0; }) : null;
  if (mo) mo.observe(root, { attributes: true, attributeFilter: ["class"] });
  built.applyNight(night, lights);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    ro.disconnect(); mo && mo.disconnect();
    controls.dispose();
    built.dispose();
    envTex.dispose(); pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };

  let last = performance.now(), frames = 0;
  const frame = () => {
    if (!el.isConnected) return dispose();            // trang đăng nhập đã bị gỡ -> giải phóng GPU
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);   // giây: mọi chuyển động tính theo thời gian thực, không theo số khung hình
    last = now;
    if (!el.clientWidth) return;                      // đang ẩn (màn hình hẹp) -> khỏi vẽ
    frames++;
    if (night !== nightTarget) {                      // chuyển ngày <-> đêm trong ~0.4 giây
      night += Math.sign(nightTarget - night) * Math.min(Math.abs(nightTarget - night), dt / 0.4);
      built.applyNight(night, lights);
    }
    if (!interacted && controls.autoRotate) {         // đung đưa ±10° quanh góc nhìn ban đầu
      const az = MathUtils.radToDeg(controls.getAzimuthalAngle());
      if (az > START_AZ + 10) swayDir = -1; else if (az < START_AZ - 10) swayDir = 1;
      controls.autoRotateSpeed = 0.7 * swayDir;
    }
    controls.update(dt);
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(frame);

  // công cụ gỡ lỗi / kiểm thử (không ảnh hưởng gì tới người dùng)
  el._auth3d = {
    setView(azDeg, polarDeg = START_POLAR) {
      controls.autoRotate = false; interacted = true; hint.classList.add("is-hidden");
      placeCamera(azDeg, polarDeg); controls.update();
    },
    setNight(v) { nightTarget = v ? 1 : 0; night = nightTarget; built.applyNight(night, lights); },
    getNight() { return night; },
    getAzimuth() { return MathUtils.radToDeg(controls.getAzimuthalAngle()); },
    isSwaying() { return controls.autoRotate; },
    getFrames() { return frames; },
    dispose,
  };
}

/* ------------------------------------------------------------------ */
/*  Tự gắn khi khung .auth-3d xuất hiện trong trang                    */
/* ------------------------------------------------------------------ */
function autoMount() {
  const scan = (node) => {
    if (!(node instanceof Element)) return;
    if (node.matches(".auth-3d")) mountAuthScene(node);
    node.querySelectorAll && node.querySelectorAll(".auth-3d").forEach(mountAuthScene);
  };
  scan(document.body);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(scan);
  }).observe(document.body, { childList: true, subtree: true });
}
if (typeof document !== "undefined") {
  if (document.body) autoMount();
  else document.addEventListener("DOMContentLoaded", autoMount, { once: true });
}