// Các endpoint AI trong server.js (fal.ai / Gemini / Brave đều được giả lập, không tốn tiền)
jest.mock('express-rate-limit', () => () => (req, res, next) => next());
jest.mock('@fal-ai/client', () => ({
  fal: {
    queue: { submit: jest.fn(), status: jest.fn(), result: jest.fn() },
    subscribe: jest.fn(), run: jest.fn(), storage: { upload: jest.fn() }, config: jest.fn(),
  },
}));
jest.mock('../../utils/storage', () => {
  const actual = jest.requireActual('../../utils/storage');
  let n = 0;
  return {
    ...actual,
    saveBuffer: jest.fn(async (dir, ext) => `${dir}/f${++n}${ext}`),
    saveThumb: jest.fn(async () => `thumbs/t${++n}.jpg`),
    removeFiles: jest.fn(async () => {}),
    fetchBuffer: jest.fn(async () => Buffer.from('glb-bytes')),
  };
});

const request = require('supertest');
const sharp = require('sharp');
const { fal } = require('@fal-ai/client');
const app = require('../../server');
const User = require('../../models/User');
const Creation = require('../../models/Creation');
const Transaction = require('../../models/Transaction');
const { FREE_CREDITS } = require('../../config/pricing');
const { connectDb, clearDb, disconnectDb, makeUser, waitFor } = require('../helpers/db');

beforeAll(connectDb);
afterAll(disconnectDb);
beforeEach(async () => {
  await clearDb();
  [fal.queue.submit, fal.queue.status, fal.queue.result, fal.subscribe, fal.run, fal.storage.upload].forEach((m) => m.mockReset());
  ['log', 'error', 'warn'].forEach((k) => jest.spyOn(console, k).mockImplementation(() => {}));
});
afterEach(() => ['log', 'error', 'warn'].forEach((k) => console[k].mockRestore && console[k].mockRestore()));

const res = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });
const png = (w = 100, h = 80) => sharp({ create: { width: w, height: h, channels: 3, background: '#fff' } }).png().toBuffer();
const credits = async (u) => (await User.findById(u._id)).credits;
const dataUrl = 'data:image/jpeg;base64,/9j/AAAA';

describe('Mọi endpoint /api/* đều yêu cầu đăng nhập', () => {
  test.each([
    ['post', '/api/create-task'], ['get', '/api/task-status/abc'], ['post', '/api/export-2d/reconstruct'],
    ['post', '/api/chat'], ['post', '/api/magic-wand'], ['post', '/api/magic-wand/create'],
    ['post', '/api/meme/analyze'], ['post', '/api/meme/rerank'], ['post', '/api/meme/static-search'],
    ['post', '/api/stt'], ['post', '/api/tts'], ['get', '/api/account/models'], ['get', '/api/payments/wallet'],
  ])('%s %s -> 401 khi không có token', async (method, url) => {
    expect((await request(app)[method](url)).status).toBe(401);
  });
  test('route không tồn tại cũng cần token trước (401, không lộ 404)', async () => {
    expect((await request(app).get('/api/khong-co-route')).status).toBe(401);
  });
  test('GET /files/<đường dẫn không an toàn> không crash', async () => {
    expect([301, 302, 404]).toContain((await request(app).get('/files/../../etc/passwd')).status);
  });
});

