-- A vacancy deadline is a whole day in APP_TIMEZONE (Africa/Kampala, UTC+3,
-- no daylight saving): applications close at the end of it. Deadlines were
-- stored as UTC midnight of the day, which closed applications at 03:00
-- Kampala time on the deadline day. They are now stored as the last
-- millisecond of the day there (vacancyValidation.parseDeadline), 20:59:59.999
-- UTC. This moves the deadlines still to come, today's included, to match;
-- deadlines of earlier days are history and stay as they were.
UPDATE `Vacancy`
SET `deadline` = TIMESTAMP(DATE(`deadline`), '20:59:59.999')
WHERE `deadline` IS NOT NULL
  AND `deadline` = TIMESTAMP(DATE(`deadline`))
  AND DATE(`deadline`) >= UTC_DATE();
