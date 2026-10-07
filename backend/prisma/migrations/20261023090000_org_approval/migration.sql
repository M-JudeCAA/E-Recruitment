-- Directorates and positions get the approval step departments already
-- had (services/orgApprovalService.js). Existing rows are Approved.
-- OrgImport.autoApproved records whether the importer approved what it
-- created at once.

-- AlterTable
ALTER TABLE `Directorate` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` INTEGER NULL,
    ADD COLUMN `importId` INTEGER NULL,
    ADD COLUMN `rejectionReason` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Approved';

-- AlterTable
ALTER TABLE `OrgImport` ADD COLUMN `autoApproved` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Position` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` INTEGER NULL,
    ADD COLUMN `importId` INTEGER NULL,
    ADD COLUMN `rejectionReason` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Approved';

-- AddForeignKey
ALTER TABLE `Directorate` ADD CONSTRAINT `Directorate_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Directorate` ADD CONSTRAINT `Directorate_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `OrgImport`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Position` ADD CONSTRAINT `Position_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Position` ADD CONSTRAINT `Position_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `OrgImport`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