describe('POST /api/chat', () => {
  const chat = (auth, body) => request(app).post('/api/chat').set(auth).send(body);
  const reply = (text) => global.fetch.mockResolvedValueOnce(res({ choices: [{ message: { content: text } }] }));

  test('thiếu message -> 400', async () => {
    const { auth } = await makeUser();
    expect((await chat(auth, {})).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('thành công -> { reply }', async () => {
    const { auth } = await makeUser();
    reply('Hello!');
    expect((await chat(auth, { message: 'hi' })).body).toEqual({ reply: 'Hello!' });
  });
  test('gọi fal với khoá, model, max_tokens, temperature đúng', async () => {
    const { auth } = await makeUser();
    reply('ok');
    await chat(auth, { message: 'hi', characterId: 2, language: 'vi' });
    const [url, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(url).toBe('https://fal.run/openrouter/router/openai/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Key test-fal-key');
    expect(body).toMatchObject({ model: 'openai/gpt-4o-mini', max_tokens: 700, temperature: 0.4 });
    expect(body.messages[0].content).toContain('PERSONALITY - MILO');
    expect(body.messages.slice(-1)[0]).toEqual({ role: 'user', content: 'hi' });
  });
  test('tin nhắn dài bị cắt 1000 ký tự trước khi gửi đi', async () => {
    const { auth } = await makeUser();
    reply('ok');
    await chat(auth, { message: 'x'.repeat(5000) });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).messages.slice(-1)[0].content).toHaveLength(1000);
  });
  test('fal trả lỗi -> 500 với thông báo thân thiện', async () => {
    const { auth } = await makeUser();
    global.fetch.mockResolvedValueOnce(res({}, false, 500));
    const r = await chat(auth, { message: 'hi' });
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/lost my connection/);
  });
  test('lỗi mạng -> 500', async () => {
    const { auth } = await makeUser();
    expect((await chat(auth, { message: 'hi' })).status).toBe(500);
  });
  test('chat không tốn credits', async () => {
    const { user, auth } = await makeUser();
    reply('ok');
    await chat(auth, { message: 'hi' });
    expect(await credits(user)).toBeUndefined();
  });
});

describe('POST /api/tts', () => {
  const tts = (auth, body) => request(app).post('/api/tts').set(auth).send(body);
  const ok = (url = 'https://cdn/a.mp3') => fal.run.mockResolvedValueOnce({ data: { audio: { url } } });

  test.each([[''], ['   '], ['*yawn*'], ['😀🎉'], ['https://example.com/x']])('text %p chỉ toàn thứ không đọc được -> audioUrl null, không gọi fal', async (text) => {
    const { auth } = await makeUser();
    expect((await tts(auth, { text })).body).toEqual({ audioUrl: null });
    expect(fal.run).not.toHaveBeenCalled();
  });
  test('thiếu text -> audioUrl null', async () => {
    const { auth } = await makeUser();
    expect((await tts(auth, {})).body).toEqual({ audioUrl: null });
  });
  test('thành công trả audioUrl', async () => {
    const { auth } = await makeUser(); ok();
    expect((await tts(auth, { text: 'Hello there' })).body).toEqual({ audioUrl: 'https://cdn/a.mp3' });
  });
  test('làm sạch text: bỏ *hành động*, link, markdown, emoji', async () => {
    const { auth } = await makeUser(); ok();
    await tts(auth, { text: '*yawn* Hello **world** 😀 see https://x.com/a `code` # title' });
    expect(fal.run.mock.calls[0][1].input.text).toBe('Hello world see code title');
  });
  test('text bị cắt tối đa 600 ký tự', async () => {
    const { auth } = await makeUser(); ok();
    await tts(auth, { text: 'a'.repeat(2000) });
    expect(fal.run.mock.calls[0][1].input.text).toHaveLength(600);
  });
  test.each([[1, 'Aria'], [2, 'Roger'], [3, 'Sarah'], [4, 'Charlie'], [5, 'Laura'], [99, 'Aria'], [undefined, 'Aria']])('characterId %p -> giọng %s', async (id, voice) => {
    const { auth } = await makeUser(); ok();
    await tts(auth, { text: 'hi', characterId: id });
    expect(fal.run.mock.calls[0][1].input.voice).toBe(voice);
  });
  test('dùng model ElevenLabs turbo v2.5', async () => {
    const { auth } = await makeUser(); ok();
    await tts(auth, { text: 'hi' });
    expect(fal.run.mock.calls[0][0]).toBe('fal-ai/elevenlabs/tts/turbo-v2.5');
  });
  test('đọc được url ở dạng result.audio.url', async () => {
    const { auth } = await makeUser();
    fal.run.mockResolvedValueOnce({ audio: { url: 'https://cdn/b.mp3' } });
    expect((await tts(auth, { text: 'hi' })).body.audioUrl).toBe('https://cdn/b.mp3');
  });
  test('fal không trả audio -> 500', async () => {
    const { auth } = await makeUser();
    fal.run.mockResolvedValueOnce({});
    expect((await tts(auth, { text: 'hi' })).status).toBe(500);
  });
  test('lỗi 4xx từ fal -> không thử lại bằng hàng đợi', async () => {
    const { auth } = await makeUser();
    fal.run.mockRejectedValueOnce(Object.assign(new Error('bad'), { status: 422 }));
    expect((await tts(auth, { text: 'hi' })).status).toBe(500);
    expect(fal.subscribe).not.toHaveBeenCalled();
  });
  test('lỗi 5xx từ fal -> thử lại bằng fal.subscribe và thành công', async () => {
    const { auth } = await makeUser();
    fal.run.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 }));
    fal.subscribe.mockResolvedValueOnce({ data: { audio: { url: 'https://cdn/retry.mp3' } } });
    expect((await tts(auth, { text: 'hi' })).body.audioUrl).toBe('https://cdn/retry.mp3');
  });
});

