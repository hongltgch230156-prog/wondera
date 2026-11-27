// Tiến độ Snap & Solve theo từng tài khoản: chuẩn hoá, gộp, localStorage, đồng bộ server
import { normalize, mergeProgress, readProgress, writeProgress, configureProgress, syncProgress } from '../src/components/gameProgress.js';

// localStorage giả (tự cài nếu môi trường chưa có, vitest + jsdom đã có sẵn nên dùng luôn)
const store = () => globalThis.localStorage;
const BASE = 'handlab.snapSolve.progress.v1';

beforeEach(() => {
  store().clear();
  configureProgress({ userId: null });
});

describe('normalize', () => {
  test('đầu vào rỗng/rác -> tiến độ rỗng', () => {
    [undefined, null, 5, 'x', [], {}].forEach((v) => expect(normalize(v)).toEqual({ completed: [], best: {} }));
  });
  test('sắp xếp tăng dần và bỏ trùng', () => {
    expect(normalize({ completed: [3, 1, 2, 2, 1] }).completed).toEqual([1, 2, 3]);
  });
  test.each([[0], [-1], [51], [1.5], ['2'], [null], [NaN]])('level %p bị loại', (n) => {
    expect(normalize({ completed: [n, 4] }).completed).toEqual([4]);
  });
  test('level biên 1 và 50 được giữ', () => expect(normalize({ completed: [1, 50] }).completed).toEqual([1, 50]));
  test('best: chấp nhận key số dạng chuỗi và thời gian > 0', () => {
    expect(normalize({ best: { 1: 12.5, 2: '30' } }).best).toEqual({ 1: 12.5, 2: 30 });
  });
  test.each([[0], [-3], ['abc'], [Infinity]])('thời gian %p bị loại', (t) => {
    expect(normalize({ best: { 1: t } }).best).toEqual({});
  });
  test('best: key ngoài 1..50 hoặc không phải số nguyên bị loại', () => {
    expect(normalize({ best: { 0: 5, 51: 5, 'x': 5, 1.5: 5, 7: 5 } }).best).toEqual({ 7: 5 });
  });
  test('completed không phải mảng -> []', () => expect(normalize({ completed: 'abc' }).completed).toEqual([]));
  test('không sửa đối tượng đầu vào', () => {
    const raw = { completed: [2, 1], best: { 1: 5 } };
    normalize(raw);
    expect(raw).toEqual({ completed: [2, 1], best: { 1: 5 } });
  });
});

describe('mergeProgress', () => {
  test('hợp các level đã xong', () => {
    expect(mergeProgress({ completed: [1, 2] }, { completed: [2, 3] }).completed).toEqual([1, 2, 3]);
  });
  test('thời gian nhỏ hơn thắng', () => {
    expect(mergeProgress({ best: { 1: 20 } }, { best: { 1: 10 } }).best[1]).toBe(10);
    expect(mergeProgress({ best: { 1: 10 } }, { best: { 1: 20 } }).best[1]).toBe(10);
  });
  test('level chỉ có ở một bên vẫn được giữ', () => {
    expect(mergeProgress({ best: { 1: 5 } }, { best: { 2: 7 } }).best).toEqual({ 1: 5, 2: 7 });
  });
  test('gộp với rỗng không đổi gì', () => {
    expect(mergeProgress({ completed: [1], best: { 1: 5 } }, null)).toEqual({ completed: [1], best: { 1: 5 } });
  });
  test('giao hoán', () => {
    const a = { completed: [1, 4], best: { 1: 9, 4: 3 } }; const b = { completed: [2, 4], best: { 4: 2, 2: 8 } };
    expect(mergeProgress(a, b)).toEqual(mergeProgress(b, a));
  });
  test('luỹ đẳng: gộp với chính nó không đổi', () => {
    const a = { completed: [1, 2], best: { 1: 9 } };
    expect(mergeProgress(a, a)).toEqual(a);
  });
  test('dữ liệu rác ở một bên bị lọc trước khi gộp', () => {
    expect(mergeProgress({ completed: [1] }, { completed: [99, 'x'], best: { 1: -5 } })).toEqual({ completed: [1], best: {} });
  });
});

