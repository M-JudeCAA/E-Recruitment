-- FR-ATS-081: who viewed candidate data, and when.

CREATE TABLE `DataAccessLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorType` VARCHAR(20) NOT NULL,
    `staffUserId` INTEGER NULL,
    `actorLabel` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `vacancyId` INTEGER NULL,
    `applicationId` INTEGER NULL,
    `candidateIds` JSON NULL,
    `detail` JSON NULL,
    `ip` VARCHAR(64) NULL,

    INDEX `DataAccessLog_at_idx`(`at`),
    INDEX `DataAccessLog_staffUserId_idx`(`staffUserId`),
    INDEX `DataAccessLog_applicationId_idx`(`applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