describe('POST /api/stt', () => {
  const audio = (n = 5000) => Buffer.alloc(n, 1);
  const stt = (auth, buf, fields = {}, type = 'audio/webm') => {
    let r = request(app).post('/api/stt').set(auth);
    Object.entries(fields).forEach(([k, v]) => { r = r.field(k, v); });
    return buf ? r.attach('audio', buf, { filename: 'v.webm', contentType: type }) : r;
  };
  beforeEach(() => { fal.storage.upload.mockResolvedValue('https://fal/audio.webm'); });

  test('không có file -> 400', async () => expect((await stt((await makeUser()).auth, null)).status).toBe(400));
  test('file quá ngắn (< 2000 byte) -> 400', async () => expect((await stt((await makeUser()).auth, audio(1000))).status).toBe(400));
  test('voicedMs < 350 -> text rỗng, không gọi fal', async () => {
    const r = await stt((await makeUser()).auth, audio(), { voicedMs: '200' });
    expect(r.body).toEqual({ text: '' });
    expect(fal.storage.upload).not.toHaveBeenCalled();
  });
  test('thành công -> trả text đã trim', async () => {
    fal.run.mockResolvedValueOnce({ data: { text: '  xin chào  ' } });
    expect((await stt((await makeUser()).auth, audio(), { voicedMs: '2000' })).body).toEqual({ text: 'xin chào' });
  });
  test('gửi đúng model và audio_url', async () => {
    fal.run.mockResolvedValueOnce({ data: { text: 'hi' } });
    await stt((await makeUser()).auth, audio());
    expect(fal.run.mock.calls[0][0]).toBe('fal-ai/wizper');
    expect(fal.run.mock.calls[0][1].input).toMatchObject({ audio_url: 'https://fal/audio.webm', task: 'transcribe', language: null });
  });
  test.each([['en', 'en'], ['vi', 'vi'], ['fr', null], ['', null]])('language %p -> %p', async (lang, expected) => {
    fal.run.mockResolvedValueOnce({ data: { text: 'hi' } });
    await stt((await makeUser()).auth, audio(), { language: lang });
    expect(fal.run.mock.calls[0][1].input.language).toBe(expected);
  });
  test.each([['audio/mp4', 'voice.m4a'], ['audio/ogg', 'voice.ogg'], ['audio/webm;codecs=opus', 'voice.webm']])('mime %s -> tên file %s', async (type, name) => {
    fal.run.mockResolvedValueOnce({ data: { text: 'hi' } });
    await stt((await makeUser()).auth, audio(), {}, type);
    expect(fal.storage.upload.mock.calls[0][0].name).toBe(name);
  });
  test.each([['Thanks for watching!'], ['Subtitles by the Amara.org community'], ['Hãy subscribe cho kênh']])('lọc ảo giác Whisper %p -> text rỗng', async (t) => {
    fal.run.mockResolvedValueOnce({ data: { text: t } });
    expect((await stt((await makeUser()).auth, audio(), { voicedMs: '5000' })).body.text).toBe('');
  });
  test('"Thank you" khi chỉ có 500ms tiếng nói -> coi là ảo giác', async () => {
    fal.run.mockResolvedValueOnce({ data: { text: 'Thank you.' } });
    expect((await stt((await makeUser()).auth, audio(), { voicedMs: '500' })).body.text).toBe('');
  });
  test('"Thank you" khi nói đủ dài (1500ms) -> giữ nguyên', async () => {
    fal.run.mockResolvedValueOnce({ data: { text: 'Thank you.' } });
    expect((await stt((await makeUser()).auth, audio(), { voicedMs: '1500' })).body.text).toBe('Thank you.');
  });
  test('đọc text ở dạng result.text', async () => {
    fal.run.mockResolvedValueOnce({ text: 'plain' });
    expect((await stt((await makeUser()).auth, audio())).body.text).toBe('plain');
  });
  test('fal lỗi -> 500', async () => {
    fal.run.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 400 }));
    expect((await stt((await makeUser()).auth, audio())).status).toBe(500);
  });
});

