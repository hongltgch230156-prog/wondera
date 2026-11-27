// Cho phép hook/test chạy lâu hơn mặc định 5 giây (kết nối DB lần đầu trên Windows khá chậm)
jest.setTimeout(60000);

// Chặn mọi cuộc gọi mạng thật: test nào cần fetch phải tự giả lập. Quên giả lập => test đỏ rõ ràng thay vì gọi API thật tốn tiền.
beforeEach(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error('Unexpected real network call in test (hãy mock global.fetch)')));
});