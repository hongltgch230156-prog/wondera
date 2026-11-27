// Hằng số và hàm hình học của Puppet Stage
import {
  STAGE, LAYOUT, depthScale, carpetLeft, carpetRight, userWalkX, JOINT_NAMES, FINGERS, LIMB_BY_FINGER,
  HAND_ROLES, FINGER_GAIN, fingerOfLimb, armWithRole, WEAPON_FINGER, RACKET_FINGER, TRACKING, PHYSICS, RULES, AI, FINISHER, PUPPET_VIEW,
} from '../src/components/puppet/puppetConfig.js';

describe('sân khấu và bố cục', () => {
  test('kích thước ảnh nền 1484x1060', () => expect([STAGE.W, STAGE.H]).toEqual([1484, 1060]));
  test('bàn nằm trong sân khấu và cột lưới nằm giữa bàn', () => {
    expect(LAYOUT.TABLE_L).toBeLessThan(LAYOUT.NET_X);
    expect(LAYOUT.NET_X).toBeLessThan(LAYOUT.TABLE_R);
    expect(LAYOUT.TABLE_R).toBeLessThan(STAGE.W);
  });
  test('NET_X gần như chính giữa bàn', () => {
    expect(Math.abs(LAYOUT.NET_X - (LAYOUT.TABLE_L + LAYOUT.TABLE_R) / 2)).toBeLessThan(5);
  });
  test('đỉnh cột cao hơn mặt bàn (y nhỏ hơn)', () => expect(LAYOUT.NET_TOP).toBeLessThan(LAYOUT.TABLE_Y));
  test('sàn thấp hơn mặt bàn', () => expect(LAYOUT.FLOOR_Y).toBeGreaterThan(LAYOUT.TABLE_Y));
  test('người chơi đứng bên trái bàn, AI bên phải bàn', () => {
    expect(LAYOUT.USER_X_MAX).toBeLessThan(LAYOUT.TABLE_L);
    expect(LAYOUT.AI_X).toBeGreaterThan(LAYOUT.TABLE_R);
  });
  test('vị trí khởi tạo của người chơi nằm trong vùng đi lại', () => {
    expect(LAYOUT.USER_START_X).toBeGreaterThanOrEqual(LAYOUT.USER_X_MIN);
    expect(LAYOUT.USER_START_X).toBeLessThanOrEqual(LAYOUT.USER_X_MAX);
  });
  test('khoảng độ sâu hợp lệ: DEPTH_Y_MIN < STAND_Y < DEPTH_Y_MAX', () => {
    expect(LAYOUT.DEPTH_Y_MIN).toBeLessThan(LAYOUT.STAND_Y);
    expect(LAYOUT.STAND_Y).toBeLessThan(LAYOUT.DEPTH_Y_MAX);
  });
  test('độ sâu tối đa vẫn nằm trong mép trước của thảm', () => expect(LAYOUT.DEPTH_Y_MAX).toBeLessThanOrEqual(LAYOUT.CARPET.FRONT_Y));
});

describe('depthScale', () => {
  test('bằng 1 tại STAND_Y', () => expect(depthScale(LAYOUT.STAND_Y)).toBeCloseTo(1, 10));
  test('bằng 0 tại đường chân trời', () => expect(depthScale(LAYOUT.HORIZON_Y)).toBeCloseTo(0, 10));
  test('lùi vào trong (y nhỏ) thì nhỏ hơn 1, tiến ra trước thì lớn hơn 1', () => {
    expect(depthScale(LAYOUT.DEPTH_Y_MIN)).toBeLessThan(1);
    expect(depthScale(LAYOUT.DEPTH_Y_MAX)).toBeGreaterThan(1);
  });
  test('tăng đơn điệu theo y', () => {
    for (let y = 600; y < 900; y += 25) expect(depthScale(y + 25)).toBeGreaterThan(depthScale(y));
  });
});

