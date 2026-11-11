// frontend/src/components/puppet/puppetAssets.js
// Tài nguyên dựng bằng code (SVG): 3 con rối mẫu T-pose, vợt / vũ khí / khiên, quả cầu & vật phẩm.
// Không cần file ảnh: đổi màu hoặc thêm món mới chỉ bằng cách sửa SVG ở đây.

const imgCache = new Map();

export const svgUrl = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

/** Tải ảnh (có cache theo url) */
export function loadImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => { imgCache.delete(url); reject(new Error("Cannot load image: " + url.slice(0, 80))); };
    img.src = url;
  });
  imgCache.set(url, p);
  return p;
}

/* ------------------------------------------------------------------ */
/*  Con rối mẫu (T-pose, nền trong suốt) – đi qua đúng pipeline rig     */
/*  như ảnh người dùng upload, nên cũng là bài test cho thuật toán.     */
/* ------------------------------------------------------------------ */
function puppetSvg({ skin, robe, robe2, accent, line, hat, face }) {
  const ears = hat === "ears"
    ? `<path d="M158 40 L168 -6 L196 28 Z" fill="${robe2}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/>
       <path d="M242 40 L232 -6 L204 28 Z" fill="${robe2}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/>`
    : hat === "cap"
    ? `<path d="M150 52 Q200 -18 250 52 Z" fill="${robe2}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/>
       <rect x="144" y="48" width="112" height="9" rx="4" fill="${accent}" stroke="${line}" stroke-width="3"/>`
    : `<path d="M200 28 Q168 -22 214 -26 Q192 -6 214 28 Z" fill="${accent}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/>`;
  const eyes = face === "fox"
    ? `<path d="M176 70 L190 76 M224 70 L210 76" stroke="${line}" stroke-width="5" stroke-linecap="round"/><path d="M196 92 L200 97 L204 92 Z" fill="${line}"/>`
    : `<circle cx="184" cy="72" r="5" fill="${line}"/><circle cx="216" cy="72" r="5" fill="${line}"/><path d="M190 94 Q200 101 210 94" stroke="${line}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -34 412 600" width="412" height="600">
  <g stroke="${line}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <rect x="156" y="292" width="38" height="232" rx="14" fill="${robe}"/>
    <rect x="206" y="292" width="38" height="232" rx="14" fill="${robe}"/>
    <ellipse cx="166" cy="534" rx="32" ry="14" fill="${robe2}"/>
    <ellipse cx="234" cy="534" rx="32" ry="14" fill="${robe2}"/>
    <rect x="186" y="104" width="28" height="30" fill="${skin}"/>
    <path d="M142 128 Q200 112 258 128 L248 304 L152 304 Z" fill="${robe}"/>
    <rect x="148" y="262" width="104" height="18" rx="6" fill="${accent}"/>
    <rect x="20" y="130" width="130" height="30" rx="15" fill="${robe2}"/>
    <rect x="250" y="130" width="130" height="30" rx="15" fill="${robe2}"/>
    <circle cx="26" cy="145" r="19" fill="${skin}"/>
    <circle cx="374" cy="145" r="19" fill="${skin}"/>
    <circle cx="200" cy="64" r="48" fill="${skin}"/>
    ${ears}
  </g>
  ${eyes}
</svg>`;
}

export const PRESET_PUPPETS = [
  { id: "kitsune", name: "Paper Kitsune",
    svg: puppetSvg({ skin: "#fdf1e4", robe: "#f6e6dc", robe2: "#e9895f", accent: "#d9482f", line: "#5a3a2e", hat: "ears", face: "fox" }) },
  { id: "jade", name: "Jade Monk",
    svg: puppetSvg({ skin: "#f6e8d2", robe: "#cfe8d4", robe2: "#6fae8a", accent: "#e0a43a", line: "#2f4a3b", hat: "cap", face: "plain" }) },
  { id: "crane", name: "Silver Crane",
    svg: puppetSvg({ skin: "#f4efe9", robe: "#dfe6f4", robe2: "#8a9fd0", accent: "#e46e6e", line: "#39466b", hat: "plume", face: "plain" }) },
];
export const AI_PUPPET = {
  id: "guardian", name: "Iron Guardian",
  svg: puppetSvg({ skin: "#e8dccb", robe: "#c9a46a", robe2: "#7b3d2c", accent: "#2f2a2a", line: "#2a1a14", hat: "cap", face: "plain" }),
};

