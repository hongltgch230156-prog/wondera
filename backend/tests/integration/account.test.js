// /api/account/*: danh sách / đổi tên / xoá model 3D và ảnh export, tiến độ Snap & Solve
jest.mock('express-rate-limit', () => () => (req, res, next) => next());
jest.mock('../../utils/modelTasks', () => ({
  healPendingTasks: jest.fn().mockResolvedValue(undefined),
  trackModelTask: jest.fn(), finalizeModelTask: jest.fn(),
}));
jest.mock('../../utils/storage', () => {
  const actual = jest.requireActual('../../utils/storage');
  let n = 0;
  return {
    ...actual,
    saveBuffer: jest.fn(async (dir, ext) => `${dir}/file${++n}${ext}`),
    saveThumb: jest.fn(async () => `thumbs/thumb${++n}.jpg`),
    removeFiles: jest.fn(async () => {}),
  };
});

const request = require('supertest');
const sharp = require('sharp');
const app = require('../../server');
const Creation = require('../../models/Creation');
const User = require('../../models/User');
const storage = require('../../utils/storage');
const { healPendingTasks } = require('../../utils/modelTasks');
const { connectDb, clearDb, disconnectDb, makeUser } = require('../helpers/db');

beforeAll(connectDb);
afterAll(disconnectDb);
beforeEach(async () => { await clearDb(); storage.saveThumb.mockClear(); storage.saveBuffer.mockClear(); storage.removeFiles.mockClear(); healPendingTasks.mockClear(); });

const png = (w = 40, h = 30) => sharp({ create: { width: w, height: h, channels: 3, background: '#f00' } }).png().toBuffer();
const tiff = () => sharp({ create: { width: 10, height: 10, channels: 3, background: '#0f0' } }).tiff().toBuffer();
const model = (user, over = {}) => Creation.create({ user: user._id, type: 'model', kind: 'single', name: 'Cat', status: 'ready', file: 'models/cat.glb', thumb: 'thumbs/cat.jpg', ...over });
const exp = (user, over = {}) => Creation.create({ user: user._id, type: 'export', kind: 'render', name: '3D render', status: 'ready', file: 'exports/a.png', thumb: 'thumbs/a.jpg', ...over });
const get = (auth, p) => request(app).get(`/api/account/${p}`).set(auth);

