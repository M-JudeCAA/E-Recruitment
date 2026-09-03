-- Review/check-by gate: a Senior HR Officer+ must check a vacancy before
-- a Principal HR Officer can give final approval. Genuinely new columns
-- this time - confirmed against information_schema.columns before writing
-- this file that no reviewedAt/reviewedById/reviewedBy* columns already
-- existed on the live Vacancy table (unlike approvedAt/approvedById/
-- rejectionReason, which did - see README_vacancy_approval_gate.md).
ALTER TABLE `Vacancy`
  ADD COLUMN `reviewedAt` DATETIME(3) NULL,
  ADD COLUMN `reviewedById` INTEGER NULL;

ALTER TABLE `Vacancy`
  ADD CONSTRAINT `Vacancy_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
