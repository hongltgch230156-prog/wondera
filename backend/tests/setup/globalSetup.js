// Khởi động MỘT MongoDB giả lập cho cả lần chạy integration (mỗi file test dùng database riêng).
// Muốn dùng Mongo có sẵn (ví dụ service container trên CI): đặt MONGO_TEST_URI=mongodb://localhost:27017
module.exports = async () => {
  if (process.env.MONGO_TEST_URI) {
    process.env.__TEST_MONGO_URI__ = process.env.MONGO_TEST_URI;
    return;
  }
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },          // ép dùng MongoDB 7.0 ổn định
    instance: { launchTimeout: 120000 },    // máy chậm thì chờ tối đa 2 phút
  });
  global.__MONGOD__ = mongod;
  process.env.__TEST_MONGO_URI__ = mongod.getUri();
};