module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js', '!src/worker.js', '!src/scheduler.js'],
}
