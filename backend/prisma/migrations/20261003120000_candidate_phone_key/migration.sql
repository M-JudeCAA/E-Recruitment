-- FR-ATS-037: a candidate's phone number reduced to its last nine digits,
-- so one person registering a second account with the same phone is caught.
-- Backfilled for existing candidates (same rule as utils/phoneKey.js).

ALTER TABLE `Candidate` ADD COLUMN `phoneKey` VARCHAR(9) NULL;
CREATE INDEX `Candidate_phoneKey_idx` ON `Candidate`(`phoneKey`);

UPDATE `Candidate`
SET `phoneKey` = RIGHT(REGEXP_REPLACE(`phone`, '[^0-9]', ''), 9)
WHERE `phone` IS NOT NULL AND CHAR_LENGTH(REGEXP_REPLACE(`phone`, '[^0-9]', '')) >= 9;
