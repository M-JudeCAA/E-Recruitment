-- The vacancy's hiring manager: a UCAA employee picked from the staff
-- directory, kept informed by email. Staff-only.
-- AlterTable
ALTER TABLE `Vacancy` ADD COLUMN `hiringManagerEmail` VARCHAR(191) NULL,
    ADD COLUMN `hiringManagerEntraId` VARCHAR(36) NULL,
    ADD COLUMN `hiringManagerJobTitle` VARCHAR(191) NULL,
    ADD COLUMN `hiringManagerName` VARCHAR(191) NULL;

