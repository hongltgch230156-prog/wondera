// frontend/src/components/puppet/poseSolver.js
// Giải tư thế con rối từ rig + các mục tiêu (cổ tay, mắt cá) trên sân khấu.
// Thuần toán học, không đụng DOM -> test được và dùng chung cho con rối người chơi lẫn con rối AI.

const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (v, k) => ({ x: v.x * k, y: v.y * k });
const len = (v) => Math.hypot(v.x, v.y);

/** IK hai đoạn xương. prefer(candidate) -> điểm số, chọn nghiệm khuỷu/đầu gối có điểm cao hơn. */
export function ik2(S, T, l1, l2, prefer) {
  const dx = T.x - S.x, dy = T.y - S.y, d = Math.hypot(dx, dy) || 1e-6;
  const dd = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, d));
  const ux = dx / d, uy = dy / d;
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const mx = S.x + ux * a, my = S.y + uy * a;
  const c1 = { x: mx - uy * h, y: my + ux * h }, c2 = { x: mx + uy * h, y: my - ux * h };
  const mid = prefer(c1) >= prefer(c2) ? c1 : c2;
  return { mid, end: { x: S.x + ux * dd, y: S.y + uy * dd }, reach: l1 + l2 };
}

/** Ma trận affine đưa đoạn (restA->restB) lên (curA->curB), có hệ số co giãn s. */
export function boneXf(restA, restB, curA, curB, s) {
  const th = Math.atan2(curB.y - curA.y, curB.x - curA.x) - Math.atan2(restB.y - restA.y, restB.x - restA.x);
  const c = Math.cos(th) * s, sn = Math.sin(th) * s;
  return { a: c, b: sn, c: -sn, d: c, e: curA.x - (c * restA.x - sn * restA.y), f: curA.y - (sn * restA.x + c * restA.y) };
}
/** Ma trận xoay góc th quanh điểm pivot rest, đặt pivot tại cur (có scale s). */
export function pivotXf(restPivot, curPivot, th, s) {
  const c = Math.cos(th) * s, sn = Math.sin(th) * s;
  return { a: c, b: sn, c: -sn, d: c, e: curPivot.x - (c * restPivot.x - sn * restPivot.y), f: curPivot.y - (sn * restPivot.x + c * restPivot.y) };
}
export const applyXf = (m, p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

/**
 * params:
 *  scale   : px sân khấu / px texture
 *  root    : {x,y} vị trí khớp hông trên sân khấu
 *  lean    : góc nghiêng thân (rad)
 *  headTilt, headBob : nghiêng / nhún đầu
 *  targets : { wristR, wristL, ankleR, ankleL } toạ độ sân khấu (null = giữ tư thế T gập tự nhiên)
 *  rest    : { wristR:{x,y}...} tư thế nghỉ tương đối so với vai/hông (nếu không có target) – đơn vị texture
 */
export function solvePose(rig, params) {
  const R = rig.joints, s = params.scale, lean = params.lean || 0;
  const H0 = R.hip, root = params.root;
  const torso = pivotXf(H0, root, lean, s);
  const T = (p) => applyXf(torso, p);
  const J = {
    hip: root,
    neck: T(R.neck),
    shoulderR: T(R.shoulderR), shoulderL: T(R.shoulderL),
    hipR: T(R.hipR), hipL: T(R.hipL),
  };
  // đầu: xoay quanh cổ, nhún theo trục thân
  const headAng = lean + (params.headTilt || 0);
  const headOff = mul(rot(sub(R.head, R.neck), headAng), s);
  const bob = rot({ x: 0, y: -(params.headBob || 0) }, lean);
  J.neck = add(J.neck, bob);
  J.head = add(J.neck, headOff);
  const headXf = pivotXf(R.neck, J.neck, headAng, s);

  const limb = (S, mid0, end0, restS, target, prefer) => {
    const l1 = len(sub(mid0, restS)) * s, l2 = len(sub(end0, mid0)) * s;
    const tgt = target || add(S, mul(rot(sub(end0, restS), lean), s));
    return ik2(S, tgt, l1, l2, prefer);
  };
  const armPref = (c) => c.y;                       // khuỷu hướng xuống
  const legPrefR = (c) => -c.x, legPrefL = (c) => c.x; // đầu gối hướng ra ngoài
  const aR = limb(J.shoulderR, R.elbowR, R.wristR, R.shoulderR, params.targets?.wristR, armPref);
  const aL = limb(J.shoulderL, R.elbowL, R.wristL, R.shoulderL, params.targets?.wristL, armPref);
  const lR = limb(J.hipR, R.kneeR, R.ankleR, R.hipR, params.targets?.ankleR, legPrefR);
  const lL = limb(J.hipL, R.kneeL, R.ankleL, R.hipL, params.targets?.ankleL, legPrefL);
  J.elbowR = aR.mid; J.wristR = aR.end; J.elbowL = aL.mid; J.wristL = aL.end;
  J.kneeR = lR.mid; J.ankleR = lR.end; J.kneeL = lL.mid; J.ankleL = lL.end;

  const xf = {
    torso, head: headXf,
    upperArmR: boneXf(R.shoulderR, R.elbowR, J.shoulderR, J.elbowR, s),
    foreArmR: boneXf(R.elbowR, R.wristR, J.elbowR, J.wristR, s),
    upperArmL: boneXf(R.shoulderL, R.elbowL, J.shoulderL, J.elbowL, s),
    foreArmL: boneXf(R.elbowL, R.wristL, J.elbowL, J.wristL, s),
    thighR: boneXf(R.hipR, R.kneeR, J.hipR, J.kneeR, s),
    shinR: boneXf(R.kneeR, R.ankleR, J.kneeR, J.ankleR, s),
    thighL: boneXf(R.hipL, R.kneeL, J.hipL, J.kneeL, s),
    shinL: boneXf(R.kneeL, R.ankleL, J.kneeL, J.ankleL, s),
  };
  return { scale: s, lean, joints: J, xf, reach: { armR: aR.reach, armL: aL.reach, legR: lR.reach, legL: lL.reach } };
}

/**
 * Vị trí một món đồ cầm tay (vợt / vũ khí / khiên).
 * Quy ước sprite: tay cầm = spec.grip, phần đánh hướng LÊN. Nó xoay theo hướng cẳng tay (khuỷu -> cổ tay).
 */
export function equipmentFrame(pose, arm, spec, k, extraAngle = 0, upright = false) {
  const wrist = pose.joints["wrist" + arm], elbow = pose.joints["elbow" + arm];
  const dir = Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x);
  const angle = upright ? extraAngle : dir + Math.PI / 2 + extraAngle; // sprite "lên" (0,-1) -> hướng cẳng tay (khiên: giữ thẳng đứng)
  const up = { x: Math.sin(angle), y: -Math.cos(angle) };  // vector đơn vị theo "lên" của sprite
  const along = (px) => ({ x: wrist.x + up.x * px * k, y: wrist.y + up.y * px * k });
  const out = { grip: wrist, angle, up, k };
  if (spec.head) {
    const h = along(spec.grip[1] - spec.head[1]);
    out.head = h; out.headR = 58 * k * (spec.headR || 1);
  }
  if (spec.tip) out.tip = along(spec.grip[1] - spec.tip[1]);
  return out;
}