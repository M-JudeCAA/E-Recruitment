-- EXCO approves the interview shortlist outside the system; HR attaches
-- the signed copy, which records the approval on each application it
-- covers. A first interview needs it.
-- AlterTable
ALTER TABLE `Application` ADD COLUMN `excoApprovalId` INTEGER NULL;

-- CreateTable
CREATE TABLE `ExcoShortlistApproval` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vacancyId` INTEGER NOT NULL,
    `documentUrl` VARCHAR(191) NOT NULL,
    `documentName` VARCHAR(191) NOT NULL,
    `documentHash` VARCHAR(64) NOT NULL,
    `excoReference` VARCHAR(191) NULL,
    `approvedOn` DATETIME(3) NULL,
    `struckOff` JSON NULL,
    `uploadedById` INTEGER NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExcoShortlistApproval_vacancyId_idx`(`vacancyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Application` ADD CONSTRAINT `Application_excoApprovalId_fkey` FOREIGN KEY (`excoApprovalId`) REFERENCES `ExcoShortlistApproval`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExcoShortlistApproval` ADD CONSTRAINT `ExcoShortlistApproval_vacancyId_fkey` FOREIGN KEY (`vacancyId`) REFERENCES `Vacancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExcoShortlistApproval` ADD CONSTRAINT `ExcoShortlistApproval_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

