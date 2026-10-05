-- Mark as Hired: one onboarding case per accepted offer, handed to the HRIS
-- (FR-ATS-067 to 069); and the approved headcount on positions (FR-ATS-006).
-- AlterTable
ALTER TABLE `Position` ADD COLUMN `headcount` INTEGER NULL,
    ADD COLUMN `headcountUpdatedAt` DATETIME(3) NULL,
    ADD COLUMN `headcountUpdatedById` INTEGER NULL,
    ADD COLUMN `occupied` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `Hire` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `applicationId` INTEGER NOT NULL,
    `offerId` INTEGER NOT NULL,
    `vacancyId` INTEGER NOT NULL,
    `candidateId` INTEGER NOT NULL,
    `positionId` INTEGER NULL,
    `caseRef` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NULL,
    `signedInstrumentUrl` VARCHAR(191) NOT NULL,
    `signedInstrumentName` VARCHAR(191) NOT NULL,
    `package` JSON NOT NULL,
    `handoffStatus` ENUM('NotConfigured', 'Pending', 'Sent', 'Failed') NOT NULL DEFAULT 'NotConfigured',
    `handoffAttempts` INTEGER NOT NULL DEFAULT 0,
    `handoffLastError` TEXT NULL,
    `handoffLastAttemptAt` DATETIME(3) NULL,
    `handoffSentAt` DATETIME(3) NULL,
    `onboardingCaseId` VARCHAR(191) NULL,
    `hiredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `hiredById` INTEGER NOT NULL,

    UNIQUE INDEX `Hire_applicationId_key`(`applicationId`),
    UNIQUE INDEX `Hire_offerId_key`(`offerId`),
    UNIQUE INDEX `Hire_caseRef_key`(`caseRef`),
    INDEX `Hire_vacancyId_idx`(`vacancyId`),
    INDEX `Hire_handoffStatus_idx`(`handoffStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Hire` ADD CONSTRAINT `Hire_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Hire` ADD CONSTRAINT `Hire_offerId_fkey` FOREIGN KEY (`offerId`) REFERENCES `Offer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Hire` ADD CONSTRAINT `Hire_vacancyId_fkey` FOREIGN KEY (`vacancyId`) REFERENCES `Vacancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Hire` ADD CONSTRAINT `Hire_hiredById_fkey` FOREIGN KEY (`hiredById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

