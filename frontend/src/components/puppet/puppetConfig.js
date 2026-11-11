// frontend/src/components/puppet/puppetConfig.js
// Toàn bộ hằng số của Puppet Stage nằm ở đây: muốn chỉnh độ khó, vị trí bàn, mapping ngón tay... chỉ cần sửa file này.

/* ------------------------------------------------------------------ */
/*  Sân khấu (toạ độ theo ảnh nền 1484 x 1060)                          */
/* ------------------------------------------------------------------ */
export const STAGE = {
  W: 1484,
  H: 1060,
  BG_URL: "/media/puppet/stage-bg.webp", // đặt ảnh sân khấu ở frontend/public/media/puppet/
};

export const LAYOUT = {
  TABLE_L: 405,        // mép trái mặt bàn
  TABLE_R: 1082,       // mép phải mặt bàn
  TABLE_Y: 698,        // mặt bàn (quả cầu nảy ở độ cao này)
  NET_X: 742,          // cột gỗ ở giữa bàn
  NET_TOP: 606,        // đỉnh cột
  FLOOR_Y: 858,        // chân con rối đứng ở đây
  USER_X_MIN: 150,     // vùng con rối của người chơi (bên trái bàn)
  USER_X_MAX: 380,
  AI_X: 1225,          // vị trí con rối AI (bên phải bàn)
  PUPPET_H: 340,       // chiều cao con rối trên sân khấu
};

/* ------------------------------------------------------------------ */
/*  Khung xương                                                        */
/* ------------------------------------------------------------------ */
// "R"/"L" là tay/chân của CON RỐI nhìn từ phía khán giả: R nằm bên TRÁI màn hình, L nằm bên PHẢI.
export const JOINT_NAMES = [
  "head", "neck",
  "shoulderR", "elbowR", "wristR",
  "shoulderL", "elbowL", "wristL",
  "hip", "hipR", "kneeR", "ankleR",
  "hipL", "kneeL", "ankleL",
];

/* ------------------------------------------------------------------ */
/*  Bàn tay -> con rối                                                 */
/* ------------------------------------------------------------------ */
// Chỉ số landmark của MediaPipe Hands
export const FINGERS = {
  thumb:  { tip: 4,  base: 2 },
  index:  { tip: 8,  base: 5 },
  middle: { tip: 12, base: 9 },
  ring:   { tip: 16, base: 13 },
  pinky:  { tip: 20, base: 17 },
};
// MAPPING NGÓN TAY -> BỘ PHẬN CON RỐI (đổi ở đây là đổi toàn bộ game, không cần sửa chỗ khác):
//   mỗi ngón điều khiển ĐÚNG MỘT bộ phận:  "head" | "armR" | "armL" | "legR" | "legL"
//   "R"/"L" là bên của CON RỐI nhìn từ khán giả: R nằm bên TRÁI màn hình, L nằm bên PHẢI màn hình.
// Hiện tại: ngón cái = tay cầm vợt | ngón út = tay cầm vũ khí | ngón trỏ + ngón áp út = hai chân | ngón giữa = đầu
export const LIMB_BY_FINGER = {
  middle: "head",
  thumb: "armL",     // tay cầm vợt (xem HAND_ROLES)
  pinky: "armR",     // tay cầm vũ khí
  index: "legR",
  ring: "legL",
};
// Tay nào cầm gì: armL (bên phải màn hình, gần bàn) cầm vợt, armR cầm vũ khí.
export const HAND_ROLES = { armL: "racket", armR: "weapon" };

// Ngón ngắn (cái, út) di chuyển ít hơn ngón dài nên cần khuếch đại thêm để tay con rối với tới được.
export const FINGER_GAIN = { thumb: 1.9, index: 1, middle: 1, ring: 1, pinky: 1.35 };

