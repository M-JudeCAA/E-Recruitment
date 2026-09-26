// End-to-end tests: the real Express app (src/app.js) against a real MySQL
// database, no mocks. Run with `npm run test:e2e` - see tests-e2e/README.md.
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests-e2e/**/*.e2e.test.js'],
  globalSetup: '<rootDir>/tests-e2e/globalSetup.js',
  setupFiles: ['<rootDir>/tests-e2e/setupEnv.js'],
  testTimeout: 60000
};
