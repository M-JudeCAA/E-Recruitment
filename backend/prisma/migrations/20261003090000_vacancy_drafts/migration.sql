-- Vacancies being written on the New Listing page, saved by hand or
-- automatically before the vacancy is created.

CREATE TABLE `VacancyDraft` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdById` INTEGER NOT NULL,
    `title` VARCHAR(191) NULL,
    `form` JSON NOT NULL,
    `requisition` JSON NULL,
    `requisitionFilename` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VacancyDraft_createdById_idx`(`createdById`),
    INDEX `VacancyDraft_requisitionFilename_idx`(`requisitionFilename`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `VacancyDraft` ADD CONSTRAINT `VacancyDraft_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
