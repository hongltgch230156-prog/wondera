// Toán học dựng tư thế con rối: IK 2 xương, ma trận affine, solvePose, vị trí vũ khí
import { ik2, boneXf, pivotXf, applyXf, restShoulderPivot, solvePose, equipmentFrame, SHOULDER_INSET } from '../src/components/puppet/poseSolver.js';

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Rig T-pose đơn giản: thân thẳng đứng, tay dang ngang, chân thẳng xuống (toạ độ texture)
const rig = (extra = {}) => ({
  joints: {
    head: { x: 100, y: 40 }, neck: { x: 100, y: 70 },
    shoulderR: { x: 80, y: 80 }, elbowR: { x: 40, y: 80 }, wristR: { x: 0, y: 80 },
    shoulderL: { x: 120, y: 80 }, elbowL: { x: 160, y: 80 }, wristL: { x: 200, y: 80 },
    hip: { x: 100, y: 160 }, hipR: { x: 90, y: 160 }, kneeR: { x: 90, y: 220 }, ankleR: { x: 90, y: 280 },
    hipL: { x: 110, y: 160 }, kneeL: { x: 110, y: 220 }, ankleL: { x: 110, y: 280 },
  },
  widths: { arm: 10 }, ...extra,
});

describe('ik2', () => {
  const S = { x: 0, y: 0 };
  const down = (c) => c.y;

  test('đầu cuối nằm trên đường thẳng tới mục tiêu khi với được', () => {
    const r = ik2(S, { x: 10, y: 0 }, 10, 10, down);
    expect(r.end.x).toBeCloseTo(10, 6);
    expect(r.end.y).toBeCloseTo(0, 6);
  });
  test('độ dài hai đoạn xương luôn được bảo toàn', () => {
    [[12, 5], [3, 3], [15, -8], [0.5, 0.2]].forEach(([x, y]) => {
      const r = ik2(S, { x, y }, 10, 10, down);
      expect(d(S, r.mid)).toBeCloseTo(10, 5);
      expect(d(r.mid, r.end)).toBeCloseTo(10, 5);
    });
  });
  test('mục tiêu quá xa: bị kẹp, không duỗi thẳng hoàn toàn (chừa 0.01)', () => {
    const r = ik2(S, { x: 100, y: 0 }, 10, 10, down);
    expect(d(S, r.end)).toBeCloseTo(20 - 0.01, 6);
  });
  test('reach = tổng hai đoạn xương', () => expect(ik2(S, { x: 5, y: 0 }, 8, 6, down).reach).toBe(14));
  test('mục tiêu trùng gốc không sinh NaN', () => {
    const r = ik2(S, { x: 0, y: 0 }, 10, 10, down);
    [r.mid.x, r.mid.y, r.end.x, r.end.y].forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });
  test('prefer chọn nghiệm khuỷu: ưu tiên y lớn -> khuỷu hướng xuống', () => {
    const r = ik2(S, { x: 10, y: 0 }, 10, 10, (c) => c.y);
    expect(r.mid.y).toBeGreaterThan(0);
    const r2 = ik2(S, { x: 10, y: 0 }, 10, 10, (c) => -c.y);
    expect(r2.mid.y).toBeLessThan(0);
  });
  test('minD: khoảng cách tối thiểu vai->cổ tay được tôn trọng', () => {
    const r = ik2(S, { x: 1, y: 0 }, 10, 10, down, 12);
    expect(d(S, r.end)).toBeCloseTo(12, 6);
  });
  test('maxD: khoảng cách tối đa được tôn trọng', () => {
    const r = ik2(S, { x: 19, y: 0 }, 10, 10, down, 0, null, 0, 15);
    expect(d(S, r.end)).toBeCloseTo(15, 6);
  });
  test('quán tính prevMid: giữ nghiệm cũ nếu nghiệm kia không hơn hẳn', () => {
    const prev = { x: 5, y: -8 }; // phía trên
    const r = ik2(S, { x: 10, y: 0 }, 10, 10, down, 0, prev, 1000);
    expect(r.mid.y).toBeLessThan(0);
  });
  test('quán tính prevMid: đổi nghiệm khi nghiệm kia hơn hẳn (margin nhỏ)', () => {
    const prev = { x: 5, y: -8 };
    const r = ik2(S, { x: 10, y: 0 }, 10, 10, down, 0, prev, 0);
    expect(r.mid.y).toBeGreaterThan(0);
  });
  test('hai xương khác độ dài vẫn giải đúng', () => {
    const r = ik2(S, { x: 12, y: 3 }, 9, 6, down);
    expect(d(S, r.mid)).toBeCloseTo(9, 5);
    expect(d(r.mid, r.end)).toBeCloseTo(6, 5);
  });
});