describe('mép thảm', () => {
  const C = LAYOUT.CARPET;
  test('mép trái tại cạnh sau/trước khớp số đo', () => {
    expect(carpetLeft(C.BACK_Y)).toBe(C.LEFT_BACK);
    expect(carpetLeft(C.FRONT_Y)).toBe(C.LEFT_FRONT);
  });
  test('mép phải tại cạnh sau/trước khớp số đo', () => {
    expect(carpetRight(C.BACK_Y)).toBe(C.RIGHT_BACK);
    expect(carpetRight(C.FRONT_Y)).toBe(C.RIGHT_FRONT);
  });
  test('thảm rộng ra khi tiến về phía khán giả (phối cảnh)', () => {
    const w = (y) => carpetRight(y) - carpetLeft(y);
    expect(w(C.FRONT_Y)).toBeGreaterThan(w(C.BACK_Y));
  });
  test('nội suy tuyến tính ở giữa', () => {
    const mid = (C.BACK_Y + C.FRONT_Y) / 2;
    expect(carpetLeft(mid)).toBeCloseTo((C.LEFT_BACK + C.LEFT_FRONT) / 2, 6);
  });
});

describe('userWalkX', () => {
  test('max luôn là USER_X_MAX', () => {
    [780, 810, 836].forEach((y) => expect(userWalkX(y).max).toBe(LAYOUT.USER_X_MAX));
  });
  test('min không nhỏ hơn USER_X_MIN', () => {
    [780, 810, 836].forEach((y) => expect(userWalkX(y).min).toBeGreaterThanOrEqual(LAYOUT.USER_X_MIN));
  });
  test('min < max trên toàn bộ vùng độ sâu cho phép', () => {
    for (let y = LAYOUT.DEPTH_Y_MIN; y <= LAYOUT.DEPTH_Y_MAX; y += 4) {
      const r = userWalkX(y);
      expect(r.min).toBeLessThan(r.max);
    }
  });
  test('vị trí khởi tạo luôn đi được ở độ sâu mặc định', () => {
    const r = userWalkX(LAYOUT.STAND_Y);
    expect(LAYOUT.USER_START_X).toBeGreaterThanOrEqual(r.min);
    expect(LAYOUT.USER_START_X).toBeLessThanOrEqual(r.max);
  });
});

describe('khung xương và ánh xạ ngón tay', () => {
  test('15 khớp, không trùng tên', () => {
    expect(JOINT_NAMES).toHaveLength(15);
    expect(new Set(JOINT_NAMES).size).toBe(15);
  });
  test('có đủ khớp đối xứng R/L', () => {
    ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'].forEach((j) => {
      expect(JOINT_NAMES).toContain(`${j}R`);
      expect(JOINT_NAMES).toContain(`${j}L`);
    });
  });
  test.each([['thumb', 4, 2], ['index', 8, 5], ['middle', 12, 9], ['ring', 16, 13], ['pinky', 20, 17]])('ngón %s: tip=%i base=%i (chuẩn MediaPipe)', (f, tip, base) => {
    expect(FINGERS[f]).toEqual({ tip, base });
  });
  test('mỗi ngón điều khiển đúng một bộ phận, không bộ phận nào bị hai ngón điều khiển', () => {
    expect(Object.keys(LIMB_BY_FINGER).sort()).toEqual(Object.keys(FINGERS).sort());
    const limbs = Object.values(LIMB_BY_FINGER);
    expect(new Set(limbs).size).toBe(limbs.length);
  });
  test('5 bộ phận: head, armL, armR, legL, legR', () => {
    expect(Object.values(LIMB_BY_FINGER).sort()).toEqual(['armL', 'armR', 'head', 'legL', 'legR']);
  });
  test('ngón cái cầm vợt, ngón út cầm vũ khí', () => {
    expect(RACKET_FINGER).toBe('thumb');
    expect(WEAPON_FINGER).toBe('pinky');
  });
  test('fingerOfLimb và armWithRole là hàm ngược nhau', () => {
    expect(fingerOfLimb('head')).toBe('middle');
    expect(fingerOfLimb('nope')).toBeUndefined();
    expect(armWithRole('racket')).toBe('armL');
    expect(armWithRole('weapon')).toBe('armR');
    expect(armWithRole('nope')).toBeUndefined();
  });
  test('HAND_ROLES: hai tay cầm hai thứ khác nhau', () => {
    expect(new Set(Object.values(HAND_ROLES)).size).toBe(2);
  });
  test('mọi ngón đều có hệ số khuếch đại dương; ngón ngắn (cái, út) lớn hơn 1', () => {
    Object.keys(FINGERS).forEach((f) => expect(FINGER_GAIN[f]).toBeGreaterThan(0));
    expect(FINGER_GAIN.thumb).toBeGreaterThan(1);
    expect(FINGER_GAIN.pinky).toBeGreaterThan(1);
  });
});

