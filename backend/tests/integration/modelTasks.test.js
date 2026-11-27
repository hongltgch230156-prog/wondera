// healPendingTasks: "cứu" các task 3D mà frontend đã ngừng hỏi (user đóng tab)
jest.mock('@fal-ai/client', () => ({ fal: { queue: { status: jest.fn(), result: jest.fn() } } }));
jest.mock('../../utils/storage', () => {
  const actual = jest.requireActual('../../utils/storage');
  return { ...actual, saveBuffer: jest.fn(async (d, e) => `${d}/x${e}`), fetchBuffer: jest.fn(async () => Buffer.from('glb')), saveThumb: jest.fn(async () => 'thumbs/t.jpg'), removeFiles: jest.fn() };
});

const { fal } = require('@fal-ai/client');
const storage = require('../../utils/storage');
const { healPendingTasks, trackModelTask, finalizeModelTask } = require('../../utils/modelTasks');
const credits = require('../../utils/credits');
const Creation = require('../../models/Creation');
const User = require('../../models/User');
const { connectDb, clearDb, disconnectDb, makeUser } = require('../helpers/db');

beforeAll(connectDb);
afterAll(disconnectDb);
beforeEach(async () => {
  await clearDb();
  fal.queue.status.mockReset(); fal.queue.result.mockReset();
  storage.fetchBuffer.mockClear(); storage.saveBuffer.mockClear();
  ['log', 'warn', 'error'].forEach((k) => jest.spyOn(console, k).mockImplementation(() => {}));
});
afterEach(() => ['log', 'warn', 'error'].forEach((k) => console[k].mockRestore && console[k].mockRestore()));

const pending = (user, taskId, over = {}) => Creation.create({ user: user._id, type: 'model', kind: 'single', name: 'n', status: 'pending', taskId, ...over });

describe('trackModelTask', () => {
  test('tạo bản ghi pending với tên sạch (bỏ đuôi, đổi _ - thành khoảng trắng)', async () => {
    const { user } = await makeUser();
    await trackModelTask(user._id, 't1', { kind: 'single', name: 'my_cool-model.PNG', thumbBuffer: Buffer.from('x') });
    expect(await Creation.findOne({ taskId: 't1' })).toMatchObject({ name: 'my cool model', status: 'pending', kind: 'single', thumb: 'thumbs/t.jpg' });
  });
  test.each([['single', '3D Object'], ['scene', '3D Scene'], ['magic', 'Magic Wand object'], ['other', '3D Model']])('tên rỗng, kind=%s -> "%s"', async (kind, expected) => {
    const { user } = await makeUser();
    await trackModelTask(user._id, `t-${kind}`, { kind, name: '' });
    expect((await Creation.findOne({ taskId: `t-${kind}` })).name).toBe(expected);
  });
  test('gọi trùng cùng taskId không ném lỗi và không tạo bản ghi thứ 2', async () => {
    const { user } = await makeUser();
    await trackModelTask(user._id, 'dup', { kind: 'single', name: 'a' });
    await expect(trackModelTask(user._id, 'dup', { kind: 'single', name: 'a' })).resolves.toBeUndefined();
    expect(await Creation.countDocuments({ taskId: 'dup' })).toBe(1);
  });
  test('thumbUrl không phải của fal thì không tải về', async () => {
    const { user } = await makeUser();
    await trackModelTask(user._id, 'x', { kind: 'magic', name: '', thumbUrl: 'https://evil.com/a.png' });
    expect(storage.fetchBuffer).not.toHaveBeenCalled();
  });
});

