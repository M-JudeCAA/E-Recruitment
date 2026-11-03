-- A candidate can turn off notice emails (Candidate.emailNotifications;
-- in-app notices continue), and a flagged employment discrepancy is
-- reminded daily for up to seven days (InternalProfile.discrepancyReminders
-- and discrepancyRemindedAt).

-- AlterTable
ALTER TABLE `Candidate` ADD COLUMN `emailNotifications` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `emailNotificationsChangedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `InternalProfile` ADD COLUMN `discrepancyReminders` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `discrepancyRemindedAt` DATETIME(3) NULL;