describe('POST /api/create-task', () => {
  const create = (auth, fields = { mode: 'single' }, files = { source: ['cat_photo-1.png'] }) => {
    let r = request(app).post('/api/create-task').set(auth);
    Object.entries(fields).forEach(([k, v]) => { r = r.field(k, v); });
    Object.entries(files).forEach(([k, [name]]) => { r = r.attach(k, Buffer.from('img'), { filename: name, contentType: 'image/png' }); });
    return r;
  };
  beforeEach(() => { fal.queue.submit.mockResolvedValue({ request_id: 'req-1' }); });

  test('thiếu ảnh nguồn -> 500 và KHÔNG bị trừ credits', async () => {
    const { user, auth } = await makeUser();
    const r = await create(auth, { mode: 'single' }, {});
    expect(r.status).toBe(500);
    expect(await credits(user)).toBeUndefined();
  });
  test('mode không hợp lệ -> 500 và không trừ credits', async () => {
    const { user, auth } = await makeUser();
    expect((await create(auth, { mode: 'hack' })).status).toBe(500);
    expect(await credits(user)).toBeUndefined();
    expect(fal.queue.submit).not.toHaveBeenCalled();
  });
  test('single: trừ 1 credit, trả task_id và số dư mới', async () => {
    const { user, auth } = await makeUser();
    const r = await create(auth);
    expect(r.body).toEqual({ code: 0, data: { task_id: 'req-1', credits: FREE_CREDITS - 1 } });
    expect(await credits(user)).toBe(FREE_CREDITS - 1);
  });
  test('single: gửi Trellis-2 với remove_background và ảnh dạng data URI', async () => {
    const { auth } = await makeUser();
    await create(auth);
    const [endpoint, { input }] = fal.queue.submit.mock.calls[0];
    expect(endpoint).toBe('fal-ai/trellis-2');
    expect(input.image_url).toMatch(/^data:image\/png;base64,/);
    expect(input.remove_background).toBe(true);
  });
  test('tạo bản ghi Creation pending với tên lấy từ tên file', async () => {
    const { user, auth } = await makeUser();
    await create(auth);
    const c = await waitFor(() => Creation.findOne({ user: user._id }));
    expect(c).toMatchObject({ type: 'model', kind: 'single', status: 'pending', taskId: 'req-1', name: 'cat photo 1' });
  });
  test('dòng usage được gắn taskId để hoàn tiền khi lỗi', async () => {
    const { user, auth } = await makeUser();
    await create(auth);
    expect((await Transaction.findOne({ user: user._id, type: 'usage' })).meta.taskId).toBe('req-1');
  });
  test('hết credits -> 402 INSUFFICIENT_CREDITS, không gọi fal', async () => {
    const { auth } = await makeUser({ credits: 0 });
    const r = await create(auth);
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({ code: 'INSUFFICIENT_CREDITS', credits: 0 });
    expect(fal.queue.submit).not.toHaveBeenCalled();
  });
  test('fal.submit lỗi -> 500 và HOÀN credit', async () => {
    const { user, auth } = await makeUser();
    fal.queue.submit.mockRejectedValueOnce(new Error('fal down'));
    expect((await create(auth)).status).toBe(500);
    expect(await credits(user)).toBe(FREE_CREDITS);
    expect(await Transaction.countDocuments({ type: 'refund' })).toBe(1);
  });
  test('single + pose: gọi Nano Banana để đổi dáng rồi mới tạo 3D', async () => {
    const { auth } = await makeUser();
    global.fetch
      .mockResolvedValueOnce(res({ images: [{ url: 'https://fal.media/pose.jpg' }] }))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    expect((await create(auth, { mode: 'single' }, { source: ['a.png'], pose: ['p.png'] })).status).toBe(200);
    expect(global.fetch.mock.calls[0][0]).toBe('https://fal.run/fal-ai/nano-banana-2/edit');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).image_urls).toHaveLength(2);
  });
  test('single + pose: Nano Banana từ chối -> 500 và hoàn credit', async () => {
    const { user, auth } = await makeUser();
    global.fetch.mockResolvedValueOnce(res({}, false, 400));
    expect((await create(auth, { mode: 'single' }, { source: ['a.png'], pose: ['p.png'] })).status).toBe(500);
    expect(await credits(user)).toBe(FREE_CREDITS);
  });
  test('multiple: bọc nền trắng bằng Nano Banana, KHÔNG bật remove_background', async () => {
    const { auth } = await makeUser();
    global.fetch
      .mockResolvedValueOnce(res({ images: [{ url: 'https://fal.media/w.jpg' }] }))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([9]).buffer });
    const r = await create(auth, { mode: 'multiple' });
    expect(r.status).toBe(200);
    expect(fal.queue.submit.mock.calls[0][1].input.remove_background).toBeUndefined();
  });
  test('multiple lưu kind=scene', async () => {
    const { user, auth } = await makeUser();
    global.fetch
      .mockResolvedValueOnce(res({ images: [{ url: 'https://fal.media/w.jpg' }] }))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([9]).buffer });
    await create(auth, { mode: 'multiple' });
    expect((await waitFor(() => Creation.findOne({ user: user._id }))).kind).toBe('scene');
  });
  test('3 request đồng thời khi chỉ còn 2 credits: đúng 2 thành công', async () => {
    const { user, auth } = await makeUser({ credits: 2 });
    const rs = await Promise.all([create(auth), create(auth), create(auth)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 402]);
    expect(await credits(user)).toBe(0);
  });
});

