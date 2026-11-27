const { frontendUrl, backendUrl } = require('../../utils/paymentHelpers');

describe('paymentHelpers', () => {
  let savedF;
  let savedB;
  beforeEach(() => {
    savedF = process.env.FRONTEND_URL;
    savedB = process.env.BACKEND_PUBLIC_URL;
    delete process.env.FRONTEND_URL;
    delete process.env.BACKEND_PUBLIC_URL;
  });
  afterEach(() => {
    if (savedF === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = savedF;
    if (savedB === undefined) delete process.env.BACKEND_PUBLIC_URL; else process.env.BACKEND_PUBLIC_URL = savedB;
  });

  test('frontendUrl mặc định là localhost:5173', () => expect(frontendUrl()).toBe('http://localhost:5173'));
  test('backendUrl mặc định là localhost:3000', () => expect(backendUrl()).toBe('http://localhost:3000'));
  test('frontendUrl đọc từ biến môi trường', () => {
    process.env.FRONTEND_URL = 'https://wondera.app';
    expect(frontendUrl()).toBe('https://wondera.app');
  });
  test('backendUrl đọc từ biến môi trường', () => {
    process.env.BACKEND_PUBLIC_URL = 'https://api.wondera.app';
    expect(backendUrl()).toBe('https://api.wondera.app');
  });
  test('frontendUrl bỏ dấu "/" ở cuối', () => {
    process.env.FRONTEND_URL = 'https://wondera.app/';
    expect(frontendUrl()).toBe('https://wondera.app');
  });
  test('backendUrl bỏ dấu "/" ở cuối', () => {
    process.env.BACKEND_PUBLIC_URL = 'https://api.wondera.app/';
    expect(backendUrl()).toBe('https://api.wondera.app');
  });
  test('chuỗi rỗng quay về mặc định', () => {
    process.env.FRONTEND_URL = '';
    expect(frontendUrl()).toBe('http://localhost:5173');
  });
  test('chỉ bỏ một dấu "/" cuối cùng', () => {
    process.env.FRONTEND_URL = 'https://a.com//';
    expect(frontendUrl()).toBe('https://a.com/');
  });
});
