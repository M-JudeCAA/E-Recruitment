-- Shortlisting committee: a committee outside HR rates every screened
-- applicant against the job's requirements; the system ranks the pool from
-- how the raters agree, and the interview shortlist is taken from the top.

ALTER TABLE `Application`
    ADD COLUMN `committeeRank` INTEGER NULL,
    ADD COLUMN `committeeBand` ENUM('Unanimous', 'Majority', 'Disputed', 'NotQualified') NULL,
    ADD COLUMN `committeeScore` DOUBLE NULL,
    ADD COLUMN `committeeAgreement` DOUBLE NULL;

CREATE TABLE `ShortlistExercise` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vacancyId` INTEGER NOT NULL,
    `status` ENUM('Setup', 'Rating', 'Moderation', 'Closed') NOT NULL DEFAULT 'Setup',
    `criteria` JSON NOT NULL,
    `ratersPerApplicant` INTEGER NOT NULL DEFAULT 3,
    `calibrationCount` INTEGER NOT NULL DEFAULT 10,
    `ratingDeadline` DATETIME(3) NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ratingOpenedAt` DATETIME(3) NULL,
    `ratingOpenedById` INTEGER NULL,
    `moderationStartedAt` DATETIME(3) NULL,
    `moderationStartedById` INTEGER NULL,
    `closedAt` DATETIME(3) NULL,
    `closedById` INTEGER NULL,

    UNIQUE INDEX `ShortlistExercise_vacancyId_key`(`vacancyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShortlistMember` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `exerciseId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `isChair` BOOLEAN NOT NULL DEFAULT false,
    `token` VARCHAR(191) NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShortlistMember_token_key`(`token`),
    UNIQUE INDEX `ShortlistMember_exerciseId_email_key`(`exerciseId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShortlistAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `memberId` INTEGER NOT NULL,
    `applicationId` INTEGER NOT NULL,
    `calibration` BOOLEAN NOT NULL DEFAULT false,
    `conflictAt` DATETIME(3) NULL,
    `conflictReason` TEXT NULL,

    INDEX `ShortlistAssignment_applicationId_idx`(`applicationId`),
    UNIQUE INDEX `ShortlistAssignment_memberId_applicationId_key`(`memberId`, `applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShortlistRating` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assignmentId` INTEGER NOT NULL,
    `criterionId` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,
    `comment` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ShortlistRating_assignmentId_criterionId_key`(`assignmentId`, `criterionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShortlistDecision` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `exerciseId` INTEGER NOT NULL,
    `applicationId` INTEGER NOT NULL,
    `criterionId` VARCHAR(191) NOT NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `decidedByMemberId` INTEGER NULL,
    `decidedByName` VARCHAR(191) NOT NULL,
    `decidedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShortlistDecision_exerciseId_applicationId_criterionId_key`(`exerciseId`, `applicationId`, `criterionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ShortlistExercise` ADD CONSTRAINT `ShortlistExercise_vacancyId_fkey` FOREIGN KEY (`vacancyId`) REFERENCES `Vacancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShortlistMember` ADD CONSTRAINT `ShortlistMember_exerciseId_fkey` FOREIGN KEY (`exerciseId`) REFERENCES `ShortlistExercise`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ShortlistAssignment` ADD CONSTRAINT `ShortlistAssignment_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `ShortlistMember`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ShortlistAssignment` ADD CONSTRAINT `ShortlistAssignment_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShortlistRating` ADD CONSTRAINT `ShortlistRating_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `ShortlistAssignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ShortlistDecision` ADD CONSTRAINT `ShortlistDecision_exerciseId_fkey` FOREIGN KEY (`exerciseId`) REFERENCES `ShortlistExercise`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
