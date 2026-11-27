// createVoiceApi: gọi /api/stt và /api/tts
import { createVoiceApi } from '../src/components/voice.js';

const okJson = (data) => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => { globalThis.fetch = vi.fn(); });

const blob = (type = 'audio/webm') => new Blob([new Uint8Array(10)], { type });

describe('transcribe', () => {
  test('POST tới {baseUrl}/api/stt kèm header xác thực', async () => {
    fetch.mockResolvedValueOnce(okJson({ text: 'hi' }));
    const api = createVoiceApi({ baseUrl: 'https://api.test', getHeaders: () => ({ Authorization: 'Bearer T' }) });
    await api.transcribe(blob());
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://api.test/api/stt');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({ Authorization: 'Bearer T' });
  });
  test('KHÔNG tự đặt Content-Type (để trình duyệt thêm boundary)', async () => {
    fetch.mockResolvedValueOnce(okJson({ text: '' }));
    await createVoiceApi().transcribe(blob());
    expect(fetch.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  });
  test('trả về text', async () => {
    fetch.mockResolvedValueOnce(okJson({ text: 'xin chào' }));
    expect(await createVoiceApi().transcribe(blob())).toBe('xin chào');
  });
  test('thiếu text -> chuỗi rỗng', async () => {
    fetch.mockResolvedValueOnce(okJson({}));
    expect(await createVoiceApi().transcribe(blob())).toBe('');
  });
  test.each([['audio/mp4', 'voice.m4a'], ['audio/ogg;codecs=opus', 'voice.ogg'], ['audio/webm;codecs=opus', 'voice.webm'], ['', 'voice.webm']])('mime "%s" -> %s', async (type, name) => {
    fetch.mockResolvedValueOnce(okJson({ text: '' }));
    await createVoiceApi().transcribe(blob(type));
    expect(fetch.mock.calls[0][1].body.get('audio').name).toBe(name);
  });
  test('language mặc định lấy từ createVoiceApi', async () => {
    fetch.mockResolvedValueOnce(okJson({ text: '' }));
    await createVoiceApi({ language: 'vi' }).transcribe(blob());
    expect(fetch.mock.calls[0][1].body.get('language')).toBe('vi');
  });
  test('tham số lang ghi đè mặc định', async () => {
    fetch.mockResolvedValueOnce(okJson({ text: '' }));
    await createVoiceApi({ language: 'vi' }).transcribe(blob(), 'en');
    expect(fetch.mock.calls[0][1].body.get('language')).toBe('en');
  });
  test('lang=null: không gửi language (tự nhận diện)', async () => {
    fetch.mockResolvedValueOnce(okJson({ text: '' }));
    await createVoiceApi({ language: 'vi' }).transcribe(blob(), null);
    expect(fetch.mock.calls[0][1].body.has('language')).toBe(false);
  });
  test('gửi voicedMs / durationMs khi là số hữu hạn', async () => {
    fetch.mockResolvedValueOnce(okJson({ text: '' }));
    await createVoiceApi().transcribe(blob(), undefined, { voicedMs: 1200, durationMs: 3000 });
    const f = fetch.mock.calls[0][1].body;
    expect(f.get('voicedMs')).toBe('1200');
    expect(f.get('durationMs')).toBe('3000');
  });
  test.each([[NaN], [Infinity], [undefined], ['abc']])('voicedMs=%p không được gửi', async (v) => {
    fetch.mockResolvedValueOnce(okJson({ text: '' }));
    await createVoiceApi().transcribe(blob(), undefined, { voicedMs: v });
    expect(fetch.mock.calls[0][1].body.has('voicedMs')).toBe(false);
  });
  test('HTTP lỗi -> ném "STT failed (status)"', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(createVoiceApi().transcribe(blob())).rejects.toThrow('STT failed (401)');
  });
  test('lỗi mạng được ném ra', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(createVoiceApi().transcribe(blob())).rejects.toThrow('offline');
  });
});

describe('synthesize', () => {
  test('POST JSON {text, characterId, language}', async () => {
    fetch.mockResolvedValueOnce(okJson({ audioUrl: 'https://a/b.mp3' }));
    const api = createVoiceApi({ baseUrl: 'https://api.test', getHeaders: () => ({ Authorization: 'Bearer T' }) });
    expect(await api.synthesize('hello', 3, 'vi')).toBe('https://a/b.mp3');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://api.test/api/tts');
    expect(opts.headers).toEqual({ Authorization: 'Bearer T', 'Content-Type': 'application/json' });
    expect(JSON.parse(opts.body)).toEqual({ text: 'hello', characterId: 3, language: 'vi' });
  });
  test('ngôn ngữ mặc định là en', async () => {
    fetch.mockResolvedValueOnce(okJson({ audioUrl: 'x' }));
    await createVoiceApi().synthesize('hi', 1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).language).toBe('en');
  });
  test('không có audioUrl -> null', async () => {
    fetch.mockResolvedValueOnce(okJson({ audioUrl: null }));
    expect(await createVoiceApi().synthesize('hi', 1)).toBeNull();
  });
  test('HTTP lỗi -> ném "TTS failed (status)"', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(createVoiceApi().synthesize('hi', 1)).rejects.toThrow('TTS failed (500)');
  });
});