describe('ma trận affine', () => {
  const A = { x: 0, y: 0 }; const B = { x: 10, y: 0 };
  test('boneXf đưa điểm đầu xương về đúng chỗ', () => {
    const m = boneXf(A, B, { x: 5, y: 5 }, { x: 5, y: 15 }, 1);
    const p = applyXf(m, A);
    expect(p.x).toBeCloseTo(5, 6); expect(p.y).toBeCloseTo(5, 6);
  });
  test('boneXf đưa điểm cuối xương lên đích khi scale=1 và cùng độ dài', () => {
    const m = boneXf(A, B, { x: 5, y: 5 }, { x: 5, y: 15 }, 1);
    const p = applyXf(m, B);
    expect(p.x).toBeCloseTo(5, 6); expect(p.y).toBeCloseTo(15, 6);
  });
  test('scale nhân đôi độ dài xương', () => {
    const m = boneXf(A, B, { x: 0, y: 0 }, { x: 0, y: 20 }, 2);
    expect(d(applyXf(m, A), applyXf(m, B))).toBeCloseTo(20, 6);
  });
  test('pivotXf với góc 0, scale 1 chỉ tịnh tiến', () => {
    const m = pivotXf({ x: 10, y: 10 }, { x: 50, y: 60 }, 0, 1);
    const p = applyXf(m, { x: 12, y: 14 });
    expect(p).toEqual({ x: 52, y: 64 });
  });
  test('pivotXf đặt đúng pivot tại vị trí mới', () => {
    const m = pivotXf({ x: 10, y: 10 }, { x: 50, y: 60 }, 1.2, 1.5);
    const p = applyXf(m, { x: 10, y: 10 });
    expect(p.x).toBeCloseTo(50, 6); expect(p.y).toBeCloseTo(60, 6);
  });
  test('pivotXf xoay 90 độ quanh pivot', () => {
    const m = pivotXf({ x: 0, y: 0 }, { x: 0, y: 0 }, Math.PI / 2, 1);
    const p = applyXf(m, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0, 6); expect(p.y).toBeCloseTo(1, 6);
  });
  test('ma trận đơn vị không đổi điểm', () => {
    expect(applyXf({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });
});

describe('restShoulderPivot', () => {
  test('lệch vào trong theo hướng vai -> khuỷu một khoảng SHOULDER_INSET × bề rộng tay', () => {
    const r = rig();
    const p = restShoulderPivot(r, 'R');
    expect(d(p, r.joints.shoulderR)).toBeCloseTo(SHOULDER_INSET * 10, 6);
    expect(p.x).toBeLessThan(r.joints.shoulderR.x); // tay R dang về bên trái
  });
  test('dùng rig.shoulderInset nếu có', () => {
    const r = rig({ shoulderInset: 0.35 });
    expect(d(restShoulderPivot(r, 'L'), r.joints.shoulderL)).toBeCloseTo(3.5, 6);
  });
  test('bề rộng tay = 0 thì pivot trùng vai', () => {
    const r = rig({ widths: { arm: 0 } });
    expect(restShoulderPivot(r, 'R')).toEqual(r.joints.shoulderR);
  });
});

describe('solvePose', () => {
  const params = (over = {}) => ({ scale: 1, root: { x: 500, y: 400 }, ...over });
  // với lean=0, scale=1 thân chỉ tịnh tiến (root - hip): khớp vai thực sự (pivot) = pivot lúc nghỉ + độ dịch đó
  const pivot = (side) => { const r = restShoulderPivot(rig(), side); const h = rig().joints.hip; return { x: r.x + 500 - h.x, y: r.y + 400 - h.y }; };

  test('khớp hông đặt đúng vị trí root', () => {
    expect(solvePose(rig(), params()).joints.hip).toEqual({ x: 500, y: 400 });
  });
  test('không có mục tiêu: giữ tư thế T gập tự nhiên (cổ tay cách vai đúng bằng chiều dài tay)', () => {
    const p = solvePose(rig(), params());
    const R = rig().joints;
    const armLen = d(restShoulderPivot(rig(), 'R'), R.elbowR) + d(R.elbowR, R.wristR);
    expect(d(p.joints.wristR, pivot('R'))).toBeCloseTo(armLen, 1); // IK chừa 0.01 để tránh điểm kỳ dị
  });
  test('trả về đủ ma trận cho 10 bộ phận', () => {
    const { xf } = solvePose(rig(), params());
    ['torso', 'head', 'upperArmR', 'foreArmR', 'upperArmL', 'foreArmL', 'thighR', 'shinR', 'thighL', 'shinL'].forEach((k) => expect(xf).toHaveProperty(k));
  });
  test('scale phóng đại khoảng cách giữa hai hông', () => {
    const a = solvePose(rig(), params({ scale: 1 })).joints;
    const b = solvePose(rig(), params({ scale: 2 })).joints;
    expect(d(b.hipR, b.hipL)).toBeCloseTo(2 * d(a.hipR, a.hipL), 6);
  });
  test('cổ tay bám mục tiêu khi mục tiêu nằm trong tầm với', () => {
    const base = solvePose(rig(), params());
    const t = { x: base.joints.shoulderR.x - 50, y: base.joints.shoulderR.y + 30 };
    const p = solvePose(rig(), params({ targets: { wristR: t } }));
    expect(d(p.joints.wristR, t)).toBeLessThan(25); // bị kẹp bởi giới hạn duỗi/gập nên có thể lệch nhẹ
  });
  test('mục tiêu quá xa: tay không bao giờ dài ra hơn xương', () => {
    const p = solvePose(rig(), params({ targets: { wristL: { x: 5000, y: 400 } } }));
    const R = rig().joints;
    const reach = d(restShoulderPivot(rig(), 'L'), R.elbowL) + d(R.elbowL, R.wristL);
    expect(d(pivot('L'), p.joints.wristL)).toBeLessThanOrEqual(reach);
  });
  test('độ dài xương trên và dưới luôn được bảo toàn khi IK', () => {
    const t = { x: 560, y: 380 };
    const a = solvePose(rig(), params({ targets: { wristL: t } })).joints;
    const R = rig().joints;
    expect(d(pivot('L'), a.elbowL)).toBeCloseTo(d(restShoulderPivot(rig(), 'L'), R.elbowL), 4);
    expect(d(a.elbowL, a.wristL)).toBeCloseTo(d(R.elbowL, R.wristL), 4);
  });
  test('chân bám mục tiêu mắt cá trong tầm', () => {
    const base = solvePose(rig(), params());
    const t = { x: base.joints.hipR.x - 10, y: base.joints.hipR.y + 100 };
    const p = solvePose(rig(), params({ targets: { ankleR: t } }));
    expect(d(p.joints.ankleR, t)).toBeLessThan(30);
  });
  test('lean xoay thân: vai trái dịch khỏi vị trí cũ', () => {
    const a = solvePose(rig(), params({ lean: 0 })).joints;
    const b = solvePose(rig(), params({ lean: 0.3 })).joints;
    expect(d(a.shoulderL, b.shoulderL)).toBeGreaterThan(1);
    expect(b.lean).toBeUndefined();
  });
  test('lean được trả về trong kết quả', () => expect(solvePose(rig(), params({ lean: 0.2 })).lean).toBe(0.2));
  test('headBob nâng đầu lên (y nhỏ đi)', () => {
    const a = solvePose(rig(), params()).joints.head;
    const b = solvePose(rig(), params({ headBob: 10 })).joints.head;
    expect(b.y).toBeCloseTo(a.y - 10, 6);
  });
  test('mọi toạ độ đầu ra đều hữu hạn (không NaN) với mục tiêu trùng vai', () => {
    const base = solvePose(rig(), params()).joints;
    const p = solvePose(rig(), params({ targets: { wristR: base.shoulderR, ankleL: base.hipL } }));
    Object.values(p.joints).forEach((j) => { expect(Number.isFinite(j.x)).toBe(true); expect(Number.isFinite(j.y)).toBe(true); });
  });
  test('đầu gối không gập ra ngoài quá giới hạn dạng háng (đùi không xoè quá 0.5 rad)', () => {
    const base = solvePose(rig(), params()).joints;
    const far = { x: base.hipR.x - 300, y: base.hipR.y + 20 };
    const j = solvePose(rig(), params({ targets: { ankleR: far } })).joints;
    const thigh = { x: j.hipR.x - j.kneeR.x, y: j.kneeR.y - j.hipR.y };
    expect(Math.atan2(thigh.x, thigh.y)).toBeLessThanOrEqual(0.5 + 1e-6);
  });
  test('trả về reach của 4 chi', () => {
    const { reach } = solvePose(rig(), params());
    ['armR', 'armL', 'legR', 'legL'].forEach((k) => expect(reach[k]).toBeGreaterThan(0));
  });
  test('limits tuỳ chỉnh được nhận (armMaxReach nhỏ hơn -> tay ngắn hơn)', () => {
    const t = { x: 5000, y: 400 };
    const a = solvePose(rig(), params({ targets: { wristL: t } })).joints;
    const b = solvePose(rig(), params({ targets: { wristL: t }, limits: { armMaxReach: 0.5 } })).joints;
    expect(d(pivot('L'), b.wristL)).toBeLessThan(d(pivot('L'), a.wristL));
  });
});

describe('equipmentFrame', () => {
  const pose = { joints: { elbowR: { x: 0, y: 100 }, wristR: { x: 0, y: 0 } } }; // cẳng tay hướng lên trên
  const spec = { grip: [60, 250], head: [60, 100], tip: [60, 20] };

  test('cầm vũ khí tại cổ tay', () => expect(equipmentFrame(pose, 'R', spec, 1).grip).toEqual({ x: 0, y: 0 }));
  test('cẳng tay hướng lên -> sprite hướng lên (up = (0,-1))', () => {
    const f = equipmentFrame(pose, 'R', spec, 1);
    expect(f.up.x).toBeCloseTo(0, 6);
    expect(f.up.y).toBeCloseTo(-1, 6);
  });
  test('đầu vợt nằm cách tay cầm (grip.y - head.y) × k theo hướng "lên"', () => {
    const f = equipmentFrame(pose, 'R', spec, 0.5);
    expect(f.head.y).toBeCloseTo(-(250 - 100) * 0.5, 6);
    expect(f.head.x).toBeCloseTo(0, 6);
  });
  test('mũi vũ khí xa hơn đầu vợt theo (grip.y - tip.y)', () => {
    const f = equipmentFrame(pose, 'R', spec, 1);
    expect(f.tip.y).toBeCloseTo(-(250 - 20), 6);
  });
  test('headR = 58 × k × spec.headR', () => {
    expect(equipmentFrame(pose, 'R', { ...spec, headR: 2 }, 0.5).headR).toBeCloseTo(58, 6);
    expect(equipmentFrame(pose, 'R', spec, 1).headR).toBe(58);
  });
  test('spec không có head/tip thì không trả head/tip', () => {
    const f = equipmentFrame(pose, 'R', { grip: [0, 0] }, 1);
    expect(f.head).toBeUndefined();
    expect(f.tip).toBeUndefined();
  });
  test('upright=true giữ thẳng đứng, bỏ qua hướng cẳng tay', () => {
    const tilted = { joints: { elbowR: { x: 0, y: 0 }, wristR: { x: 100, y: 0 } } };
    const f = equipmentFrame(tilted, 'R', spec, 1, 0, true);
    expect(f.angle).toBe(0);
    expect(f.up.y).toBeCloseTo(-1, 6);
  });
  test('extraAngle xoay thêm', () => {
    const f = equipmentFrame(pose, 'R', spec, 1, Math.PI / 2);
    expect(f.up.x).toBeCloseTo(1, 6);
  });
  test('cẳng tay hướng sang phải -> sprite xoay 90° (up chỉ sang phải)', () => {
    const right = { joints: { elbowR: { x: 0, y: 0 }, wristR: { x: 50, y: 0 } } };
    const f = equipmentFrame(right, 'R', spec, 1);
    expect(f.up.x).toBeCloseTo(1, 6);
    expect(f.up.y).toBeCloseTo(0, 6);
  });
});
