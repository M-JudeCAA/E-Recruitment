-- AlterTable
ALTER TABLE `Vacancy` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` INTEGER NULL,
    ADD COLUMN `rejectionReason` VARCHAR(191) NULL,
    MODIFY `status` ENUM('PendingApproval', 'Open', 'PartiallyFilled', 'Filled', 'Closed', 'Rejected') NOT NULL DEFAULT 'PendingApproval';

-- AddForeignKey
ALTER TABLE `Vacancy` ADD CONSTRAINT `Vacancy_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
