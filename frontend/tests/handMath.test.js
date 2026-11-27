// Bộ lọc One Euro làm mượt vị trí tay + tâm lòng bàn tay
import { OneEuro, palmCenter } from '../src/components/handMath.js';

describe('OneEuro.alpha', () => {
  test('nằm trong (0,1)', () => {
    const a = OneEuro.alpha(3, 1 / 30);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });
  test('cutoff càng lớn thì alpha càng lớn (lọc nhẹ hơn)', () => {
    expect(OneEuro.alpha(10, 0.033)).toBeGreaterThan(OneEuro.alpha(1, 0.033));
  });
  test('dt càng lớn thì alpha càng lớn', () => {
    expect(OneEuro.alpha(3, 0.1)).toBeGreaterThan(OneEuro.alpha(3, 0.01));
  });
  test('giá trị biết trước: cutoff=1/(2π), dt=1 -> alpha=0.5', () => {
    expect(OneEuro.alpha(1 / (2 * Math.PI), 1)).toBeCloseTo(0.5, 10);
  });
});

describe('OneEuro.filter', () => {
  test('mẫu đầu tiên được trả về nguyên vẹn', () => {
    expect(new OneEuro().filter(0.42, 0)).toBe(0.42);
  });
  test('tay đứng yên -> giá trị ra không đổi', () => {
    const f = new OneEuro();
    f.filter(100, 0);
    for (let i = 1; i < 30; i += 1) expect(f.filter(100, i / 30)).toBeCloseTo(100, 6);
  });
  test('lọc bớt nhiễu nhỏ khi đứng yên (độ lệch ra < độ lệch vào)', () => {
    const f = new OneEuro();
    f.filter(100, 0);
    const out = f.filter(101, 1 / 30);
    expect(Math.abs(out - 100)).toBeLessThan(1);
  });
  test('tay di chuyển đều: kết quả tiến theo cùng chiều', () => {
    const f = new OneEuro();
    let prev = f.filter(0, 0);
    for (let i = 1; i < 20; i += 1) {
      const v = f.filter(i * 10, i / 30);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
  test('tay đổi chiều đột ngột vẫn trả về số hữu hạn', () => {
    const f = new OneEuro();
    f.filter(0, 0); f.filter(100, 0.03);
    expect(Number.isFinite(f.filter(-100, 0.06))).toBe(true);
  });
  test('cùng timestamp (dt=0) không sinh NaN/Infinity', () => {
    const f = new OneEuro();
    f.filter(5, 1);
    const out = f.filter(6, 1);
    expect(Number.isFinite(out)).toBe(true);
  });
  test('timestamp đi lùi không sinh NaN', () => {
    const f = new OneEuro();
    f.filter(5, 2);
    expect(Number.isFinite(f.filter(6, 1))).toBe(true);
  });
  test('maxPredict=0 tắt dự đoán: không vọt quá giá trị đo khi đang tăng đều', () => {
    const f = new OneEuro(3, 0.05, 1, 0);
    let out = 0;
    for (let i = 0; i <= 30; i += 1) out = f.filter(i, i / 30);
    expect(out).toBeLessThanOrEqual(30);
  });
  test('dự đoán đẩy kết quả về phía trước so với khi tắt dự đoán', () => {
    const run = (mp) => { const f = new OneEuro(3, 0.05, 1, mp); let o = 0; for (let i = 0; i <= 30; i += 1) o = f.filter(i * 50, i / 30); return o; };
    expect(run(0.05)).toBeGreaterThan(run(0));
  });
  test('reset() xoá trạng thái: mẫu kế tiếp lại được trả nguyên vẹn', () => {
    const f = new OneEuro();
    f.filter(10, 0); f.filter(20, 0.03);
    f.reset();
    expect(f.filter(999, 5)).toBe(999);
    expect(f.dx).toBe(0);
  });
  test('tham số mặc định đúng', () => {
    const f = new OneEuro();
    expect([f.minCutoff, f.beta, f.dCutoff, f.maxPredict]).toEqual([3, 0.05, 1, 0.02]);
  });
  test('minCutoff nhỏ hơn -> mượt hơn (phản ứng chậm hơn) với cùng nhiễu', () => {
    const resp = (mc) => { const f = new OneEuro(mc, 0, 1, 0); f.filter(0, 0); return f.filter(10, 1 / 30); };
    expect(resp(0.5)).toBeLessThan(resp(5));
  });
});

describe('palmCenter', () => {
  const lm = (w, k) => { const a = Array.from({ length: 21 }, () => ({ x: 0, y: 0 })); a[0] = w; a[9] = k; return a; };
  test('là trung điểm cổ tay (0) và khớp ngón giữa (9)', () => {
    const c = palmCenter(lm({ x: 0.2, y: 0.8 }, { x: 0.6, y: 0.4 }));
    expect(c.x).toBeCloseTo(0.4, 10);
    expect(c.y).toBeCloseTo(0.6, 10);
  });
  test('hai điểm trùng nhau -> chính điểm đó', () => {
    expect(palmCenter(lm({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }))).toEqual({ x: 0.5, y: 0.5 });
  });
  test('bỏ qua các landmark khác', () => {
    const a = lm({ x: 0, y: 0 }, { x: 1, y: 1 });
    a[5] = { x: 99, y: 99 };
    expect(palmCenter(a)).toEqual({ x: 0.5, y: 0.5 });
  });
});
