import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,           // dùng describe/test/expect/vi không cần import
    environment: 'jsdom',    // có sẵn window, document, localStorage
    include: ['tests/**/*.test.js'],
    restoreMocks: true,
    coverage: { provider: 'v8', include: ['src/components/**/*.js'], reporter: ['text', 'html'] },
  },
});
