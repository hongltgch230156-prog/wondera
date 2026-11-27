// Xử lý ảnh nhân vật -> xương: tách nền, dựng rig mẫu, phân tích T-pose, chỉnh khớp, kiểm tra hợp lệ
import { removeBackground, templateRig, analyzeRig, mirrorName, refreshDerived, moveJoint, cloneRig, serializeRig, deserializeRig, boneLengths, validatePuppet } from '../src/components/puppet/rigEngine.js';

/** Tạo ảnh RGBA nền `bg`, vẽ các hình chữ nhật (x,y,w,h,[r,g,b,a]) */
const canvas = (w, h, bg, rects = []) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) d.set(bg, i * 4);
  rects.forEach(([rx, ry, rw, rh, c]) => {
    for (let y = ry; y < ry + rh; y += 1) for (let x = rx; x < rx + rw; x += 1) d.set(c, (y * w + x) * 4);
  });
  return d;
};
const alphaAt = (d, w, x, y) => d[(y * w + x) * 4 + 3];
const CLEAR = [0, 0, 0, 0], OPAQUE = (r, g, b) => [r, g, b, 255];

// Nhân vật T-pose giả 200x300 trên nền trong suốt
const tPose = () => {
  const w = 200, h = 300, c = OPAQUE(40, 60, 200);
  const data = canvas(w, h, CLEAR, [
    [88, 20, 24, 30, c],   // đầu
    [94, 50, 12, 10, c],   // cổ
    [80, 60, 40, 80, c],   // thân
    [10, 66, 180, 14, c],  // hai tay dang ngang
    [82, 140, 16, 140, c], // chân trái
    [102, 140, 16, 140, c],// chân phải
  ]);
  return { width: w, height: h, data };
};

describe('removeBackground', () => {
  const W = 40, H = 40;
  test('nền trắng đồng nhất bị xoá (alpha=0), vật thể màu giữ nguyên', () => {
    const d = canvas(W, H, OPAQUE(255, 255, 255), [[15, 15, 10, 10, OPAQUE(200, 30, 30)]]);
    removeBackground(d, W, H);
    expect(alphaAt(d, W, 0, 0)).toBe(0);
    expect(alphaAt(d, W, W - 1, H - 1)).toBe(0);
    expect(alphaAt(d, W, 20, 20)).toBe(255);
  });
  test('nền màu đồng nhất (xanh lá) cũng bị xoá', () => {
    const d = canvas(W, H, OPAQUE(20, 180, 60), [[15, 15, 10, 10, OPAQUE(200, 30, 30)]]);
    removeBackground(d, W, H);
    expect(alphaAt(d, W, 1, 1)).toBe(0);
    expect(alphaAt(d, W, 20, 20)).toBe(255);
  });
  test('ảnh toàn một màu -> trả về số "nhiễu nền" bằng 0', () => {
    const d = canvas(W, H, OPAQUE(255, 255, 255));
    expect(removeBackground(d, W, H)).toBe(0);
  });
  test('nền nhiễu hơn thì độ nhiễu trả về lớn hơn nền phẳng', () => {
    const flat = canvas(W, H, OPAQUE(240, 240, 240));
    const noisy = canvas(W, H, OPAQUE(240, 240, 240));
    for (let i = 0; i < W; i += 2) noisy.set([200, 200, 200, 255], i * 4);
    expect(removeBackground(noisy, W, H)).toBeGreaterThan(removeBackground(flat, W, H));
  });
  test('vật thể trắng ngà nằm giữa nền trắng không bị "ăn lẹm" hoàn toàn bởi flood-fill từ viền khi có viền đen bao quanh', () => {
    const d = canvas(W, H, OPAQUE(255, 255, 255), [[10, 10, 20, 20, OPAQUE(0, 0, 0)], [12, 12, 16, 16, OPAQUE(250, 245, 235)]]);
    removeBackground(d, W, H);
    expect(alphaAt(d, W, 20, 20)).toBe(255);
  });
  test('điểm ảnh bị xoá nền cũng được xoá màu hoặc alpha, không để lại viền trắng ở góc', () => {
    const d = canvas(W, H, OPAQUE(255, 255, 255), [[15, 15, 10, 10, OPAQUE(10, 10, 10)]]);
    removeBackground(d, W, H);
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1]]) expect(alphaAt(d, W, x, y)).toBe(0);
  });
});