describe('GET /api/task-status/:taskId', () => {
  const status = (auth, id = 'T1') => request(app).get(`/api/task-status/${id}`).set(auth);
  const seedTask = async (user, taskId = 'T1') => {
    const { debit, attachTask } = require('../../utils/credits');
    const { key } = await debit(user._id, 1);
    await attachTask(key, taskId);
    await Creation.create({ user: user._id, type: 'model', kind: 'single', name: 'x', status: 'pending', taskId });
  };

  test.each([['IN_QUEUE', 'queued', 0], ['IN_PROGRESS', 'running', 50]])('%s -> %s (%i%%)', async (st, mapped, pct) => {
    const { auth } = await makeUser();
    fal.queue.status.mockResolvedValueOnce({ status: st });
    expect((await status(auth)).body).toEqual({ code: 0, data: { status: mapped, progress: pct } });
  });
  test('COMPLETED -> success 100 + link model', async () => {
    const { user, auth } = await makeUser(); await seedTask(user);
    fal.queue.status.mockResolvedValueOnce({ status: 'COMPLETED' });
    fal.queue.result.mockResolvedValueOnce({ data: { model_glb: { url: 'https://fal.media/m.glb' } } });
    expect((await status(auth)).body.data).toMatchObject({ status: 'success', progress: 100, output: { model: 'https://fal.media/m.glb' } });
  });
  test.each([['model_mesh'], ['model_file']])('link model ở trường %s', async (field) => {
    const { auth } = await makeUser();
    fal.queue.status.mockResolvedValueOnce({ status: 'COMPLETED' });
    fal.queue.result.mockResolvedValueOnce({ data: { [field]: { url: 'https://fal.media/x.glb' } } });
    expect((await status(auth)).body.data.output.model).toBe('https://fal.media/x.glb');
  });
  test('không có trường chuẩn: tìm .glb trong JSON bằng regex', async () => {
    const { auth } = await makeUser();
    fal.queue.status.mockResolvedValueOnce({ status: 'COMPLETED' });
    fal.queue.result.mockResolvedValueOnce({ weird: { nested: 'https://fal.media/deep/z.glb' } });
    expect((await status(auth)).body.data.output.model).toBe('https://fal.media/deep/z.glb');
  });
  test('COMPLETED nhưng không có file -> hoàn credit', async () => {
    const { user, auth } = await makeUser(); await seedTask(user);
    fal.queue.status.mockResolvedValueOnce({ status: 'COMPLETED' });
    fal.queue.result.mockResolvedValueOnce({ data: {} });
    await status(auth);
    await waitFor(async () => (await credits(user)) === FREE_CREDITS);
  });
  test('COMPLETED -> bản ghi chuyển ready và lưu remoteUrl (chạy nền)', async () => {
    const { user, auth } = await makeUser(); await seedTask(user);
    fal.queue.status.mockResolvedValueOnce({ status: 'COMPLETED' });
    fal.queue.result.mockResolvedValueOnce({ data: { model_glb: { url: 'https://fal.media/m.glb' } } });
    await status(auth);
    const c = await waitFor(async () => { const d = await Creation.findOne({ taskId: 'T1' }); return d.status === 'ready' && d.file ? d : null; });
    expect(c.remoteUrl).toBe('https://fal.media/m.glb');
    expect(c.file).toMatch(/^models\//);
  });
  test('link không phải của fal thì không tải về server (chống SSRF)', async () => {
    const storage = require('../../utils/storage');
    const { user, auth } = await makeUser(); await seedTask(user);
    fal.queue.status.mockResolvedValueOnce({ status: 'COMPLETED' });
    fal.queue.result.mockResolvedValueOnce({ data: { model_glb: { url: 'https://evil.com/m.glb' } } });
    await status(auth);
    await waitFor(async () => (await Creation.findOne({ taskId: 'T1' })).status === 'ready');
    expect(storage.fetchBuffer).not.toHaveBeenCalledWith('https://evil.com/m.glb', expect.anything());
  });
  test('FAILED -> failed và hoàn credit đúng 1 lần dù hỏi nhiều lần', async () => {
    const { user, auth } = await makeUser(); await seedTask(user);
    fal.queue.status.mockResolvedValue({ status: 'FAILED' });
    expect((await status(auth)).body.data.status).toBe('failed');
    await status(auth); await status(auth);
    await waitFor(async () => (await credits(user)) === FREE_CREDITS);
    await new Promise((r) => setTimeout(r, 150));
    expect(await credits(user)).toBe(FREE_CREDITS);
    expect(await Transaction.countDocuments({ type: 'refund' })).toBe(1);
  });
  test('user khác hỏi task FAILED của người ta -> không được hoàn credit cho mình / cho họ', async () => {
    const owner = await makeUser(); await seedTask(owner.user);
    const other = await makeUser();
    fal.queue.status.mockResolvedValue({ status: 'FAILED' });
    await status(other.auth);
    await new Promise((r) => setTimeout(r, 150));
    expect(await credits(owner.user)).toBe(FREE_CREDITS - 1);
    expect(await credits(other.user)).toBeUndefined();
  });
  test('fal lỗi -> 500', async () => {
    const { auth } = await makeUser();
    fal.queue.status.mockRejectedValueOnce(new Error('x'));
    expect((await status(auth)).status).toBe(500);
  });
});

describe('POST /api/magic-wand', () => {
  const wand = async (auth, fields = {}, file = 'default') => {
    let r = request(app).post('/api/magic-wand').set(auth);
    Object.entries({ point_x: 10, point_y: 10, ...fields }).forEach(([k, v]) => { r = r.field(k, v); });
    if (file) r = r.attach('source', file === 'default' ? await png() : file, 'a.png');
    return r;
  };
  const samOk = () => fal.subscribe.mockResolvedValueOnce({ image: { url: 'https://fal.media/cut.png' } });

  test('thiếu ảnh -> 500', async () => expect((await wand((await makeUser()).auth, {}, null)).status).toBe(500));
    test.each([['abc', 10], [10, 'abc'], [-1, 5], [5, -1]])('toạ độ (%p,%p) không hợp lệ -> 500', async (x, y) => {
    expect((await wand((await makeUser()).auth, { point_x: x, point_y: y })).status).toBe(500);
    expect(fal.subscribe).not.toHaveBeenCalled();
  });
  test('toạ độ nằm ngoài ảnh -> 500 kèm kích thước ảnh', async () => {
    const r = await wand((await makeUser()).auth, { point_x: 100, point_y: 10 });
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('100x80');
  });
  test('toạ độ ở góc cuối hợp lệ (99,79)', async () => {
    samOk();
    expect((await wand((await makeUser()).auth, { point_x: 99, point_y: 79 })).status).toBe(200);
  });
  test('prompt dài hơn 240 ký tự -> 500', async () => {
    expect((await wand((await makeUser()).auth, { selection_prompt: 'a'.repeat(241) })).status).toBe(500);
  });
  test('thành công -> image_url', async () => {
    samOk();
    expect((await wand((await makeUser()).auth)).body).toEqual({ code: 0, data: { image_url: 'https://fal.media/cut.png' } });
  });
  test('gửi SAM 3 điểm chọn đã làm tròn + prompt đã trim', async () => {
    samOk();
    await wand((await makeUser()).auth, { point_x: '10.6', point_y: 20.4, selection_prompt: '  red chair  ' });
    const [model, { input }] = fal.subscribe.mock.calls[0];
    expect(model).toBe('fal-ai/sam-3/image');
    expect(input.point_prompts).toEqual([{ x: 11, y: 20, label: 1 }]);
    expect(input.prompt).toBe('red chair');
  });
  test.each([[{ data: { image: { url: 'https://fal.media/a.png' } } }], [{ mask: { url: 'https://fal.media/a.png' } }], [{ foo: ['https://fal.media/a.png'] }]])('đọc link ảnh ở dạng phản hồi %j', async (resp) => {
    fal.subscribe.mockResolvedValueOnce(resp);
    expect((await wand((await makeUser()).auth)).body.data.image_url).toBe('https://fal.media/a.png');
  });
  test('SAM không trả ảnh -> 500', async () => {
    fal.subscribe.mockResolvedValueOnce({});
    expect((await wand((await makeUser()).auth)).status).toBe(500);
  });
  test('Magic Wand chọn vật là MIỄN PHÍ (không trừ credits)', async () => {
    const { user, auth } = await makeUser(); samOk();
    await wand(auth);
    expect(await credits(user)).toBeUndefined();
  });
});

describe('POST /api/magic-wand/create', () => {
  const create = (auth, body) => request(app).post('/api/magic-wand/create').set(auth).send(body);
  beforeEach(() => { fal.queue.submit.mockResolvedValue({ request_id: 'mw-1' }); });

  test.each([[{}], [{ image_url: '' }], [{ image_url: 'ftp://x/y.png' }], [{ image_url: 'javascript:alert(1)' }], [{ image_url: 'data:image/png;base64,AAA' }]])('image_url %j -> 500, không trừ credits', async (body) => {
    const { user, auth } = await makeUser();
    expect((await create(auth, body)).status).toBe(500);
    expect(await credits(user)).toBeUndefined();
  });
  test('thành công: trừ 1 credit và tạo bản ghi kind=magic', async () => {
    const { user, auth } = await makeUser();
    const r = await create(auth, { image_url: 'https://fal.media/cut.png' });
    expect(r.body).toEqual({ code: 0, data: { task_id: 'mw-1', credits: FREE_CREDITS - 1 } });
    expect(await waitFor(() => Creation.findOne({ user: user._id }))).toMatchObject({ kind: 'magic', name: 'Magic Wand object', status: 'pending' });
  });
  test('hết credits -> 402', async () => {
    const { auth } = await makeUser({ credits: 0 });
    expect((await create(auth, { image_url: 'https://fal.media/x.png' })).status).toBe(402);
  });
  test('submit lỗi -> hoàn credit', async () => {
    const { user, auth } = await makeUser();
    fal.queue.submit.mockRejectedValueOnce(new Error('x'));
    expect((await create(auth, { image_url: 'https://fal.media/x.png' })).status).toBe(500);
    expect(await credits(user)).toBe(FREE_CREDITS);
  });
});

describe('POST /api/export-2d/reconstruct', () => {
  const rec = (auth, files = ['source', 'render']) => {
    let r = request(app).post('/api/export-2d/reconstruct').set(auth);
    files.forEach((f) => { r = r.attach(f, Buffer.from('img'), { filename: `${f}.png`, contentType: 'image/png' }); });
    return r;
  };
  test.each([[['source']], [['render']], [[]]])('thiếu ảnh %j -> 500', async (files) => {
    expect((await rec((await makeUser()).auth, files)).status).toBe(500);
  });
  test('thành công: trả file ảnh dạng attachment', async () => {
    global.fetch
      .mockResolvedValueOnce(res({ images: [{ url: 'https://fal.media/r.jpg' }] }))
      .mockResolvedValueOnce({ ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const r = await rec((await makeUser()).auth);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('image/jpeg');
    expect(r.headers['content-disposition']).toContain('attachment');
  });
  test('fal từ chối -> 500', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, text: async () => 'bad' });
    expect((await rec((await makeUser()).auth)).status).toBe(500);
  });
  test('fal không trả ảnh -> 500', async () => {
    global.fetch.mockResolvedValueOnce(res({ images: [] }));
    expect((await rec((await makeUser()).auth)).status).toBe(500);
  });
});

