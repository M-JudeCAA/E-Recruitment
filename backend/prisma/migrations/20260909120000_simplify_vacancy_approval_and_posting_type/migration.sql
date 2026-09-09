-- Vacancy approval: 5-tier -> 2-tier, PostingType.Open removed.
--
-- The Senior HR Officer review/check-by gate is gone entirely (not
-- deprecated) - every existing vacancy is confirmed test data, so
-- reviewedAt/reviewedById are dropped outright rather than kept unused.
ALTER TABLE `Vacancy` DROP FOREIGN KEY `Vacancy_reviewedById_fkey`;
ALTER TABLE `Vacancy` DROP COLUMN `reviewedAt`,
                      DROP COLUMN `reviewedById`;

-- approvedByRole snapshots which of Manager/Director actually approved,
-- at the moment they did - same historical-accuracy principle as
-- Vacancy.title, so a later promotion never rewrites the historical
-- record of what role someone held when they acted.
ALTER TABLE `Vacancy` ADD COLUMN `approvedByRole` ENUM('HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director') NULL;

-- Internal <-> External transition support - who changed it, when, what
-- role they held at the time, and what it was before. Every transition
-- is additionally audited via the existing AuditLog table.
ALTER TABLE `Vacancy` ADD COLUMN `postingTypeChangedAt` DATETIME(3) NULL,
                      ADD COLUMN `postingTypeChangedById` INTEGER NULL,
                      ADD COLUMN `postingTypeChangedByRole` ENUM('HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director') NULL,
                      ADD COLUMN `postingTypePreviousValue` ENUM('Internal', 'External') NULL;

ALTER TABLE `Vacancy` ADD CONSTRAINT `Vacancy_postingTypeChangedById_fkey` FOREIGN KEY (`postingTypeChangedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Removing 'Open' from PostingType: every existing vacancy is confirmed
-- test data, so there is no real "which one should this actually be"
-- judgment call here (unlike the free-text Department/education-level
-- migrations earlier in this project) - it simply becomes 'External'.
-- Same widen -> migrate data -> narrow sequence already used for the
-- StaffRole enum migration, since narrowing directly would either
-- reject or truncate any row still holding 'Open'.
UPDATE `Vacancy` SET `postingType` = 'External' WHERE `postingType` = 'Open';

-- Narrow to the final two values and drop the default - postingType is
-- now a required field with no safe "both" fallback to reach for; HR
-- must choose Internal or External explicitly at creation.
ALTER TABLE `Vacancy` MODIFY COLUMN `postingType` ENUM('Internal', 'External') NOT NULL;
