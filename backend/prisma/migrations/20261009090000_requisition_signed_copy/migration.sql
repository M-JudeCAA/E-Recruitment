-- The scan of the requisition as EXCO signed it, uploaded alongside the
-- readable document a vacancy is created from (required for new vacancies;
-- existing ones keep none), and the same for vacancy drafts.
-- AlterTable
ALTER TABLE `Vacancy` ADD COLUMN `requisitionSignedCopyName` VARCHAR(191) NULL,
    ADD COLUMN `requisitionSignedCopyUrl` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `VacancyDraft` ADD COLUMN `signedCopy` JSON NULL,
    ADD COLUMN `signedCopyFilename` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `VacancyDraft_signedCopyFilename_idx` ON `VacancyDraft`(`signedCopyFilename`);