describe('POST /api/meme/analyze', () => {
  const analyze = (auth, body) => request(app).post('/api/meme/analyze').set(auth).send({ image: dataUrl, ...body });
  const gemini = (obj) => global.fetch.mockResolvedValueOnce(res({ choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] }));

  test('thiếu ảnh -> 500 "Missing webcam image."', async () => {
    const r = await request(app).post('/api/meme/analyze').set((await makeUser()).auth).send({});
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('Missing webcam image.');
  });
  test('ảnh không phải data URL -> 500', async () => {
    expect((await analyze((await makeUser()).auth, { image: 'http://x/y.jpg' })).status).toBe(500);
  });
  test('thiếu GEMINI_API_KEY -> 500', async () => {
    const s = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
    try { expect((await analyze((await makeUser()).auth)).status).toBe(500); } finally { process.env.GEMINI_API_KEY = s; }
  });
  test('thành công: chuẩn hoá kết quả', async () => {
    gemini({ expression_nuance: 'smirk', identified_gesture: 'thumbs up', confidence: 0.9, meme_intent: ['a', 'b', 'c', 'd'], search_queries: ['one', 'two'] });
    const r = await analyze((await makeUser()).auth, { gestureScore: 0.7 });
    expect(r.body).toEqual({ code: 0, expression: 'smirk', confidence: 0.9, memeIntent: ['a', 'b', 'c'], searchQueries: ['one', 'two'], gesture: 'thumbs up', gestureScore: 0.7 });
  });
  test('JSON bọc trong ```json ... ``` vẫn parse được', async () => {
    gemini('```json\n{"confidence":0.5,"search_queries":["x"]}\n```');
    expect((await analyze((await makeUser()).auth)).body.searchQueries).toEqual(['x']);
  });
  test.each([[5, 1], [-3, 0], ['abc', 0], [0.4, 0.4]])('confidence %p được kẹp về [0,1] -> %p', async (c, expected) => {
    gemini({ confidence: c, search_queries: ['x'] });
    expect((await analyze((await makeUser()).auth)).body.confidence).toBe(expected);
  });
  test('search_queries: bỏ phần tử không phải chuỗi/rỗng/trùng, cắt 50 ký tự, tối đa 5', async () => {
    gemini({ search_queries: ['a', 'a', '  ', 5, null, 'b'.repeat(80), 'c', 'd', 'e', 'f'] });
    const q = (await analyze((await makeUser()).auth)).body.searchQueries;
    expect(q).toEqual(['a', 'b'.repeat(50), 'c', 'd', 'e']);
  });
  test('không có query hợp lệ -> dùng "funny reaction meme"', async () => {
    gemini({ search_queries: [] });
    expect((await analyze((await makeUser()).auth)).body.searchQueries).toEqual(['funny reaction meme']);
  });
  test('AI không nhận ra biểu cảm/cử chỉ -> dùng gợi ý MediaPipe', async () => {
    gemini({ search_queries: ['x'] });
    const r = await analyze((await makeUser()).auth, { gesture: 'Victory', basicExpression: 'happy' });
    expect(r.body).toMatchObject({ expression: 'happy', gesture: 'Victory' });
  });
  test('không có gì cả -> expression "neutral", gesture "none"', async () => {
    gemini({ search_queries: ['x'] });
    expect((await analyze((await makeUser()).auth)).body).toMatchObject({ expression: 'neutral', gesture: 'none', gestureScore: 0 });
  });
  test('Gemini trả JSON hỏng -> 500', async () => {
    gemini('xin chào, không phải json');
    expect((await analyze((await makeUser()).auth)).status).toBe(500);
  });
  test('fal lỗi -> 500', async () => {
    global.fetch.mockResolvedValueOnce(res({}, false, 500));
    expect((await analyze((await makeUser()).auth)).status).toBe(500);
  });
});

