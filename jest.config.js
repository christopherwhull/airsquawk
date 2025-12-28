module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    'server.js',
    '!lib/**/index.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  setupFiles: ['<rootDir>/__tests__/jest.setup.js']
};