describe('templateRig', () => {
  test('toàn bộ 15 khớp tồn tại', () => {
    const r = templateRig(200, 400);
    ['head', 'neck', 'shoulderR', 'elbowR', 'wristR', 'shoulderL', 'elbowL', 'wristL', 'hip', 'hipR', 'kneeR', 'ankleR', 'hipL', 'kneeL', 'ankleL'].forEach((k) => expect(r.joints).toHaveProperty(k));
  });
  test('mặc định dùng toàn khung ảnh, trục thân ở giữa', () => {
    const r = templateRig(200, 400);
    expect(r.bounds).toEqual({ x: 0, y: 0, w: 200, h: 400 });
    expect(r.axisX).toBe(100);
  });
  test('tuân theo bounds truyền vào', () => {
    const r = templateRig(500, 500, { x: 100, y: 50, w: 200, h: 400 });
    expect(r.axisX).toBe(200);
    expect(r.joints.head.x).toBeCloseTo(200, 6);
    expect(r.joints.head.y).toBeCloseTo(50 + 400 * 0.1, 6);
  });
  test('đối xứng qua trục thân: R và L cách đều trục', () => {
    const r = templateRig(200, 400);
    ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'].forEach((j) => {
      expect(r.axisX - r.joints[`${j}R`].x).toBeCloseTo(r.joints[`${j}L`].x - r.axisX, 6);
    });
  });
  test('thứ tự theo chiều dọc: đầu < cổ < vai < hông < gối < mắt cá', () => {
    const j = templateRig(200, 400).joints;
    const ys = [j.head.y, j.neck.y, j.shoulderR.y, j.hip.y, j.kneeR.y, j.ankleR.y];
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
  test('độ tin cậy thấp (0.2) và có ghi chú dùng tỉ lệ mẫu', () => {
    const r = templateRig(100, 100);
    expect(r.confidence).toBe(0.2);
    expect(r.notes[0]).toMatch(/Template/);
  });
  test('mọi khớp nằm trong ảnh', () => {
    const r = templateRig(300, 500);
    Object.values(r.joints).forEach((p) => { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(300); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(500); });
  });
});

