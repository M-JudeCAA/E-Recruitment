# End-to-end tests

The real API (`src/app.js`) against a real MySQL database, with no mocks.
The unit tests in `tests/` mock Prisma and can't catch problems that only a
database shows: row locking, unique-key races, queries that no longer match
the schema.

## Running

```bash
mysql -u root -p -e "CREATE DATABASE erecruitment_test"
DATABASE_URL_TEST="mysql://user:password@localhost:3306/erecruitment_test" npm run test:e2e
```

- **Destructive.** Every test empties every table. The suite refuses to run
  unless the database name contains `test` (`testDatabaseUrl.js`).
- **Schema.** `globalSetup.js` rebuilds the database from `schema.prisma`
  with `prisma db push --force-reset`. It does not replay the migration
  history, which can't currently build a database from scratch (see the
  READMEs in `prisma/migrations/`).
- **Settings.** `setupEnv.js` points the app at the test database and sets
  `SMTP_HOST=json`, so no email is ever sent.
- **Serial.** `--runInBand`: the files share one database.

## What's covered

| File | Covers |
|---|---|
| `recruitmentFlow.e2e.test.js` | Vacancy creation to accepted hire through the API; vacancy visibility; offer self-approval; decline notices |
| `offerConcurrency.e2e.test.js` | Simultaneous acceptances for one-position vacancies (fails without the vacancy row lock); flagging and withdrawing stranded offers |
| `systemHealth.e2e.test.js` | Every maintenance job against the real schema; staff warnings and Director alerts; sign-in rate limits |

`helpers.js` has the shared setup: staff, organisation and candidate
factories, sign-in helpers, and `api(token)` for authenticated requests.
