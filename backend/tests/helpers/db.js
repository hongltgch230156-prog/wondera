// Tiện ích dùng chung cho test integration: kết nối DB, dọn DB, tạo user + token
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Order = require('../../models/Order');
const Transaction = require('../../models/Transaction');
const Creation = require('../../models/Creation');

async function connectDb() {
  const uri = process.env.__TEST_MONGO_URI__;
  if (!uri) throw new Error('Thiếu __TEST_MONGO_URI__: hãy chạy bằng `npm run test:integration` (jest project integration)');
  await mongoose.connect(uri, { dbName: `wondera_test_${crypto.randomBytes(4).toString('hex')}` });
  // tạo index (unique, partial...) để các test về trùng lặp / race hoạt động đúng
  await Promise.all([User, Order, Transaction, Creation].map((m) => m.init()));
}

async function clearDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

async function disconnectDb() {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

let counter = 0;
const signToken = (id, opts = { expiresIn: '7d' }, secret = process.env.JWT_SECRET) => jwt.sign({ id: String(id) }, secret, opts);

/** Tạo user trực tiếp trong DB (không qua bcrypt chậm) và trả về { user, token, auth } */
async function makeUser(fields = {}) {
  counter += 1;
  const user = await User.create({ email: `user${counter}-${Date.now()}@test.dev`, name: `User ${counter}`, ...fields });
  const token = signToken(user._id);
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

const oid = () => new mongoose.Types.ObjectId();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi điều kiện đúng (dùng cho các việc server chạy nền, không chặn phản hồi) */
async function waitFor(fn, { timeout = 3000, step = 25 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('waitFor: hết thời gian chờ');
    await sleep(step);
  }
}

module.exports = { connectDb, clearDb, disconnectDb, makeUser, signToken, oid, sleep, waitFor };
