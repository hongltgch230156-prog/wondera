// Chạy TRƯỚC mọi file test. Đặt biến môi trường giả để test không bao giờ đụng tới khoá thật.
// Lưu ý: dotenv không ghi đè biến đã tồn tại (kể cả chuỗi rỗng) nên file backend/.env thật sẽ KHÔNG ảnh hưởng test.
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-jwt-secret-please-do-not-use-in-prod',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  FAL_KEY: 'test-fal-key',
  GEMINI_API_KEY: 'test-gemini-key',
  BRAVE_API_KEY: 'test-brave-key',
  MAIL_USER: 'test@example.com',
  MAIL_PASS: 'x',
  MAIL_FROM: 'test@example.com',
  VNPAY_TMN_CODE: 'TESTTMN1',
  VNPAY_HASH_SECRET: 'TEST_VNPAY_SECRET',
  VNPAY_URL: 'https://vnpay.test/vpcpay.html',
  POLAR_SERVER: 'sandbox',
  POLAR_ACCESS_TOKEN: 'polar_test_token',
  POLAR_WEBHOOK_SECRET: 'polar-test-webhook-secret',
  POLAR_PRODUCT_PACK5: 'prod_pack5',
  POLAR_PRODUCT_PACK20: 'prod_pack20',
  POLAR_PRODUCT_PACK50: 'prod_pack50',
  FRONTEND_URL: 'http://frontend.test',
  BACKEND_PUBLIC_URL: 'http://backend.test',
  // Tắt Supabase => storage.js chạy chế độ ổ đĩa (và các test còn mock storage nên không ghi gì thật)
  SUPABASE_URL: '',
  SUPABASE_SERVICE_KEY: '',
  SUPABASE_BUCKET: 'test-bucket',
});
delete process.env.PAYMENT_LIVE;
