// requireAuth + /api/auth/* (đăng ký, đăng nhập, Google, me, quên/đặt lại mật khẩu)
jest.mock('express-rate-limit', () => () => (req, res, next) => next()); // limiter thật được test riêng ở rateLimit.test.js
jest.mock('../../utils/mailer', () => ({ sendResetCode: jest.fn().mockResolvedValue(undefined) }));

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const { sendResetCode } = require('../../utils/mailer');
const { connectDb, clearDb, disconnectDb, makeUser, signToken, oid, sleep } = require('../helpers/db');

beforeAll(connectDb);
afterAll(disconnectDb);
beforeEach(async () => { await clearDb(); sendResetCode.mockClear(); sendResetCode.mockResolvedValue(undefined); });

const hashCode = (code) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(code).digest('hex');
const hashPw = (pw) => bcrypt.hashSync(pw, 4);

describe('requireAuth (qua GET /api/auth/me)', () => {
  const me = (h) => request(app).get('/api/auth/me').set(h || {});

  test('không có header -> 401', async () => expect((await me()).status).toBe(401));
  test('sai kiểu Authorization (Basic) -> 401', async () => expect((await me({ Authorization: 'Basic abc' })).status).toBe(401));
  test('"Bearer " rỗng -> 401', async () => expect((await me({ Authorization: 'Bearer ' })).status).toBe(401));
  test('token rác -> 401', async () => expect((await me({ Authorization: 'Bearer xxx.yyy.zzz' })).status).toBe(401));
  test('token ký bằng secret khác -> 401', async () => {
    const { user } = await makeUser();
    expect((await me({ Authorization: `Bearer ${signToken(user._id, { expiresIn: '1h' }, 'other-secret')}` })).status).toBe(401);
  });
  test('token hết hạn -> 401', async () => {
    const { user } = await makeUser();
    expect((await me({ Authorization: `Bearer ${signToken(user._id, { expiresIn: -10 })}` })).status).toBe(401);
  });
  test('token alg=none -> 401', async () => {
    const { user } = await makeUser();
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: String(user._id) })}.`;
    expect((await me({ Authorization: `Bearer ${t}` })).status).toBe(401);
  });
  test('payload id không phải ObjectId -> 401 (không crash 500)', async () => {
    expect((await me({ Authorization: `Bearer ${jwt.sign({ id: 'abc' }, process.env.JWT_SECRET)}` })).status).toBe(401);
  });
  test('user đã bị xoá -> 401 "Account no longer exists"', async () => {
    const r = await me({ Authorization: `Bearer ${signToken(oid())}` });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/no longer exists/);
  });
  test('đổi mật khẩu sau khi cấp token -> token cũ bị vô hiệu', async () => {
    const { user } = await makeUser();
    const old = jwt.sign({ id: String(user._id), iat: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
    await User.updateOne({ _id: user._id }, { passwordChangedAt: new Date() });
    const r = await me({ Authorization: `Bearer ${old}` });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/Password has been changed/);
  });
  test('đổi mật khẩu TRƯỚC khi cấp token -> token vẫn dùng được', async () => {
    const { user, auth } = await makeUser();
    await User.updateOne({ _id: user._id }, { passwordChangedAt: new Date(Date.now() - 3600 * 1000) });
    expect((await me(auth)).status).toBe(200);
  });
  test('token hợp lệ -> 200 và chỉ trả id/email/name/avatar', async () => {
    const { user, auth } = await makeUser({ password: hashPw('abcdefgh'), avatar: 'a.png' });
    const r = await me(auth);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.user).sort()).toEqual(['avatar', 'email', 'id', 'name']);
    expect(r.body.user.id).toBe(String(user._id));
    expect(JSON.stringify(r.body)).not.toMatch(/password|\$2[aby]\$/);
  });
});

describe('POST /api/auth/register', () => {
  const reg = (body) => request(app).post('/api/auth/register').send(body);

  test('đăng ký thành công -> 201, token hợp lệ, user công khai', async () => {
    const r = await reg({ email: 'new@user.com', password: 'password1' });
    expect(r.status).toBe(201);
    expect(jwt.verify(r.body.token, process.env.JWT_SECRET).id).toBe(r.body.user.id);
    expect(r.body.user).toMatchObject({ email: 'new@user.com', name: 'new' });
  });
  test('email được trim + chuyển chữ thường', async () => {
    const r = await reg({ email: '  Foo.Bar@Example.COM ', password: 'password1' });
    expect(r.body.user.email).toBe('foo.bar@example.com');
  });
  test('mật khẩu được băm bcrypt, không lưu nguyên văn', async () => {
    await reg({ email: 'h@x.com', password: 'password1' });
    const u = await User.findOne({ email: 'h@x.com' }).select('+password');
    expect(u.password).not.toBe('password1');
    expect(await bcrypt.compare('password1', u.password)).toBe(true);
  });
  test.each([[''], ['abc'], ['a@b'], ['a b@c.com'], ['@x.com'], ['a@.com'], [null], [123]])('email %p -> 400', async (email) => {
    expect((await reg({ email, password: 'password1' })).status).toBe(400);
  });
  test.each([[''], ['1234567'], [undefined]])('mật khẩu %p (ngắn/thiếu) -> 400', async (password) => {
    expect((await reg({ email: 'p@x.com', password })).status).toBe(400);
  });
  test('mật khẩu 8 ký tự được chấp nhận', async () => expect((await reg({ email: 'e8@x.com', password: '12345678' })).status).toBe(201));
  test('mật khẩu 72 ký tự được chấp nhận', async () => expect((await reg({ email: 'e72@x.com', password: 'a'.repeat(72) })).status).toBe(201));
  test('mật khẩu 73 ký tự -> 400 (giới hạn bcrypt)', async () => {
    expect((await reg({ email: 'e73@x.com', password: 'a'.repeat(73) })).status).toBe(400);
  });
  test('email đã đăng ký -> 409, kể cả khi khác hoa/thường', async () => {
    await reg({ email: 'dup@x.com', password: 'password1' });
    expect((await reg({ email: 'DUP@x.com', password: 'password1' })).status).toBe(409);
  });
  test('email của tài khoản Google -> 409 kèm gợi ý "Continue with Google"', async () => {
    await User.create({ email: 'g@x.com', googleId: 'gid-1' });
    const r = await reg({ email: 'g@x.com', password: 'password1' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Google/);
  });
  test('đăng ký 2 lần đồng thời cùng email: không bao giờ tạo 2 user', async () => {
    const rs = await Promise.all([reg({ email: 'race@x.com', password: 'password1' }), reg({ email: 'race@x.com', password: 'password1' })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments({ email: 'race@x.com' })).toBe(1);
  });
  // LỖI TIỀM ẨN: Express 5 không khởi tạo req.body => request không có body có thể gây 500 thay vì 400
  test('request không có body -> 4xx, không phải 500', async () => {
    const r = await request(app).post('/api/auth/register');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});

describe('POST /api/auth/login', () => {
  const login = (body) => request(app).post('/api/auth/login').send(body);
  beforeEach(() => User.create({ email: 'u@x.com', password: hashPw('password1'), name: 'U' }));

  test('đăng nhập đúng -> 200 + token', async () => {
    const r = await login({ email: 'u@x.com', password: 'password1' });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
  });
  test('email không phân biệt hoa/thường và khoảng trắng', async () => {
    expect((await login({ email: ' U@X.com ', password: 'password1' })).status).toBe(200);
  });
  test('sai mật khẩu -> 401', async () => expect((await login({ email: 'u@x.com', password: 'wrongpass1' })).status).toBe(401));
  test('email không tồn tại -> 401 cùng thông báo với sai mật khẩu (không lộ email nào tồn tại)', async () => {
    const a = await login({ email: 'nobody@x.com', password: 'password1' });
    const b = await login({ email: 'u@x.com', password: 'wrongpass1' });
    expect(a.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });
  test.each([[{ email: 'u@x.com' }], [{ password: 'password1' }], [{ email: 'bad', password: 'x' }], [{}]])('thiếu/sai dữ liệu %p -> 400', async (b) => {
    expect((await login(b)).status).toBe(400);
  });
  test('tài khoản chỉ có Google -> 401 kèm gợi ý dùng Google', async () => {
    await User.create({ email: 'g@x.com', googleId: 'gid' });
    const r = await login({ email: 'g@x.com', password: 'whatever12' });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/Google/);
  });
  test('không bao giờ trả password trong phản hồi', async () => {
    expect(JSON.stringify((await login({ email: 'u@x.com', password: 'password1' })).body)).not.toMatch(/\$2[aby]\$/);
  });
  test('không thể tiêm toán tử NoSQL qua email', async () => {
    expect((await login({ email: { $ne: null }, password: 'password1' })).status).toBe(400);
  });
});

describe('PATCH /api/auth/me', () => {
  const patch = (auth, body) => request(app).patch('/api/auth/me').set(auth).send(body);

  test('cần đăng nhập', async () => expect((await request(app).patch('/api/auth/me').send({ name: 'x' })).status).toBe(401));
  test('đổi tên thành công và lưu vào DB', async () => {
    const { user, auth } = await makeUser();
    const r = await patch(auth, { name: 'Hồng' });
    expect(r.body.user.name).toBe('Hồng');
    expect((await User.findById(user._id)).name).toBe('Hồng');
  });
  test('tên được trim', async () => {
    const { auth } = await makeUser();
    expect((await patch(auth, { name: '  Bob  ' })).body.user.name).toBe('Bob');
  });
  test('tên dài hơn 40 ký tự bị cắt', async () => {
    const { auth } = await makeUser();
    expect((await patch(auth, { name: 'a'.repeat(100) })).body.user.name).toHaveLength(40);
  });
  test.each([[{ name: '' }], [{ name: '    ' }], [{}], [{ name: null }]])('%p -> 400', async (b) => {
    const { auth } = await makeUser();
    expect((await patch(auth, b)).status).toBe(400);
  });
});

describe('POST /api/auth/google', () => {
  const google = (body) => request(app).post('/api/auth/google').send(body);
  const ok = (json) => ({ ok: true, json: async () => json });
  const bad = { ok: false, json: async () => ({}) };
  const info = (over = {}) => ({ aud: 'test-google-client-id', iss: 'https://accounts.google.com', sub: 'sub-1', email: 'G@Gmail.com', email_verified: 'true', name: 'Gina', picture: 'p.png', ...over });

  test('thiếu cả hai token -> 400', async () => expect((await google({})).status).toBe(400));
  test('thiếu GOOGLE_CLIENT_ID trên server -> 500', async () => {
    const saved = process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_ID;
    try { expect((await google({ idToken: 't' })).status).toBe(500); } finally { process.env.GOOGLE_CLIENT_ID = saved; }
  });
  test('idToken hợp lệ -> tạo user mới với googleId, email chữ thường', async () => {
    global.fetch.mockResolvedValueOnce(ok(info()));
    const r = await google({ idToken: 'tok' });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ email: 'g@gmail.com', name: 'Gina', avatar: 'p.png' });
    expect((await User.findOne({ email: 'g@gmail.com' })).googleId).toBe('sub-1');
  });
  test('gọi tokeninfo với id_token đã mã hoá URL', async () => {
    global.fetch.mockResolvedValueOnce(ok(info()));
    await google({ idToken: 'a b&c' });
    expect(global.fetch.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/tokeninfo?id_token=a%20b%26c');
  });
  test('đăng nhập Google 2 lần không tạo trùng user', async () => {
    global.fetch.mockResolvedValue(ok(info()));
    await google({ idToken: 't' }); await google({ idToken: 't' });
    expect(await User.countDocuments()).toBe(1);
  });
  test('liên kết Google vào tài khoản email/mật khẩu có sẵn', async () => {
    await User.create({ email: 'g@gmail.com', password: hashPw('password1') });
    global.fetch.mockResolvedValueOnce(ok(info()));
    await google({ idToken: 't' });
    const u = await User.findOne({ email: 'g@gmail.com' }).select('+password');
    expect(u.googleId).toBe('sub-1');
    expect(u.password).toBeTruthy();
  });
  test('bổ sung avatar/tên còn thiếu của user có sẵn', async () => {
    await User.create({ email: 'g@gmail.com', name: '' });
    global.fetch.mockResolvedValueOnce(ok(info()));
    await google({ idToken: 't' });
    expect(await User.findOne({ email: 'g@gmail.com' })).toMatchObject({ name: 'Gina', avatar: 'p.png' });
  });
  test('tokeninfo trả lỗi -> 401', async () => {
    global.fetch.mockResolvedValueOnce(bad);
    expect((await google({ idToken: 't' })).status).toBe(401);
  });
  test('token cấp cho ứng dụng khác (aud sai) -> 401', async () => {
    global.fetch.mockResolvedValueOnce(ok(info({ aud: 'someone-else' })));
    expect((await google({ idToken: 't' })).status).toBe(401);
  });
  test('issuer lạ -> 401', async () => {
    global.fetch.mockResolvedValueOnce(ok(info({ iss: 'https://evil.com' })));
    expect((await google({ idToken: 't' })).status).toBe(401);
  });
  test.each([['accounts.google.com'], ['https://accounts.google.com']])('issuer %s được chấp nhận', async (iss) => {
    global.fetch.mockResolvedValueOnce(ok(info({ iss })));
    expect((await google({ idToken: 't' })).status).toBe(200);
  });
  test.each([['false'], [false], [undefined]])('email_verified=%p -> 401', async (v) => {
    global.fetch.mockResolvedValueOnce(ok(info({ email_verified: v })));
    expect((await google({ idToken: 't' })).status).toBe(401);
  });
  test('email_verified là boolean true được chấp nhận', async () => {
    global.fetch.mockResolvedValueOnce(ok(info({ email_verified: true })));
    expect((await google({ idToken: 't' })).status).toBe(200);
  });
  test('luồng web (accessToken): tokeninfo + userinfo', async () => {
    global.fetch.mockResolvedValueOnce(ok({ aud: 'test-google-client-id' }))
      .mockResolvedValueOnce(ok({ sub: 's9', email: 'w@x.com', email_verified: true, name: 'W' }));
    const r = await google({ accessToken: 'at' });
    expect(r.status).toBe(200);
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer at');
  });
  test('luồng web: aud sai -> 401', async () => {
    global.fetch.mockResolvedValueOnce(ok({ aud: 'other' }));
    expect((await google({ accessToken: 'at' })).status).toBe(401);
  });
  test('luồng web: userinfo lỗi -> 401', async () => {
    global.fetch.mockResolvedValueOnce(ok({ aud: 'test-google-client-id' })).mockResolvedValueOnce(bad);
    expect((await google({ accessToken: 'at' })).status).toBe(401);
  });
  test('lỗi mạng khi gọi Google -> 500 thông báo chung', async () => {
    const r = await google({ idToken: 't' }); // fetch mặc định bị chặn => reject
    expect(r.status).toBe(500);
  });
});

describe('POST /api/auth/forgot-password', () => {
  const forgot = (email) => request(app).post('/api/auth/forgot-password').send({ email });
  beforeEach(() => User.create({ email: 'f@x.com', password: hashPw('password1') }));

  test('email sai định dạng -> 400', async () => expect((await forgot('nope')).status).toBe(400));
  test('email chưa đăng ký -> 404 EMAIL_NOT_FOUND', async () => {
    const r = await forgot('ghost@x.com');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('EMAIL_NOT_FOUND');
    expect(sendResetCode).not.toHaveBeenCalled();
  });
  test('email hợp lệ -> 200 và gửi mail kèm mã 6 chữ số', async () => {
    expect((await forgot('f@x.com')).status).toBe(200);
    expect(sendResetCode).toHaveBeenCalledTimes(1);
    expect(sendResetCode.mock.calls[0][0]).toBe('f@x.com');
    expect(sendResetCode.mock.calls[0][1]).toMatch(/^\d{6}$/);
  });
  test('chỉ lưu bản băm HMAC của mã, hạn 10 phút, attempts = 0', async () => {
    await forgot('f@x.com');
    const code = sendResetCode.mock.calls[0][1];
    const u = await User.findOne({ email: 'f@x.com' }).select('+resetCodeHash +resetCodeExpires +resetAttempts');
    expect(u.resetCodeHash).toBe(hashCode(code));
    expect(u.resetCodeHash).not.toContain(code);
    expect(u.resetCodeExpires.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(u.resetCodeExpires.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(u.resetAttempts).toBe(0);
  });
  test('email không phân biệt hoa/thường', async () => {
    expect((await forgot('F@X.COM')).status).toBe(200);
    expect(sendResetCode).toHaveBeenCalledTimes(1);
  });
  test('xin lại trong vòng 60 giây: vẫn 200 nhưng KHÔNG gửi thêm mail, mã cũ giữ nguyên', async () => {
    await forgot('f@x.com');
    const before = (await User.findOne({ email: 'f@x.com' }).select('+resetCodeHash')).resetCodeHash;
    expect((await forgot('f@x.com')).status).toBe(200);
    expect(sendResetCode).toHaveBeenCalledTimes(1);
    expect((await User.findOne({ email: 'f@x.com' }).select('+resetCodeHash')).resetCodeHash).toBe(before);
  });
  test('sau 60 giây được gửi mã mới', async () => {
    await forgot('f@x.com');
    await User.updateOne({ email: 'f@x.com' }, { resetSentAt: new Date(Date.now() - 61 * 1000) });
    await forgot('f@x.com');
    expect(sendResetCode).toHaveBeenCalledTimes(2);
  });
  test('gửi mail lỗi vẫn trả 200 (gửi nền, không làm hỏng request)', async () => {
    sendResetCode.mockRejectedValueOnce(new Error('smtp down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect((await forgot('f@x.com')).status).toBe(200);
    console.error.mockRestore();
  });
});

describe('POST /api/auth/reset-password', () => {
  const reset = (body) => request(app).post('/api/auth/reset-password').send(body);
  const seed = async (over = {}) => {
    const code = '123456';
    const user = await User.create({
      email: 'r@x.com', password: hashPw('oldpassword'), resetCodeHash: hashCode(code),
      resetCodeExpires: new Date(Date.now() + 5 * 60 * 1000), resetAttempts: 0, resetSentAt: new Date(), ...over,
    });
    return { user, code };
  };
  const good = (code = '123456') => ({ email: 'r@x.com', code, password: 'newpassword1' });

  test('đặt lại thành công -> 200, đăng nhập được bằng mật khẩu mới, mật khẩu cũ không còn dùng được', async () => {
    await seed();
    expect((await reset(good())).status).toBe(200);
    await sleep(1100); // token mới phải được cấp SAU passwordChangedAt (so sánh theo giây)
    expect((await request(app).post('/api/auth/login').send({ email: 'r@x.com', password: 'newpassword1' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'r@x.com', password: 'oldpassword' })).status).toBe(401);
  });
  test('xoá mã sau khi dùng và đặt passwordChangedAt', async () => {
    await seed();
    await reset(good());
    const u = await User.findOne({ email: 'r@x.com' }).select('+resetCodeHash +resetCodeExpires');
    expect(u.resetCodeHash).toBeUndefined();
    expect(u.resetCodeExpires).toBeUndefined();
    expect(u.passwordChangedAt).toBeInstanceOf(Date);
  });
  test('mã chỉ dùng được 1 lần', async () => {
    await seed();
    await reset(good());
    expect((await reset(good())).status).toBe(400);
  });
  test('token đăng nhập cũ bị vô hiệu sau khi đặt lại mật khẩu', async () => {
    const { user } = await seed();
    const old = jwt.sign({ id: String(user._id), iat: Math.floor(Date.now() / 1000) - 30 }, process.env.JWT_SECRET);
    await reset(good());
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${old}`)).status).toBe(401);
  });
  test('mã sai -> 400 và tăng bộ đếm', async () => {
    await seed();
    expect((await reset(good('000000'))).status).toBe(400);
    expect((await User.findOne({ email: 'r@x.com' }).select('+resetAttempts')).resetAttempts).toBe(1);
  });
  test('sai 5 lần thì kể cả nhập đúng mã cũng bị khoá (429)', async () => {
    await seed({ resetAttempts: 5 });
    expect((await reset(good())).status).toBe(429);
  });
  test('mã hết hạn -> 400', async () => {
    await seed({ resetCodeExpires: new Date(Date.now() - 1000) });
    expect((await reset(good())).status).toBe(400);
  });
  test('email chưa từng xin mã -> 400 (cùng thông báo)', async () => {
    await User.create({ email: 'r@x.com', password: hashPw('oldpassword') });
    expect((await reset(good())).status).toBe(400);
  });
  test.each([['12345'], ['1234567'], ['abcdef'], [''], ['12 456']])('mã sai định dạng %p -> 400', async (code) => {
    await seed();
    expect((await reset(good(code))).status).toBe(400);
  });
  test('mật khẩu mới quá ngắn -> 400 và mã chưa bị tiêu hao', async () => {
    await seed();
    expect((await reset({ ...good(), password: 'short' })).status).toBe(400);
    expect((await reset(good())).status).toBe(200);
  });
  test('mật khẩu mới > 72 ký tự -> 400', async () => {
    await seed();
    expect((await reset({ ...good(), password: 'a'.repeat(73) })).status).toBe(400);
  });
  test('không thể reset mật khẩu của người khác bằng mã của mình', async () => {
    await seed();
    await User.create({ email: 'victim@x.com', password: hashPw('victimpass1') });
    expect((await reset({ email: 'victim@x.com', code: '123456', password: 'hacked1234' })).status).toBe(400);
  });
});