describe.each([['models', model], ['exports', exp]])('GET /api/account/%s', (seg, make) => {
  test('cần đăng nhập', async () => expect((await request(app).get(`/api/account/${seg}`)).status).toBe(401));
  test('danh sách rỗng ban đầu', async () => {
    const { auth } = await makeUser();
    expect((await get(auth, seg)).body).toEqual({ items: [] });
  });
  test('chỉ trả về của đúng user', async () => {
    const a = await makeUser(); const b = await makeUser();
    await make(a.user); await make(b.user);
    expect((await get(a.auth, seg)).body.items).toHaveLength(1);
  });
  test('mới nhất đứng đầu', async () => {
    const { user, auth } = await makeUser();
    const old = new Date(Date.now() - 100000);
    await make(user, { name: 'old' });
    await Creation.collection.updateOne({ name: 'old' }, { $set: { createdAt: old } });
    await make(user, { name: 'new' });
    expect((await get(auth, seg)).body.items.map((i) => i.name)).toEqual(['new', 'old']);
  });
  test('JSON gồm id, name, kind, thumbnail (/files/..), url, createdAt', async () => {
    const { user, auth } = await makeUser();
    await make(user);
    const [it] = (await get(auth, seg)).body.items;
    expect(Object.keys(it).sort()).toEqual(['createdAt', 'id', 'kind', 'name', 'thumbnail', 'url']);
    expect(it.thumbnail).toMatch(/^\/files\/thumbs\//);
    expect(it.url).toMatch(/^\/files\//);
  });
  test('tên rỗng hiển thị "Untitled"', async () => {
    const { user, auth } = await makeUser();
    await make(user, { name: '' });
    expect((await get(auth, seg)).body.items[0].name).toBe('Untitled');
  });
  test('không lộ trường nội bộ (user, taskId, file thô)', async () => {
    const { user, auth } = await makeUser();
    await make(user, { taskId: 'secret-task' });
    const s = JSON.stringify((await get(auth, seg)).body);
    expect(s).not.toContain('secret-task');
    expect(s).not.toContain(String(user._id));
  });
  test('tối đa 200 mục', async () => {
    const { user, auth } = await makeUser();
    await Creation.insertMany(Array.from({ length: 205 }, (_, i) => ({ user: user._id, type: seg === 'models' ? 'model' : 'export', kind: 'x', name: `n${i}`, status: 'ready' })));
    expect((await get(auth, seg)).body.items).toHaveLength(200);
  });
});

describe('GET /api/account/models: đặc thù', () => {
  test('không trả model đang pending', async () => {
    const { user, auth } = await makeUser();
    await model(user, { status: 'pending', taskId: 't1' });
    expect((await get(auth, 'models')).body.items).toHaveLength(0);
  });
  test('không trộn ảnh export vào danh sách model', async () => {
    const { user, auth } = await makeUser();
    await exp(user);
    expect((await get(auth, 'models')).body.items).toHaveLength(0);
  });
  test('model chưa có file dùng remoteUrl', async () => {
    const { user, auth } = await makeUser();
    await model(user, { file: '', remoteUrl: 'https://fal.media/x.glb' });
    expect((await get(auth, 'models')).body.items[0].url).toBe('https://fal.media/x.glb');
  });
  test('gọi healPendingTasks cho đúng user', async () => {
    const { user, auth } = await makeUser();
    await get(auth, 'models');
    expect(healPendingTasks).toHaveBeenCalledWith(user._id);
  });
  test('healPendingTasks lỗi vẫn trả 200', async () => {
    const { auth } = await makeUser();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    healPendingTasks.mockRejectedValueOnce(new Error('fal down'));
    expect((await get(auth, 'models')).status).toBe(200);
    console.warn.mockRestore();
  });
  test('dọn task pending treo quá 2 ngày (xoá bản ghi + file thumbnail)', async () => {
    const { user, auth } = await makeUser();
    const stale = await model(user, { status: 'pending', taskId: 'old', thumb: 'thumbs/stale.jpg' });
    await Creation.collection.updateOne({ _id: stale._id }, { $set: { createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });
    await model(user, { status: 'pending', taskId: 'fresh' });
    await get(auth, 'models');
    expect(await Creation.countDocuments({ taskId: 'old' })).toBe(0);
    expect(await Creation.countDocuments({ taskId: 'fresh' })).toBe(1);
    expect(storage.removeFiles).toHaveBeenCalledWith('thumbs/stale.jpg');
  });
});

describe.each([['models', model], ['exports', exp]])('PATCH /api/account/%s/:id (đổi tên)', (seg, make) => {
  const patch = (auth, id, body) => request(app).patch(`/api/account/${seg}/${id}`).set(auth).send(body);

  test('đổi tên thành công', async () => {
    const { user, auth } = await makeUser();
    const d = await make(user);
    const r = await patch(auth, d._id, { name: 'Dog' });
    expect(r.body.item.name).toBe('Dog');
    expect((await Creation.findById(d._id)).name).toBe('Dog');
  });
  test('tên được trim và cắt 60 ký tự', async () => {
    const { user, auth } = await makeUser();
    const d = await make(user);
    expect((await patch(auth, d._id, { name: `  ${'a'.repeat(100)}  ` })).body.item.name).toHaveLength(60);
  });
  test.each([[''], ['   ']])('tên %p -> 400', async (name) => {
    const { user, auth } = await makeUser();
    const d = await make(user);
    expect((await patch(auth, d._id, { name })).status).toBe(400);
  });
  test('không có gì để cập nhật -> 400', async () => {
    const { user, auth } = await makeUser();
    const d = await make(user);
    expect((await patch(auth, d._id, {})).status).toBe(400);
  });
  test('id sai định dạng -> 404', async () => {
    const { auth } = await makeUser();
    expect((await patch(auth, 'abc', { name: 'x' })).status).toBe(404);
  });
  test('không sửa được đồ của người khác -> 404', async () => {
    const a = await makeUser(); const b = await makeUser();
    const d = await make(a.user);
    expect((await patch(b.auth, d._id, { name: 'hack' })).status).toBe(404);
    expect((await Creation.findById(d._id)).name).not.toBe('hack');
  });
  test('cần đăng nhập', async () => {
    const { user } = await makeUser();
    const d = await make(user);
    expect((await request(app).patch(`/api/account/${seg}/${d._id}`).send({ name: 'x' })).status).toBe(401);
  });
});

describe('PATCH: đặc thù', () => {
  test('không đổi tên model đang pending -> 404', async () => {
    const { user, auth } = await makeUser();
    const d = await model(user, { status: 'pending', taskId: 't' });
    expect((await request(app).patch(`/api/account/models/${d._id}`).set(auth).send({ name: 'x' })).status).toBe(404);
  });
  test('dùng nhầm đường dẫn /models cho một export -> 404', async () => {
    const { user, auth } = await makeUser();
    const d = await exp(user);
    expect((await request(app).patch(`/api/account/models/${d._id}`).set(auth).send({ name: 'x' })).status).toBe(404);
  });
  test('model: đổi ảnh thumbnail (PNG) -> lưu thumb mới và xoá thumb cũ', async () => {
    const { user, auth } = await makeUser();
    const d = await model(user, { thumb: 'thumbs/old.jpg' });
    const r = await request(app).patch(`/api/account/models/${d._id}`).set(auth).attach('thumb', await png(), 'a.png');
    expect(r.status).toBe(200);
    const after = await Creation.findById(d._id);
    expect(after.thumb).not.toBe('thumbs/old.jpg');
    expect(storage.removeFiles).toHaveBeenCalledWith('thumbs/old.jpg');
  });
  test('model: vừa đổi tên vừa đổi ảnh', async () => {
    const { user, auth } = await makeUser();
    const d = await model(user);
    const r = await request(app).patch(`/api/account/models/${d._id}`).set(auth).field('name', 'Both').attach('thumb', await png(), 'a.png');
    expect(r.body.item.name).toBe('Both');
  });
  test('file không phải ảnh -> 400, không lưu gì', async () => {
    const { user, auth } = await makeUser();
    const d = await model(user);
    const r = await request(app).patch(`/api/account/models/${d._id}`).set(auth).attach('thumb', Buffer.from('not an image'), 'a.png');
    expect(r.status).toBe(400);
    expect(storage.saveThumb).not.toHaveBeenCalled();
  });
  test('định dạng ảnh không hỗ trợ (TIFF) -> 400 dù đặt tên .png', async () => {
    const { user, auth } = await makeUser();
    const d = await model(user);
    const r = await request(app).patch(`/api/account/models/${d._id}`).set(auth).attach('thumb', await tiff(), 'a.png');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PNG, JPG, and WebP/);
  });
  test('ảnh > 12MB -> 413', async () => {
    const { user, auth } = await makeUser();
    const d = await model(user);
    const r = await request(app).patch(`/api/account/models/${d._id}`).set(auth).attach('thumb', Buffer.alloc(12 * 1024 * 1024 + 10), 'big.png');
    expect(r.status).toBe(413);
  });
  test('ảnh export không được đổi thumbnail -> 400', async () => {
    const { user, auth } = await makeUser();
    const d = await exp(user);
    const r = await request(app).patch(`/api/account/exports/${d._id}`).set(auth).attach('thumb', await png(), 'a.png');
    expect(r.status).toBe(400);
  });
  test('lưu DB lỗi thì dọn thumbnail vừa upload', async () => {
    const { user, auth } = await makeUser();
    const d = await model(user);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(Creation.prototype, 'save').mockRejectedValueOnce(new Error('db down'));
    const r = await request(app).patch(`/api/account/models/${d._id}`).set(auth).attach('thumb', await png(), 'a.png');
    expect(r.status).toBe(500);
    expect(storage.removeFiles).toHaveBeenCalled();
    Creation.prototype.save.mockRestore(); console.error.mockRestore();
  });
});

describe.each([['models', model], ['exports', exp]])('DELETE /api/account/%s/:id', (seg, make) => {
  const del = (auth, id) => request(app).delete(`/api/account/${seg}/${id}`).set(auth);

  test('xoá thành công -> 204, xoá bản ghi và cả file + thumb', async () => {
    const { user, auth } = await makeUser();
    const d = await make(user);
    expect((await del(auth, d._id)).status).toBe(204);
    expect(await Creation.findById(d._id)).toBeNull();
    expect(storage.removeFiles).toHaveBeenCalledWith(d.file, d.thumb);
  });
  test('id sai định dạng -> 404', async () => expect((await del((await makeUser()).auth, 'zzz')).status).toBe(404));
  test('không xoá được của người khác -> 404, dữ liệu còn nguyên', async () => {
    const a = await makeUser(); const b = await makeUser();
    const d = await make(a.user);
    expect((await del(b.auth, d._id)).status).toBe(404);
    expect(await Creation.findById(d._id)).not.toBeNull();
  });
  test('xoá 2 lần: lần 2 -> 404', async () => {
    const { user, auth } = await makeUser();
    const d = await make(user);
    await del(auth, d._id);
    expect((await del(auth, d._id)).status).toBe(404);
  });
  test('cần đăng nhập', async () => {
    const { user } = await makeUser();
    const d = await make(user);
    expect((await request(app).delete(`/api/account/${seg}/${d._id}`)).status).toBe(401);
  });
});

describe('POST /api/account/exports', () => {
  const post = (auth) => request(app).post('/api/account/exports').set(auth);

  test('cần đăng nhập', async () => expect((await request(app).post('/api/account/exports')).status).toBe(401));
  test('thiếu ảnh -> 400', async () => expect((await post((await makeUser()).auth).field('kind', 'render')).status).toBe(400));
  test('ảnh PNG -> 201, mặc định kind=render, tên "3D render"', async () => {
    const { auth } = await makeUser();
    const r = await post(auth).attach('image', await png(), 'x.png');
    expect(r.status).toBe(201);
    expect(r.body.item).toMatchObject({ kind: 'render', name: '3D render' });
    expect(storage.saveBuffer).toHaveBeenCalledWith('exports', '.png', expect.any(Buffer));
  });
  test('kind=ai-style -> tên "AI style image"', async () => {
    const { auth } = await makeUser();
    const r = await post(auth).field('kind', 'ai-style').attach('image', await png(), 'x.png');
    expect(r.body.item).toMatchObject({ kind: 'ai-style', name: 'AI style image' });
  });
  test('kind lạ rơi về render', async () => {
    const { auth } = await makeUser();
    expect((await post(auth).field('kind', 'hack').attach('image', await png(), 'x.png')).body.item.kind).toBe('render');
  });
  test('JPEG -> đuôi .jpg, WebP -> đuôi .webp', async () => {
    const { auth } = await makeUser();
    const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).jpeg().toBuffer();
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).webp().toBuffer();
    await post(auth).attach('image', jpg, 'a.jpg');
    await post(auth).attach('image', webp, 'a.webp');
    expect(storage.saveBuffer.mock.calls.map((c) => c[1])).toEqual(['.jpg', '.webp']);
  });
  test('file giả ảnh (mimetype dối) -> 400', async () => {
    const { auth } = await makeUser();
    expect((await post(auth).attach('image', Buffer.from('<?php evil ?>'), { filename: 'x.png', contentType: 'image/png' })).status).toBe(400);
    expect(storage.saveBuffer).not.toHaveBeenCalled();
  });
  test('TIFF -> 400', async () => {
    const { auth } = await makeUser();
    expect((await post(auth).attach('image', await tiff(), 'x.png')).status).toBe(400);
  });
  test('sai tên field -> 400', async () => {
    const { auth } = await makeUser();
    expect((await post(auth).attach('file', await png(), 'x.png')).status).toBe(400);
  });
  test('> 12MB -> 413', async () => {
    const { auth } = await makeUser();
    expect((await post(auth).attach('image', Buffer.alloc(12 * 1024 * 1024 + 10), 'big.png')).status).toBe(413);
  });
  test('đã có 200 ảnh -> 409', async () => {
    const { user, auth } = await makeUser();
    await Creation.insertMany(Array.from({ length: 200 }, () => ({ user: user._id, type: 'export', kind: 'render', status: 'ready' })));
    expect((await post(auth).attach('image', await png(), 'x.png')).status).toBe(409);
  });
  test('hạn mức 200 ảnh tính riêng từng user', async () => {
    const a = await makeUser(); const b = await makeUser();
    await Creation.insertMany(Array.from({ length: 200 }, () => ({ user: a.user._id, type: 'export', kind: 'render', status: 'ready' })));
    expect((await post(b.auth).attach('image', await png(), 'x.png')).status).toBe(201);
  });
  test('tạo thumbnail lỗi vẫn lưu ảnh (thumbnail rỗng)', async () => {
    const { auth } = await makeUser();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    storage.saveThumb.mockRejectedValueOnce(new Error('sharp'));
    const r = await post(auth).attach('image', await png(), 'x.png');
    expect(r.status).toBe(201);
    expect(r.body.item.thumbnail).toBe('');
    console.warn.mockRestore();
  });
});