/* ------------------------------------------------------------------ */
/*  Vợt / vũ khí / khiên                                               */
/*  Quy ước sprite: tay cầm ở "grip", phần đánh hướng LÊN trên.        */
/*  head = tâm vùng đánh (vợt), tip = mũi vũ khí.                      */
/* ------------------------------------------------------------------ */
const wrap = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 300" width="120" height="300"><g stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;

export const EQUIPMENT = {
  racket: [
    { id: "pingpong", name: "Ping-pong", grip: [60, 282], head: [60, 112], headR: 0.9, size: 1.0,
      svg: wrap(`<rect x="52" y="168" width="16" height="116" rx="6" fill="#c98b4e" stroke="#6b4423" stroke-width="4"/>
        <circle cx="60" cy="112" r="58" fill="#d94a3d" stroke="#6b2a22" stroke-width="5"/>
        <circle cx="60" cy="112" r="44" fill="none" stroke="#f3b3a8" stroke-width="3" opacity=".7"/>`) },
    { id: "tennis", name: "Tennis", grip: [60, 286], head: [60, 100], headR: 1.1, size: 1.0,
      svg: wrap(`<rect x="54" y="190" width="12" height="98" rx="5" fill="#2f3b52" stroke="#161d2b" stroke-width="4"/>
        <path d="M60 196 L44 168 M60 196 L76 168" stroke="#161d2b" stroke-width="5" fill="none"/>
        <ellipse cx="60" cy="100" rx="46" ry="68" fill="#e9f6c9" fill-opacity=".55" stroke="#2f3b52" stroke-width="7"/>
        <path d="M60 36V164 M36 70V132 M84 70V132 M18 100H102 M26 74H94 M26 126H94" stroke="#2f3b52" stroke-width="2.2" opacity=".8"/>`) },
    { id: "badminton", name: "Badminton", grip: [60, 288], head: [60, 92], headR: 1.0, size: 1.0,
      svg: wrap(`<rect x="57" y="162" width="6" height="128" rx="3" fill="#33384a" stroke="#14172a" stroke-width="3"/>
        <rect x="52" y="226" width="16" height="62" rx="6" fill="#e8c24a" stroke="#6b5518" stroke-width="3"/>
        <ellipse cx="60" cy="92" rx="36" ry="52" fill="#dff3ff" fill-opacity=".5" stroke="#33384a" stroke-width="6"/>
        <path d="M60 42V142 M40 62V122 M80 62V122 M26 92H94 M32 72H88 M32 112H88" stroke="#33384a" stroke-width="1.8" opacity=".8"/>`) },
    { id: "pan", name: "Frying pan", grip: [60, 288], head: [60, 108], headR: 1.0, size: 1.0,
      svg: wrap(`<rect x="52" y="164" width="16" height="124" rx="7" fill="#7b4a2b" stroke="#2f1b0f" stroke-width="4"/>
        <circle cx="60" cy="108" r="56" fill="#3b3f46" stroke="#14161a" stroke-width="6"/>
        <circle cx="60" cy="108" r="42" fill="#555b65" stroke="#2a2d33" stroke-width="3"/>
        <ellipse cx="44" cy="90" rx="14" ry="8" fill="#fff" opacity=".18" transform="rotate(-35 44 90)"/>`) },
  ],
  weapon: [
    { id: "sword", name: "Sword", grip: [60, 252], tip: [60, 22], size: 1.0,
      svg: wrap(`<path d="M60 12 L72 40 L72 206 L48 206 L48 40 Z" fill="#dfe6ee" stroke="#4a5568" stroke-width="5"/>
        <path d="M60 22 V200" stroke="#fff" stroke-width="3" opacity=".7"/>
        <rect x="26" y="204" width="68" height="14" rx="6" fill="#d9a441" stroke="#6b4a10" stroke-width="4"/>
        <rect x="52" y="218" width="16" height="64" rx="6" fill="#7a2f2f" stroke="#3a1414" stroke-width="4"/>
        <circle cx="60" cy="286" r="9" fill="#d9a441" stroke="#6b4a10" stroke-width="4"/>`) },
    { id: "dagger", name: "Dagger", grip: [60, 250], tip: [60, 120], size: 0.8,
      svg: wrap(`<path d="M60 112 L72 138 L70 214 L50 214 L48 138 Z" fill="#e6ebf2" stroke="#4a5568" stroke-width="5"/>
        <rect x="38" y="212" width="44" height="12" rx="5" fill="#a74b4b" stroke="#4a1c1c" stroke-width="4"/>
        <rect x="53" y="224" width="14" height="52" rx="6" fill="#3b2a24" stroke="#150e0c" stroke-width="4"/>
        <circle cx="60" cy="284" r="8" fill="#a74b4b" stroke="#4a1c1c" stroke-width="4"/>`) },
    { id: "spear", name: "Short spear", grip: [60, 290], tip: [60, 14], size: 1.0,
      svg: wrap(`<path d="M60 8 L74 52 L60 64 L46 52 Z" fill="#e6ebf2" stroke="#4a5568" stroke-width="5"/>
        <path d="M52 64 L68 64 L64 84 L56 84 Z" fill="#c0392b" stroke="#5c1a12" stroke-width="3"/>
        <rect x="55" y="82" width="10" height="208" rx="5" fill="#8a5a33" stroke="#3a2412" stroke-width="4"/>`) },
    { id: "axe", name: "Axe", grip: [60, 288], tip: [60, 60], size: 0.9,
      svg: wrap(`<rect x="55" y="40" width="10" height="250" rx="5" fill="#7a4d2b" stroke="#2f1b0f" stroke-width="4"/>
        <path d="M65 44 Q112 42 112 92 Q112 132 65 124 Z" fill="#d7dde6" stroke="#4a5568" stroke-width="5"/>
        <path d="M65 52 Q100 52 102 92" stroke="#fff" stroke-width="3" fill="none" opacity=".7"/>
        <path d="M55 52 L40 46 L55 74 Z" fill="#aab3bf" stroke="#4a5568" stroke-width="4"/>`) },
  ],
  shield: {
    id: "shield", name: "Shield", grip: [60, 150], head: [60, 150], headR: 1.0, size: 1.0,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 300" width="120" height="300"><g stroke-linejoin="round">
      <path d="M60 52 L108 70 Q112 142 60 214 Q8 142 12 70 Z" fill="#b5483a" stroke="#4a1c14" stroke-width="6"/>
      <path d="M60 66 L96 80 Q98 138 60 192 Q22 138 24 80 Z" fill="#d9a441" stroke="#6b4a10" stroke-width="4"/>
      <circle cx="60" cy="130" r="20" fill="#b5483a" stroke="#4a1c14" stroke-width="4"/></g></svg>`,
  },
};

/* ------------------------------------------------------------------ */
/*  Quả cầu / vật phẩm                                                 */
/* ------------------------------------------------------------------ */
const ball = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${body}</svg>`;
export const BALLS = [
  { id: "pearl", name: "Dragon Pearl", svg: ball(`<defs><radialGradient id="g" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fffbe0"/><stop offset=".55" stop-color="#ffc94a"/><stop offset="1" stop-color="#e0891a"/></radialGradient></defs>
      <circle cx="50" cy="50" r="46" fill="url(#g)" stroke="#a5600c" stroke-width="4"/><path d="M28 56 Q50 30 72 52" stroke="#fff" stroke-width="5" fill="none" opacity=".6" stroke-linecap="round"/>`) },
  { id: "star", name: "Star", svg: ball(`<path d="M50 6 L62 36 L94 38 L69 58 L78 90 L50 72 L22 90 L31 58 L6 38 L38 36 Z" fill="#ffd34d" stroke="#b9770e" stroke-width="5" stroke-linejoin="round"/><path d="M50 22 L56 40" stroke="#fff" stroke-width="4" opacity=".7" stroke-linecap="round"/>`) },
  { id: "lantern", name: "Lantern", svg: ball(`<rect x="44" y="4" width="12" height="10" fill="#8a5a33"/><ellipse cx="50" cy="48" rx="34" ry="36" fill="#d93b2f" stroke="#6b1610" stroke-width="5"/><path d="M50 12 V84 M30 18 Q18 48 30 80 M70 18 Q82 48 70 80" stroke="#8a1f14" stroke-width="3" fill="none"/><rect x="40" y="82" width="20" height="8" fill="#e0a43a" stroke="#6b4a10" stroke-width="3"/><path d="M50 90 V100" stroke="#e0a43a" stroke-width="4" stroke-linecap="round"/>`) },
  { id: "shuttle", name: "Shuttlecock", svg: ball(`<path d="M30 20 L38 62 M50 14 V62 M70 20 L62 62" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/><path d="M26 18 Q50 4 74 18 L66 64 L34 64 Z" fill="#fff" stroke="#9aa3b2" stroke-width="4" stroke-linejoin="round"/><circle cx="50" cy="74" r="20" fill="#e8c24a" stroke="#7a5a10" stroke-width="5"/>`) },
];

export const findBall = (id) => BALLS.find((b) => b.id === id) || BALLS[0];
export function findEquipment(kind, id) {
  const list = EQUIPMENT[kind] || [];
  return list.find((e) => e.id === id) || list[0];
}