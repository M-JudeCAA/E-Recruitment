-- A vacancy is created only from an uploaded, EXCO-approved and signed
-- requisition: the document, its hash (one document opens one vacancy) and
-- a snapshot of the job details read from it. Plus the requisition's
-- "Desirable" person-specification items as advert text.

ALTER TABLE `Vacancy`
    ADD COLUMN `desirableQualifications` JSON NULL,
    ADD COLUMN `requisitionDocumentUrl` VARCHAR(191) NULL,
    ADD COLUMN `requisitionDocumentName` VARCHAR(191) NULL,
    ADD COLUMN `requisitionDocumentHash` VARCHAR(64) NULL,
    ADD COLUMN `requisitionUploadedAt` DATETIME(3) NULL,
    ADD COLUMN `requisitionUploadedById` INTEGER NULL,
    ADD COLUMN `requisitionDetails` JSON NULL;

CREATE UNIQUE INDEX `Vacancy_requisitionDocumentHash_key` ON `Vacancy`(`requisitionDocumentHash`);