describe('readProgress / writeProgress (theo tài khoản)', () => {
  test('chưa đăng nhập -> rỗng và ghi không có tác dụng', () => {
    writeProgress({ completed: [1] });
    expect(readProgress()).toEqual({ completed: [], best: {} });
    expect(store().length).toBe(0);
  });
  test('ghi rồi đọc lại đúng', () => {
    configureProgress({ userId: 'u1' });
    writeProgress({ completed: [2, 1], best: { 1: 9.5 } });
    expect(readProgress()).toEqual({ completed: [1, 2], best: { 1: 9.5 } });
  });
  test('mỗi user một key riêng, không lẫn nhau', () => {
    configureProgress({ userId: 'a' }); writeProgress({ completed: [1] });
    configureProgress({ userId: 'b' });
    expect(readProgress().completed).toEqual([]);
    configureProgress({ userId: 'a' });
    expect(readProgress().completed).toEqual([1]);
  });
  test('key lưu là handlab.snapSolve.progress.v1:<userId>', () => {
    configureProgress({ userId: 'u9' }); writeProgress({ completed: [1] });
    expect(store().getItem(`${BASE}:u9`)).not.toBeNull();
  });
  test('JSON hỏng trong localStorage -> rỗng, không ném lỗi', () => {
    configureProgress({ userId: 'u1' });
    store().setItem(`${BASE}:u1`, '{not json');
    expect(readProgress()).toEqual({ completed: [], best: {} });
  });
  test('ghi dữ liệu rác được chuẩn hoá trước khi lưu', () => {
    configureProgress({ userId: 'u1' });
    writeProgress({ completed: [1, 99, 'x'], best: { 1: -1 } });
    expect(readProgress()).toEqual({ completed: [1], best: {} });
  });
});

describe('configureProgress: nhận tiến độ cũ (chưa có userId)', () => {
  test('tiến độ cũ được giao cho tài khoản đầu tiên rồi xoá key cũ', () => {
    store().setItem(BASE, JSON.stringify({ completed: [1, 2], best: { 1: 8 } }));
    configureProgress({ userId: 'first' });
    expect(readProgress()).toEqual({ completed: [1, 2], best: { 1: 8 } });
    expect(store().getItem(BASE)).toBeNull();
  });
  test('tài khoản thứ hai bắt đầu từ 0', () => {
    store().setItem(BASE, JSON.stringify({ completed: [1] }));
    configureProgress({ userId: 'first' });
    configureProgress({ userId: 'second' });
    expect(readProgress().completed).toEqual([]);
  });
  test('tài khoản đã có tiến độ thì không bị tiến độ cũ ghi đè', () => {
    store().setItem(`${BASE}:me`, JSON.stringify({ completed: [5] }));
    store().setItem(BASE, JSON.stringify({ completed: [1] }));
    configureProgress({ userId: 'me' });
    expect(readProgress().completed).toEqual([5]);
  });
  test('userId dạng số được đổi thành chuỗi', () => {
    configureProgress({ userId: 123 }); writeProgress({ completed: [1] });
    expect(store().getItem(`${BASE}:123`)).not.toBeNull();
  });
});

describe('syncProgress', () => {
  const ok = (snapSolve) => ({ ok: true, json: async () => ({ snapSolve }) });
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  test('chưa đăng nhập -> không gọi mạng', async () => {
    await syncProgress();
    expect(fetch).not.toHaveBeenCalled();
  });
  test('gửi PUT kèm token và tiến độ local, rồi lưu bản đã gộp', async () => {
    configureProgress({ userId: 'u1', apiBase: 'https://api.test', getToken: () => 'TOK' });
    writeProgress({ completed: [1], best: { 1: 20 } });
    fetch.mockResolvedValueOnce(ok({ completed: [1, 2], best: { 1: 15 } }));
    const merged = await syncProgress();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://api.test/api/account/game/snap-solve');
    expect(opts.method).toBe('PUT');
    expect(opts.headers.Authorization).toBe('Bearer TOK');
    expect(JSON.parse(opts.body)).toEqual({ completed: [1], best: { 1: 20 } });
    expect(merged).toEqual({ completed: [1, 2], best: { 1: 15 } });
    expect(readProgress()).toEqual(merged);
  });
  test('server trả lỗi -> giữ nguyên bản local', async () => {
    configureProgress({ userId: 'u1' }); writeProgress({ completed: [3] });
    fetch.mockResolvedValueOnce({ ok: false });
    expect(await syncProgress()).toEqual({ completed: [3], best: {} });
  });
  test('lỗi mạng -> giữ nguyên bản local, không ném lỗi', async () => {
    configureProgress({ userId: 'u1' }); writeProgress({ completed: [3] });
    fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await syncProgress()).toEqual({ completed: [3], best: {} });
  });
  test('không có token vẫn gửi header "Bearer " rỗng (server sẽ 401, client không crash)', async () => {
    configureProgress({ userId: 'u1' });
    fetch.mockResolvedValueOnce({ ok: false });
    await syncProgress();
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer ');
  });
  test('tiến độ chỉ tăng: bản server cũ hơn không làm mất level local', async () => {
    configureProgress({ userId: 'u1' }); writeProgress({ completed: [1, 2, 3] });
    fetch.mockResolvedValueOnce(ok({ completed: [1], best: {} }));
    expect((await syncProgress()).completed).toEqual([1, 2, 3]);
  });
});