describe('POST /api/meme/rerank', () => {
  const rerank = (auth, body) => request(app).post('/api/meme/rerank').set(auth).send(body);
  const cands = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, url: `https://img/${i}.jpg` }));
  const ranked = (arr) => global.fetch.mockResolvedValueOnce(res({ choices: [{ message: { content: JSON.stringify(arr) } }] }));

  test.each([[{}], [{ userImage: dataUrl }], [{ userImage: dataUrl, candidates: [] }], [{ userImage: dataUrl, candidates: 'x' }], [{ candidates: cands(2) }]])('thiếu dữ liệu %j -> 500', async (b) => {
    expect((await rerank((await makeUser()).auth, b)).status).toBe(500);
  });
  test('ảnh người dùng sai định dạng -> 500', async () => {
    expect((await rerank((await makeUser()).auth, { userImage: 'nope', candidates: cands(2) })).status).toBe(500);
  });
  test('thành công -> rankedResults', async () => {
    ranked([{ id: 'm0', matchRate: 90 }]);
    expect((await rerank((await makeUser()).auth, { userImage: dataUrl, candidates: cands(2) })).body).toEqual({ code: 0, rankedResults: [{ id: 'm0', matchRate: 90 }] });
  });
  test('chỉ gửi tối đa 24 ứng viên cho AI', async () => {
    ranked([]);
    await rerank((await makeUser()).auth, { userImage: dataUrl, candidates: cands(40) });
    const content = JSON.parse(global.fetch.mock.calls[0][1].body).messages[0].content;
    expect(content.filter((c) => c.type === 'text' && c.text.startsWith('MEME CANDIDATE ID'))).toHaveLength(24);
  });
  test('JSON có hàng rào ```json được parse', async () => {
    global.fetch.mockResolvedValueOnce(res({ choices: [{ message: { content: '```json\n[{"id":"a","matchRate":60}]\n```' } }] }));
    expect((await rerank((await makeUser()).auth, { userImage: dataUrl, candidates: cands(1) })).body.rankedResults).toHaveLength(1);
  });
  test('AI trả rác -> 500', async () => {
    global.fetch.mockResolvedValueOnce(res({ choices: [{ message: { content: 'sorry' } }] }));
    expect((await rerank((await makeUser()).auth, { userImage: dataUrl, candidates: cands(1) })).status).toBe(500);
  });
  test('fal lỗi -> 500', async () => {
    global.fetch.mockResolvedValueOnce(res({}, false, 500));
    expect((await rerank((await makeUser()).auth, { userImage: dataUrl, candidates: cands(1) })).status).toBe(500);
  });
});

