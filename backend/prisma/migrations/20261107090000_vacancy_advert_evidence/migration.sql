-- Evidence that a vacancy was advertised (newspaper scan, job board
-- screenshot, noticeboard scan, HR Pulse email), required to close a
-- vacancy that was published.
-- CreateTable
CREATE TABLE `VacancyAdvertEvidence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vacancyId` INTEGER NOT NULL,
    `fileUrl` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `note` VARCHAR(500) NULL,
    `uploadedById` INTEGER NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VacancyAdvertEvidence_vacancyId_idx`(`vacancyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VacancyAdvertEvidence` ADD CONSTRAINT `VacancyAdvertEvidence_vacancyId_fkey` FOREIGN KEY (`vacancyId`) REFERENCES `Vacancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VacancyAdvertEvidence` ADD CONSTRAINT `VacancyAdvertEvidence_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
