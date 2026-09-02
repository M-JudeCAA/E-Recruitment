-- AlterTable
ALTER TABLE `PendingCandidateRegistration` ADD COLUMN `codeAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `verificationCode` VARCHAR(191) NULL,
    MODIFY `token` VARCHAR(191) NULL;
