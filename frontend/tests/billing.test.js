// Trạng thái ví phía client: configureBilling, fetchWallet, onWalletChange
import { configureBilling, fetchWallet, getWallet, onWalletChange } from '../src/components/billing.js';

const ok = (d) => ({ ok: true, status: 200, json: async () => d });
beforeEach(() => { globalThis.fetch = vi.fn(); vi.spyOn(console, 'warn').mockImplementation(() => {}); configureBilling({ apiBase: 'https://api.test', getToken: () => 'TOK' }); });
afterEach(() => { if (console.warn.mockRestore) console.warn.mockRestore(); });

describe('fetchWallet', () => {
  test('chưa đăng nhập (không có token) -> không gọi API', async () => {
    configureBilling({ apiBase: '', getToken: () => null });
    await fetchWallet();
    expect(fetch).not.toHaveBeenCalled();
  });
  test('gọi GET /api/payments/wallet kèm Bearer token', async () => {
    fetch.mockResolvedValueOnce(ok({ credits: 4 }));
    await fetchWallet();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://api.test/api/payments/wallet');
    expect(opts.headers.Authorization).toBe('Bearer TOK');
  });
  test('cập nhật trạng thái ví và đánh dấu loaded', async () => {
    fetch.mockResolvedValueOnce(ok({ credits: 9, packages: [{ id: 'pack5' }], testMode: false }));
    const s = await fetchWallet();
    expect(s.credits).toBe(9);
    expect(s.loaded).toBe(true);
    expect(getWallet().packages).toEqual([{ id: 'pack5' }]);
  });
  test('thông báo cho người đăng ký khi ví đổi', async () => {
    fetch.mockResolvedValueOnce(ok({ credits: 7 }));
    const cb = vi.fn();
    const off = onWalletChange(cb);
    await fetchWallet();
    expect(cb).toHaveBeenCalled();
    expect(cb.mock.calls[cb.mock.calls.length - 1][0].credits).toBe(7);
    off();
  });
  test('huỷ đăng ký rồi thì không nhận thông báo nữa', async () => {
    fetch.mockResolvedValue(ok({ credits: 1 }));
    await fetchWallet();
    const cb = vi.fn();
    onWalletChange(cb)(); // đăng ký rồi huỷ ngay (cb được gọi 1 lần vì đã loaded)
    cb.mockClear();
    await fetchWallet();
    expect(cb).not.toHaveBeenCalled();
  });
  test('đã có dữ liệu thì người đăng ký mới được gọi ngay 1 lần', async () => {
    fetch.mockResolvedValueOnce(ok({ credits: 3 }));
    await fetchWallet();
    const cb = vi.fn();
    const off = onWalletChange(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });
  test('một người nghe ném lỗi không làm hỏng người khác', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetch.mockResolvedValueOnce(ok({ credits: 2 }));
    let armed = false;
    const bad = onWalletChange(() => { if (armed) throw new Error('boom'); });
    armed = true;
    const good = vi.fn(); const off = onWalletChange(good);
    await expect(fetchWallet()).resolves.toBeDefined();
    expect(good).toHaveBeenCalled();
    bad(); off(); console.error.mockRestore();
  });
  test('server lỗi -> không ném, giữ trạng thái cũ', async () => {
    fetch.mockResolvedValueOnce(ok({ credits: 5 }));
    await fetchWallet();
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'x' }) });
    await expect(fetchWallet()).resolves.toBeDefined();
    expect(getWallet().credits).toBe(5);
  });
  test('lỗi mạng -> không ném', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchWallet()).resolves.toBeDefined();
  });
});
