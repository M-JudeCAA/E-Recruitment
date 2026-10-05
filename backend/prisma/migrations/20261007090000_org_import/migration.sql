-- Batch import of the org structure: one row per import, and the departments
-- it proposed point back to it so they can be approved together.
CREATE TABLE `OrgImport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileName` VARCHAR(255) NOT NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `directoratesCreated` INTEGER NOT NULL DEFAULT 0,
    `departmentsProposed` INTEGER NOT NULL DEFAULT 0,
    `positionsCreated` INTEGER NOT NULL DEFAULT 0,
    `rowsSkipped` INTEGER NOT NULL DEFAULT 0,

    INDEX `OrgImport_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrgImport` ADD CONSTRAINT `OrgImport_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Department` ADD COLUMN `importId` INTEGER NULL;

ALTER TABLE `Department` ADD CONSTRAINT `Department_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `OrgImport`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
