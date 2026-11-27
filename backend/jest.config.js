// Jest cho backend. Hai "project": unit (không cần DB) và integration (cần MongoDB giả lập).
const common = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/afterEnv.js'],
  testTimeout: 30000,
  clearMocks: true,
};

module.exports = {
  projects: [
    { ...common, displayName: 'unit', testMatch: ['<rootDir>/tests/unit/**/*.test.js'] },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      globalSetup: '<rootDir>/tests/setup/globalSetup.js',
      globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
    },
  ],
  collectCoverageFrom: [
    'config/**/*.js', 'middleware/**/*.js', 'models/**/*.js', 'routes/**/*.js', 'utils/**/*.js', 'server.js',
  ],
};
