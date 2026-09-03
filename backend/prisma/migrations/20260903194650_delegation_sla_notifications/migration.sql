-- AlterTable
ALTER TABLE `Offer` ADD COLUMN `recommendedDate` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `Delegation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `delegatorId` INTEGER NOT NULL,
    `delegateId` INTEGER NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `authorizedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DelegationUsage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `delegationId` INTEGER NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `usedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SlaPolicy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval') NOT NULL,
    `tier` ENUM('HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director') NOT NULL,
    `durationHours` INTEGER NOT NULL,

    UNIQUE INDEX `SlaPolicy_taskType_tier_key`(`taskType`, `tier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskEscalation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval') NOT NULL,
    `taskId` INTEGER NOT NULL,
    `currentTier` ENUM('HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director') NOT NULL,
    `escalatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recipientId` INTEGER NOT NULL,
    `channel` ENUM('InApp', 'Email') NOT NULL,
    `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval') NOT NULL,
    `taskId` INTEGER NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Delegation` ADD CONSTRAINT `Delegation_delegatorId_fkey` FOREIGN KEY (`delegatorId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Delegation` ADD CONSTRAINT `Delegation_delegateId_fkey` FOREIGN KEY (`delegateId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Delegation` ADD CONSTRAINT `Delegation_authorizedById_fkey` FOREIGN KEY (`authorizedById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DelegationUsage` ADD CONSTRAINT `DelegationUsage_delegationId_fkey` FOREIGN KEY (`delegationId`) REFERENCES `Delegation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