describe('PUT /api/account/game/snap-solve', () => {
  const put = (auth, body) => request(app).put('/api/account/game/snap-solve').set(auth).send(body);

  test('cần đăng nhập', async () => expect((await request(app).put('/api/account/game/snap-solve').send({})).status).toBe(401));
  test('body rỗng -> trả về tiến độ rỗng', async () => {
    const { auth } = await makeUser();
    expect((await put(auth, {})).body.snapSolve).toEqual({ completed: [], best: {} });
  });
  test('lưu level đã xong (sắp xếp tăng dần) và thời gian tốt nhất', async () => {
    const { auth } = await makeUser();
    const r = await put(auth, { completed: [3, 1], best: { 1: 12.5, 3: 30 } });
    expect(r.body.snapSolve).toEqual({ completed: [1, 3], best: { 1: 12.5, 3: 30 } });
  });
  test('lọc level không hợp lệ (0, âm, >50, số thực, chữ, trùng)', async () => {
    const { auth } = await makeUser();
    const r = await put(auth, { completed: [1, 1, 0, -2, 51, 99, 1.5, 'a', null, 50] });
    expect(r.body.snapSolve.completed).toEqual([1, 50]);
  });
  test('lọc thời gian không hợp lệ (0, âm, >= 24h, NaN) và key lạ', async () => {
    const { auth } = await makeUser();
    const r = await put(auth, { best: { 1: 0, 2: -5, 3: 86400, 4: 'abc', 0: 10, 51: 10, 5: 86399.5, 6: 7 } });
    expect(r.body.snapSolve.best).toEqual({ 5: 86399.5, 6: 7 });
  });
  test('làm tròn thời gian 2 chữ số', async () => {
    const { auth } = await makeUser();
    expect((await put(auth, { best: { 1: 12.346 } })).body.snapSolve.best[1]).toBe(12.35);
  });
  test('GỘP: thời gian nhỏ hơn thắng, chậm hơn không ghi đè', async () => {
    const { auth } = await makeUser();
    await put(auth, { best: { 1: 20 } });
    expect((await put(auth, { best: { 1: 30 } })).body.snapSolve.best[1]).toBe(20);
    expect((await put(auth, { best: { 1: 10 } })).body.snapSolve.best[1]).toBe(10);
  });
  test('GỘP: level đã xong chỉ tăng, không bao giờ bị mất', async () => {
    const { auth } = await makeUser();
    await put(auth, { completed: [1, 2] });
    expect((await put(auth, { completed: [3] })).body.snapSolve.completed).toEqual([1, 2, 3]);
    expect((await put(auth, { completed: [] })).body.snapSolve.completed).toEqual([1, 2, 3]);
  });
  test('2 request đồng thời không ghi đè nhau', async () => {
    const { user, auth } = await makeUser();
    await Promise.all([put(auth, { completed: [1] }), put(auth, { completed: [2] }), put(auth, { completed: [3] })]);
    expect((await User.findById(user._id)).snapSolve.completed.sort()).toEqual([1, 2, 3]);
  });
  test('tiến độ của mỗi tài khoản tách biệt', async () => {
    const a = await makeUser(); const b = await makeUser();
    await put(a.auth, { completed: [1, 2] });
    expect((await put(b.auth, {})).body.snapSolve.completed).toEqual([]);
  });
});