describe('POST /api/meme/static-search', () => {
  const search = (auth, body) => request(app).post('/api/meme/static-search').set(auth).send(body);
  const brave = (results) => global.fetch.mockResolvedValueOnce(res({ results }));
  const calledQuery = () => decodeURIComponent(new URL(global.fetch.mock.calls[0][0]).searchParams.get('q'));

  test('thiếu BRAVE_API_KEY -> 500', async () => {
    const s = process.env.BRAVE_API_KEY; delete process.env.BRAVE_API_KEY;
    try { expect((await search((await makeUser()).auth, { queries: ['x'] })).status).toBe(500); } finally { process.env.BRAVE_API_KEY = s; }
  });
  test('gọi Brave với token, count=9', async () => {
    brave([]);
    await search((await makeUser()).auth, { queries: ['happy dance'] });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('https://api.search.brave.com/res/v1/images/search?');
    expect(new URL(url).searchParams.get('count')).toBe('9');
    expect(opts.headers['X-Subscription-Token']).toBe('test-brave-key');
  });
  test('ưu tiên query KHÔNG chứa "gif"', async () => {
    brave([]);
    await search((await makeUser()).auth, { queries: ['dance gif', 'happy dance'] });
    expect(calledQuery()).toContain('happy dance');
    expect(calledQuery()).not.toContain('gif');
  });
  test('chỉ có query chứa gif -> vẫn dùng (đã bỏ chữ gif)', async () => {
    brave([]);
    await search((await makeUser()).auth, { queries: ['dance gif'] });
    expect(calledQuery()).toMatch(/^dance\s+twitter reaction pic OR pinterest meme$/);
  });
  test('làm sạch các từ thừa reaction/meme/image/pic', async () => {
    brave([]);
    await search((await makeUser()).auth, { queries: ['shocked reaction meme'] });
    expect(calledQuery()).toMatch(/^shocked\s+twitter reaction pic OR pinterest meme$/);
  });
  test.each([[{}], [{ queries: [] }], [{ queries: 'x' }]])('không có queries %j -> "funny reaction"', async (body) => {
    brave([]);
    await search((await makeUser()).auth, body);
    expect(calledQuery()).toContain('funny');
  });
  test('map kết quả: id brave_img_N, ưu tiên properties.url, lọc redbubble và mục không có url', async () => {
    brave([
      { title: 'A', properties: { url: 'https://a/1.jpg' }, thumbnail: { src: 'https://t/1.jpg' } },
      { title: 'B', thumbnail: { src: 'https://t/2.jpg' } },
      { title: 'C', properties: { url: 'https://redbubble.com/x.jpg' } },
      { title: 'D' },
    ]);
    const r = await search((await makeUser()).auth, { queries: ['x'] });
    expect(r.body.images).toEqual([
      { id: 'brave_img_0', url: 'https://a/1.jpg', title: 'A' },
      { id: 'brave_img_1', url: 'https://t/2.jpg', title: 'B' },
    ]);
  });
  test('không có kết quả -> mảng rỗng', async () => {
    global.fetch.mockResolvedValueOnce(res({}));
    expect((await search((await makeUser()).auth, { queries: ['x'] })).body).toEqual({ code: 0, images: [] });
  });
  test('Brave lỗi -> 500', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, text: async () => 'quota' });
    expect((await search((await makeUser()).auth, { queries: ['x'] })).status).toBe(500);
  });
});
