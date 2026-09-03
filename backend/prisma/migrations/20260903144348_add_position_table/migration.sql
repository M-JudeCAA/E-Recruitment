-- AlterTable
ALTER TABLE `StaffUser` ADD COLUMN `departmentId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Vacancy` DROP COLUMN `department`,
    ADD COLUMN `departmentId` INTEGER NOT NULL,
    ADD COLUMN `jobRef` VARCHAR(191) NOT NULL,
    ADD COLUMN `positionId` INTEGER NOT NULL,
    ADD COLUMN `reportsToPositionId` INTEGER NULL,
    ADD COLUMN `salaryScale` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Directorate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Directorate_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `directorateId` INTEGER NOT NULL,
    `status` ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
    `createdById` INTEGER NOT NULL,
    `approvedById` INTEGER NULL,
    `approvedAt` DATETIME(3) NULL,
    `rejectionReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Department_name_directorateId_key`(`name`, `directorateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Position` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `level` INTEGER NOT NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Position_name_departmentId_key`(`name`, `departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Vacancy_jobRef_key` ON `Vacancy`(`jobRef`);

-- AddForeignKey
ALTER TABLE `StaffUser` ADD CONSTRAINT `StaffUser_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Directorate` ADD CONSTRAINT `Directorate_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_directorateId_fkey` FOREIGN KEY (`directorateId`) REFERENCES `Directorate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Position` ADD CONSTRAINT `Position_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Position` ADD CONSTRAINT `Position_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vacancy` ADD CONSTRAINT `Vacancy_positionId_fkey` FOREIGN KEY (`positionId`) REFERENCES `Position`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vacancy` ADD CONSTRAINT `Vacancy_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vacancy` ADD CONSTRAINT `Vacancy_reportsToPositionId_fkey` FOREIGN KEY (`reportsToPositionId`) REFERENCES `Position`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