// Suy ra tự động từ hai bảng trên (đừng sửa):
export const fingerOfLimb = (limb) => Object.keys(LIMB_BY_FINGER).find((f) => LIMB_BY_FINGER[f] === limb);
export const armWithRole = (role) => Object.keys(HAND_ROLES).find((a) => HAND_ROLES[a] === role);
export const WEAPON_FINGER = fingerOfLimb(armWithRole("weapon"));   // ngón cầm vũ khí -> dùng để nhận cú vung
export const RACKET_FINGER = fingerOfLimb(armWithRole("racket"));

export const TRACKING = {
  WASM_URL: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  MODULE_URL: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
  MODEL_URL: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  MIN_CONFIDENCE: 0.5,
  SMOOTH: 0.45,            // 0 = mượt tối đa, 1 = không lọc
  LOST_MS: 700,            // mất tay quá lâu thì tạm dừng
  ROOT_X_RANGE: [0.2, 0.8],// vùng bàn tay trong khung hình ứng với toàn bộ sân bên trái
  JUMP_PER_UNIT: 520,      // nâng bàn tay lên thì con rối nhảy (px sân khấu / đơn vị khung hình)
  JUMP_MAX: 150,
  FINGER_REACH: 2.5,       // ngón duỗi thẳng ~ 2.5 lần kích thước bàn tay
  SWING_SPEED: 6.5,        // CÚ GẠT NHANH: tốc độ đầu ngón (đơn vị bàn tay / giây)
  SWEEP_DIST: 0.2,         // CÚ QUÉT CHẬM: bàn tay đi sang phải ít nhất ngần này bề rộng khung hình...
  SWEEP_MS: 700,           // ...trong khoảng thời gian này
  SWING_MIN_DIR_X: 0.55,   // phải vung sang PHẢI (trên màn hình đã lật gương)
  SWING_COOLDOWN_MS: 650,
};

/* ------------------------------------------------------------------ */
/*  Vật lý & luật chơi                                                 */
/* ------------------------------------------------------------------ */
export const PHYSICS = {
  GRAVITY: 1500,
  BALL_R: 17,
  RESTITUTION_TABLE: 0.8,
  RACKET_R: 52,            // bán kính vùng đánh của vợt
  RACKET_BOUNCE: 0.9,
  RETURN_MIN: 520,         // tốc độ tối thiểu sau cú đánh
  RETURN_MAX: 1350,
  SWING_TRANSFER: 0.55,    // tốc độ vung của vợt truyền sang quả cầu
};

export const RULES = {
  LIVES: 3,
  MATCH_POINT: 5,          // user đạt số điểm này -> kích hoạt cao trào
  ENERGY_PER_RETURN: 18,
  ENERGY_FAST_BONUS: 8,
  ENERGY_MAX: 100,
  SERVE_DELAY: 1.1,
  COUNTDOWN: 3,
};

export const AI = {
  RETURN_CHANCE_START: 0.93,   // xác suất đỡ được cú đầu
  RETURN_CHANCE_MIN: 0.62,     // càng đánh lâu càng khó (nhưng không dưới mức này)
  RETURN_DECAY_PER_HIT: 0.035,
  REACH_X: 150,                // quả cầu vào vùng này thì AI mới đỡ
  SPEED_START: 760,
  SPEED_GAIN: 55,
};

export const FINISHER = {
  JUMP_HEIGHT: 300,
  INTRO: 1.5,                  // giây: con rối bật nhảy, quả cầu dừng lơ lửng
  WINDOW: 7,                   // giây người chơi phải vung tay
  GUARD_SWITCH: 0.62,          // AI đổi tư thế khiên mỗi ... giây (CAO / GIỮA / THẤP)
  BLOCK_TOLERANCE: 0,          // 0 = chỉ đỡ khi trùng tầng
};

export const PUPPET_VIEW = {
  TEXTURE_MAX: 560,            // cạnh dài nhất của texture sau khi làm sạch
  MIN_SIDE: 240,               // ảnh upload nhỏ hơn mức này bị từ chối
};