// The e2e suite wipes its database before every test, so it only ever runs
// against DATABASE_URL_TEST, and only when that database's name contains
// "test" - it can never be pointed at a development or production database
// by accident.
function testDatabaseUrl() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error('DATABASE_URL_TEST is not set. Point it at an empty MySQL database whose name contains "test" - see tests-e2e/README.md.');
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run e2e tests against database "${dbName}": its name must contain "test", because the tests delete all of its data.`);
  }
  return url;
}

module.exports = { testDatabaseUrl };