describe('thông số game hợp lý', () => {
  test('TRACKING: các URL dùng https, ngưỡng tin cậy trong (0,1]', () => {
    [TRACKING.WASM_URL, TRACKING.MODULE_URL, TRACKING.MODEL_URL].forEach((u) => expect(u.startsWith('https://')).toBe(true));
    expect(TRACKING.MIN_CONFIDENCE).toBeGreaterThan(0);
    expect(TRACKING.MIN_CONFIDENCE).toBeLessThanOrEqual(1);
  });
  test('TRACKING: SMOOTH trong (0,1], khoảng tay nằm trong [0,1] và tăng dần', () => {
    expect(TRACKING.SMOOTH).toBeGreaterThan(0);
    expect(TRACKING.SMOOTH).toBeLessThanOrEqual(1);
    [TRACKING.ROOT_X_RANGE, TRACKING.ROOT_Y_RANGE].forEach(([a, b]) => { expect(a).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(1); expect(a).toBeLessThan(b); });
  });
  test('TRACKING: phiên bản MediaPipe trong URL khớp nhau (0.10.14)', () => {
    expect(TRACKING.WASM_URL).toContain('0.10.14');
    expect(TRACKING.MODULE_URL).toContain('0.10.14');
  });
  test('PHYSICS: trọng lực dương, độ nảy trong (0,1], tốc độ trả bóng min < max', () => {
    expect(PHYSICS.GRAVITY).toBeGreaterThan(0);
    expect(PHYSICS.RESTITUTION_TABLE).toBeGreaterThan(0);
    expect(PHYSICS.RESTITUTION_TABLE).toBeLessThanOrEqual(1);
    expect(PHYSICS.RETURN_MIN).toBeLessThan(PHYSICS.RETURN_MAX);
  });
  test('RULES: 3 mạng, thắng ở 5 điểm, năng lượng đầy sau vài cú đánh', () => {
    expect(RULES.LIVES).toBe(3);
    expect(RULES.MATCH_POINT).toBe(5);
    expect(Math.ceil(RULES.ENERGY_MAX / RULES.ENERGY_PER_RETURN)).toBeLessThanOrEqual(10);
  });
  test('AI: xác suất đỡ giảm dần nhưng có sàn, và sàn < xuất phát', () => {
    expect(AI.RETURN_CHANCE_MIN).toBeLessThan(AI.RETURN_CHANCE_START);
    expect(AI.RETURN_CHANCE_START).toBeLessThanOrEqual(1);
    expect(AI.RETURN_DECAY_PER_HIT).toBeGreaterThan(0);
  });
  test('FINISHER: cửa sổ vung dài hơn thời gian đổi khiên, thời gian ném đều dương', () => {
    expect(FINISHER.WINDOW).toBeGreaterThan(FINISHER.GUARD_SWITCH);
    Object.values(FINISHER.THROW).forEach((v) => expect(v).toBeGreaterThan(0));
    expect(FINISHER.THROW.RELEASE).toBeLessThan(FINISHER.THROW.SWEEP);
  });
  test('PUPPET_VIEW: cạnh tối thiểu < cạnh tối đa của texture', () => {
    expect(PUPPET_VIEW.MIN_SIDE).toBeLessThan(PUPPET_VIEW.TEXTURE_MAX);
    expect(PUPPET_VIEW.MIN_SIDE).toBe(240);
  });
});
