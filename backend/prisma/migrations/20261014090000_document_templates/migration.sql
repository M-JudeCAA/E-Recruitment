-- HR's own wording for printed documents (defaults live in
-- config/documentTemplates.js), and when a candidate first viewed an offer.
-- AlterTable
ALTER TABLE `Offer` ADD COLUMN `viewedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `DocumentTemplate` (
    `key` VARCHAR(40) NOT NULL,
    `body` TEXT NOT NULL,
    `updatedById` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DocumentTemplate` ADD CONSTRAINT `DocumentTemplate_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