describe('finalizeModelTask', () => {
  test('pending -> ready, lưu remoteUrl và tải file lên kho', async () => {
    const { user } = await makeUser(); await pending(user, 'f1');
    await finalizeModelTask(user._id, 'f1', 'https://fal.media/a.glb');
    expect(await Creation.findOne({ taskId: 'f1' })).toMatchObject({ status: 'ready', remoteUrl: 'https://fal.media/a.glb', file: 'models/x.glb' });
  });
  test('chỉ xử lý 1 lần: lần gọi thứ 2 không tải lại', async () => {
    const { user } = await makeUser(); await pending(user, 'f2');
    await finalizeModelTask(user._id, 'f2', 'https://fal.media/a.glb');
    await finalizeModelTask(user._id, 'f2', 'https://fal.media/a.glb');
    expect(storage.fetchBuffer).toHaveBeenCalledTimes(1);
  });
  test('task của người khác -> bỏ qua', async () => {
    const a = await makeUser(); const b = await makeUser(); await pending(a.user, 'f3');
    await finalizeModelTask(b.user._id, 'f3', 'https://fal.media/a.glb');
    expect((await Creation.findOne({ taskId: 'f3' })).status).toBe('pending');
  });
  test('upload lỗi: bản ghi vẫn ready (dùng tạm link fal), không ném lỗi', async () => {
    const { user } = await makeUser(); await pending(user, 'f4');
    storage.fetchBuffer.mockRejectedValueOnce(new Error('too big'));
    await expect(finalizeModelTask(user._id, 'f4', 'https://fal.media/a.glb')).resolves.toBeUndefined();
    expect(await Creation.findOne({ taskId: 'f4' })).toMatchObject({ status: 'ready', file: '' });
  });
});

describe('healPendingTasks', () => {
  test('task đã COMPLETED trên fal -> được lưu thành ready', async () => {
    const { user } = await makeUser(); await pending(user, 'h1');
    fal.queue.status.mockResolvedValueOnce({ status: 'COMPLETED' });
    fal.queue.result.mockResolvedValueOnce({ data: { model_glb: { url: 'https://fal.media/h.glb' } } });
    await healPendingTasks(user._id);
    expect((await Creation.findOne({ taskId: 'h1' })).status).toBe('ready');
  });
  test('task vẫn đang chạy -> giữ nguyên pending', async () => {
    const { user } = await makeUser(); await pending(user, 'h2');
    fal.queue.status.mockResolvedValueOnce({ status: 'IN_PROGRESS' });
    await healPendingTasks(user._id);
    expect((await Creation.findOne({ taskId: 'h2' })).status).toBe('pending');
  });
  test('task FAILED -> hoàn credit', async () => {
    const { user } = await makeUser();
    const { key } = await credits.debit(user._id, 1); await credits.attachTask(key, 'h3'); await pending(user, 'h3');
    fal.queue.status.mockResolvedValueOnce({ status: 'FAILED' });
    await healPendingTasks(user._id);
    await new Promise((r) => setTimeout(r, 100));
    expect((await User.findById(user._id)).credits).toBeGreaterThanOrEqual(4);
  });
  test('task cũ hơn 2 ngày không được hỏi fal', async () => {
    const { user } = await makeUser(); const d = await pending(user, 'h4');
    await Creation.collection.updateOne({ _id: d._id }, { $set: { createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });
    await healPendingTasks(user._id);
    expect(fal.queue.status).not.toHaveBeenCalled();
  });
  test('một task lỗi không làm hỏng các task còn lại', async () => {
    const { user } = await makeUser(); await pending(user, 'h5'); await pending(user, 'h6');
    fal.queue.status.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ status: 'IN_PROGRESS' });
    await expect(healPendingTasks(user._id)).resolves.toBeUndefined();
    expect(fal.queue.status).toHaveBeenCalledTimes(2);
  });
  test('chỉ xử lý tối đa 10 task mỗi lần', async () => {
    const { user } = await makeUser();
    for (let i = 0; i < 12; i += 1) await pending(user, `b${i}`);
    fal.queue.status.mockResolvedValue({ status: 'IN_PROGRESS' });
    await healPendingTasks(user._id);
    expect(fal.queue.status).toHaveBeenCalledTimes(10);
  });
  test('bản ghi ready nhưng chưa có file -> thử upload lại từ link fal', async () => {
    const { user } = await makeUser();
    await Creation.create({ user: user._id, type: 'model', kind: 'single', status: 'ready', file: '', remoteUrl: 'https://fal.media/o.glb' });
    await healPendingTasks(user._id);
    expect((await Creation.findOne({ user: user._id })).file).toBe('models/x.glb');
  });
  test('không đụng tới task của user khác', async () => {
    const a = await makeUser(); const b = await makeUser(); await pending(b.user, 'other');
    await healPendingTasks(a.user._id);
    expect(fal.queue.status).not.toHaveBeenCalled();
  });
});
