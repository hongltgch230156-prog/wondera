// Giới hạn tần suất THẬT (express-rate-limit không bị mock): chống dò mật khẩu và spam mail
const request = require('supertest');
const app = require('../../server');
const { connectDb, clearDb, disconnectDb } = require('../helpers/db');

beforeAll(connectDb);
afterAll(disconnectDb);
beforeEach(clearDb);

// Dùng email sai định dạng => server trả 400 ngay (không tốn bcrypt/DB) nhưng vẫn bị tính vào hạn mức.
describe('limiter đăng ký/đăng nhập: 30 lần / 15 phút / IP', () => {
  test('30 request đầu qua được, request thứ 31 bị chặn 429', async () => {
    let last;
    for (let i = 0; i < 30; i += 1) {
      last = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.1').send({ email: 'bad', password: 'x' });
      expect(last.status).toBe(400);
    }
    last = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.1').send({ email: 'bad', password: 'x' });
    expect(last.status).toBe(429);
    expect(last.body.error).toMatch(/Too many requests/);
  });
  test('hạn mức tính theo IP: IP khác không bị ảnh hưởng', async () => {
    const r = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.77').send({ email: 'bad', password: 'x' });
    expect(r.status).toBe(400);
  });
  test('trả header RateLimit chuẩn', async () => {
    const r = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.78').send({ email: 'bad', password: 'x' });
    expect(r.headers).toHaveProperty('ratelimit-limit', '30');
    expect(r.headers).not.toHaveProperty('x-ratelimit-limit');
  });
});

describe('limiter quên mật khẩu: 5 lần / 15 phút / IP', () => {
  test('5 lần đầu được xử lý, lần thứ 6 bị 429', async () => {
    const send = () => request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', '198.51.100.2').send({ email: 'bad' });
    for (let i = 0; i < 5; i += 1) expect((await send()).status).toBe(400);
    const r = await send();
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/too many requests/i);
  });
  test('đăng nhập và quên mật khẩu dùng bộ đếm riêng', async () => {
    const r = await request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', '198.51.100.1').send({ email: 'bad' });
    expect(r.status).toBe(400); // IP .1 đã bị chặn ở login nhưng chưa dùng forgot
  });
});