describe('analyzeRig', () => {
  test('ảnh trống -> report.empty và rig mẫu', () => {
    const img = { width: 50, height: 50, data: canvas(50, 50, CLEAR) };
    const { rig, report } = analyzeRig(img);
    expect(report.empty).toBe(true);
    expect(report.coverage).toBe(0);
    expect(rig.confidence).toBe(0.2);
  });
  test('bounds đúng bằng khung chữ nhật bao quanh nhân vật', () => {
    const { report } = analyzeRig(tPose());
    expect(report.bounds).toEqual({ x: 10, y: 20, w: 180, h: 260 });
  });
  test('coverage = tỉ lệ điểm ảnh đục', () => {
    const img = { width: 10, height: 10, data: canvas(10, 10, CLEAR, [[0, 0, 5, 10, OPAQUE(1, 1, 1)]]) };
    expect(analyzeRig(img).report.coverage).toBeCloseTo(0.5, 6);
  });
  test('nhận ra tay dang ngang (armRatio ≥ 1.5)', () => {
    expect(analyzeRig(tPose()).report.armRatio).toBeGreaterThanOrEqual(1.5);
  });
  test('nhận ra hai chân tách nhau', () => expect(analyzeRig(tPose()).report.legsSplit).toBe(true));
  test('hai chân dính liền -> legsSplit=false', () => {
    const c = OPAQUE(1, 1, 1);
    const data = canvas(200, 300, CLEAR, [[88, 20, 24, 30, c], [80, 60, 40, 80, c], [10, 66, 180, 14, c], [82, 140, 36, 140, c]]);
    expect(analyzeRig({ width: 200, height: 300, data }).report.legsSplit).toBe(false);
  });
  test('toạ độ các khớp đều hữu hạn và nằm trong ảnh', () => {
    const { rig } = analyzeRig(tPose());
    Object.values(rig.joints).forEach((p) => { expect(Number.isFinite(p.x)).toBe(true); expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(200); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(300); });
  });
  test('vai nằm trên hông, hông nằm trên mắt cá; cổ tay phải ở bên trái, cổ tay trái bên phải', () => {
    const { joints: j } = analyzeRig(tPose()).rig;
    expect(j.shoulderR.y).toBeLessThan(j.hip.y);
    expect(j.hip.y).toBeLessThan(j.ankleR.y);
    expect(j.wristR.x).toBeLessThan(j.wristL.x);
  });
  test('trục thân nằm gần giữa nhân vật', () => {
    expect(Math.abs(analyzeRig(tPose()).rig.axisX - 100)).toBeLessThan(10);
  });
  test('rig có version, kích thước ảnh và widths dương', () => {
    const { rig } = analyzeRig(tPose());
    expect(rig.version).toBe(1);
    expect(rig.image).toEqual({ w: 200, h: 300 });
    Object.values(rig.widths).forEach((v) => expect(v).toBeGreaterThan(0));
  });
  test('shoulderInset là 0.85 (kiểu "pin") hoặc 0.35', () => {
    expect([0.85, 0.35]).toContain(analyzeRig(tPose()).rig.shoulderInset);
  });
  test('confidence trong [0,1]', () => {
    const c = analyzeRig(tPose()).rig.confidence;
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
  test('không đổi dữ liệu ảnh đầu vào', () => {
    const img = tPose(); const copy = Uint8ClampedArray.from(img.data);
    analyzeRig(img);
    expect(img.data).toEqual(copy);
  });
});

describe('mirrorName / refreshDerived', () => {
  test.each([['shoulderR', 'shoulderL'], ['elbowL', 'elbowR'], ['wristR', 'wristL'], ['hipL', 'hipR'], ['kneeR', 'kneeL'], ['ankleL', 'ankleR']])('%s <-> %s', (a, b) => expect(mirrorName(a)).toBe(b));
  test.each([['head'], ['neck'], ['hip'], ['nope']])('%s không có khớp đối xứng', (n) => expect(mirrorName(n)).toBeNull());
  test('hông giữa = trung điểm hai hông', () => {
    const r = templateRig(200, 400); r.joints.hipR = { x: 10, y: 20 }; r.joints.hipL = { x: 30, y: 40 };
    refreshDerived(r);
    expect(r.joints.hip).toEqual({ x: 20, y: 30 });
  });
  test('khuỷu tự suy ra = trung điểm vai-cổ tay khi chưa chỉnh tay', () => {
    const r = templateRig(200, 400);
    r.joints.wristR = { x: 0, y: 100 }; r.joints.shoulderR = { x: 100, y: 100 };
    refreshDerived(r);
    expect(r.joints.elbowR).toEqual({ x: 50, y: 100 });
  });
  test('khuỷu đã chỉnh tay (manual) thì được giữ nguyên', () => {
    const r = templateRig(200, 400); r.manual.push('elbowR'); const before = { ...r.joints.elbowR };
    r.joints.wristR = { x: 0, y: 0 };
    refreshDerived(r);
    expect(r.joints.elbowR).toEqual(before);
  });
  test('đầu gối tự suy ra = trung điểm hông-mắt cá', () => {
    const r = templateRig(200, 400);
    refreshDerived(r);
    expect(r.joints.kneeR.y).toBeCloseTo((r.joints.hipR.y + r.joints.ankleR.y) / 2, 6);
  });
});

describe('moveJoint', () => {
  test('đặt khớp tới toạ độ mới và đánh dấu là chỉnh tay', () => {
    const r = templateRig(200, 400);
    moveJoint(r, 'wristR', 30, 40);
    expect(r.joints.wristR).toEqual({ x: 30, y: 40 });
    expect(r.manual).toContain('wristR');
  });
  test('toạ độ bị kẹp trong khung ảnh', () => {
    const r = templateRig(200, 400);
    moveJoint(r, 'wristL', 9999, -50);
    expect(r.joints.wristL).toEqual({ x: 200, y: 0 });
  });
  test('kéo nhiều lần không thêm trùng vào danh sách manual', () => {
    const r = templateRig(200, 400);
    moveJoint(r, 'wristR', 1, 1); moveJoint(r, 'wristR', 2, 2);
    expect(r.manual.filter((n) => n === 'wristR')).toHaveLength(1);
  });
  test('mirror=true: khớp đối xứng đi theo qua trục thân', () => {
    const r = templateRig(200, 400);
    moveJoint(r, 'wristR', 20, 90, true);
    expect(r.joints.wristL).toEqual({ x: 2 * r.axisX - 20, y: 90 });
    expect(r.manual).toContain('wristL');
  });
  test('mirror=true với khớp không có đối xứng (head) không lỗi', () => {
    const r = templateRig(200, 400);
    expect(() => moveJoint(r, 'head', 100, 20, true)).not.toThrow();
  });
  test('kéo hông giữa: cả hai hông tịnh tiến theo và hông giữa nằm ở vị trí mới', () => {
    const r = templateRig(200, 400);
    const gap = r.joints.hipL.x - r.joints.hipR.x;
    moveJoint(r, 'hip', 120, 250);
    expect(r.joints.hipL.x - r.joints.hipR.x).toBeCloseTo(gap, 6);
    expect(r.joints.hip.x).toBeCloseTo(120, 6);
  });
  test('kéo hông giữa không bị tính là "manual"', () => {
    const r = templateRig(200, 400);
    moveJoint(r, 'hip', 100, 200);
    expect(r.manual).not.toContain('hip');
  });
  test('kéo cổ tay làm khuỷu (chưa chỉnh tay) dịch theo', () => {
    const r = templateRig(200, 400);
    const before = { ...r.joints.elbowR };
    moveJoint(r, 'wristR', 0, 300);
    expect(r.joints.elbowR).not.toEqual(before);
  });
});

describe('cloneRig / serialize / boneLengths / validatePuppet', () => {
  test('cloneRig là bản sao sâu', () => {
    const r = templateRig(100, 200); const c = cloneRig(r);
    c.joints.head.x = 999;
    expect(r.joints.head.x).not.toBe(999);
  });
  test('serialize -> deserialize cho lại đúng dữ liệu', () => {
    const r = templateRig(100, 200);
    expect(deserializeRig(serializeRig(r))).toEqual(r);
  });
  test('boneLengths: mọi đoạn xương dương, hai bên đối xứng bằng nhau với rig mẫu', () => {
    const b = boneLengths(templateRig(200, 400));
    Object.values(b).forEach((v) => expect(v).toBeGreaterThan(0));
    expect(b.upperArmR).toBeCloseTo(b.upperArmL, 6);
    expect(b.thighR).toBeCloseTo(b.thighL, 6);
  });
  test('boneLengths: giá trị cụ thể của rig mẫu 200x400', () => {
    const b = boneLengths(templateRig(200, 400));
    expect(b.torso).toBeCloseTo(Math.hypot(0, (0.54 - 0.19) * 400), 6);
  });

  const good = () => ({
    clean: { srcSize: [800, 1200], hadAlpha: true, touchesBorder: 0, bgSpread: 0 },
    report: { empty: false, coverage: 0.3, bounds: { w: 400, h: 800 }, armRatio: 2, legsSplit: true, neckDistinct: true },
    rig: { confidence: 0.9 },
  });
  const levels = (v) => v.items.map((i) => i.level);

  test('ảnh tốt -> ok, không có cảnh báo', () => {
    const v = validatePuppet(good());
    expect(v.ok).toBe(true);
    expect(levels(v)).not.toContain('warn');
    expect(levels(v)).not.toContain('error');
    expect(v.confidence).toBe(0.9);
  });
  test('ảnh rỗng -> không ok và chỉ có 1 lỗi', () => {
    const g = good(); g.report.empty = true;
    const v = validatePuppet(g);
    expect(v.ok).toBe(false);
    expect(v.items).toHaveLength(1);
    expect(v.items[0].level).toBe('error');
  });
  test('clean.empty cũng bị coi là rỗng', () => {
    const g = good(); g.clean.empty = true;
    expect(validatePuppet(g).ok).toBe(false);
  });
  test('cạnh ngắn < 240px -> lỗi "too small"', () => {
    const g = good(); g.clean.srcSize = [200, 900];
    const v = validatePuppet(g);
    expect(v.ok).toBe(false);
    expect(v.items.some((i) => i.level === 'error' && /too small/.test(i.text))).toBe(true);
  });
  test('cạnh ngắn đúng 240px vẫn hợp lệ', () => {
    const g = good(); g.clean.srcSize = [240, 900];
    expect(validatePuppet(g).ok).toBe(true);
  });
  test('nền không đồng nhất (bgSpread > 18, không alpha) -> cảnh báo nhưng vẫn ok', () => {
    const g = good(); g.clean.hadAlpha = false; g.clean.bgSpread = 25;
    const v = validatePuppet(g);
    expect(v.ok).toBe(true);
    expect(v.items.some((i) => i.level === 'warn' && /Background/.test(i.text))).toBe(true);
  });
  test('nhân vật quá nhỏ (coverage < 0.04) -> cảnh báo', () => {
    const g = good(); g.report.coverage = 0.01;
    expect(validatePuppet(g).items.some((i) => /very small/.test(i.text))).toBe(true);
  });
  test.each([[400, 200], [100, 400]])('tỉ lệ bất thường (w=%i,h=%i) -> cảnh báo', (w, h) => {
    const g = good(); g.report.bounds = { w, h };
    expect(validatePuppet(g).items.some((i) => /proportions/.test(i.text))).toBe(true);
  });
  test('chạm viền ảnh (>= 2 cạnh) -> cảnh báo', () => {
    const g = good(); g.clean.touchesBorder = 2;
    expect(validatePuppet(g).items.some((i) => /touches/.test(i.text))).toBe(true);
  });
  test('tay không dang ngang -> cảnh báo T-pose', () => {
    const g = good(); g.report.armRatio = 1.2;
    expect(validatePuppet(g).items.some((i) => i.level === 'warn' && /T-pose/.test(i.text))).toBe(true);
  });
  test('chân dính nhau -> cảnh báo', () => {
    const g = good(); g.report.legsSplit = false;
    expect(validatePuppet(g).items.some((i) => i.level === 'warn' && /Legs/.test(i.text))).toBe(true);
  });
  test('cổ không rõ -> cảnh báo', () => {
    const g = good(); g.report.neckDistinct = false;
    expect(validatePuppet(g).items.some((i) => i.level === 'warn' && /neck/i.test(i.text))).toBe(true);
  });
  test('chỉ cảnh báo thì vẫn ok=true (không chặn người dùng)', () => {
    const g = good(); g.report.legsSplit = false; g.report.neckDistinct = false; g.report.armRatio = 1;
    expect(validatePuppet(g).ok).toBe(true);
  });
});
