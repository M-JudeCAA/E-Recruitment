// Unit tests (tests/), mocked Prisma client - the e2e suite has its own
// config in tests-e2e/.
module.exports = {
  ...require('./jest.esm'),
  testPathIgnorePatterns: ['/node_modules/', '/tests-e2e/']
};
