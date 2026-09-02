-- CreateTable
CREATE TABLE `StaffUser` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('HR_Officer', 'Principal_HR_Officer', 'DHRA_Manager_HR') NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `actingAsId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StaffUser_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vacancy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `positionsRequired` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('Open', 'PartiallyFilled', 'Filled', 'Closed') NOT NULL DEFAULT 'Open',
    `postingType` ENUM('Internal', 'External', 'Open') NOT NULL DEFAULT 'Open',
    `deadline` DATETIME(3) NULL,
    `regulatoryDriver` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `priority` VARCHAR(191) NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Candidate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fullName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `candidateType` ENUM('Internal', 'External') NOT NULL,
    `nationalId` VARCHAR(191) NULL,
    `emailConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `passwordHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Candidate_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkExperience` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidateId` INTEGER NOT NULL,
    `employer` VARCHAR(191) NOT NULL,
    `jobTitle` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Education` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidateId` INTEGER NOT NULL,
    `institution` VARCHAR(191) NOT NULL,
    `qualificationLevel` VARCHAR(191) NOT NULL,
    `fieldOfStudy` VARCHAR(191) NOT NULL,
    `yearCompleted` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InternalProfile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidateId` INTEGER NOT NULL,
    `employeeId` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `position` VARCHAR(191) NULL,
    `dateJoined` DATETIME(3) NULL,
    `supervisorName` VARCHAR(191) NULL,
    `supervisorEmail` VARCHAR(191) NULL,
    `verificationStatus` ENUM('Pending', 'HR_Verified', 'Discrepancy_Flagged') NOT NULL DEFAULT 'Pending',
    `verificationEvidenceType` ENUM('Comments', 'ManagerRecommendationLetter') NULL,
    `verificationComments` TEXT NULL,
    `supportingDocumentUrl` VARCHAR(191) NULL,
    `verifiedById` INTEGER NULL,
    `verifiedDate` DATETIME(3) NULL,

    UNIQUE INDEX `InternalProfile_candidateId_key`(`candidateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Application` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vacancyId` INTEGER NOT NULL,
    `candidateId` INTEGER NOT NULL,
    `status` ENUM('Draft', 'Submitted', 'UnderReview', 'Shortlisted', 'InterviewScheduled', 'Interviewed', 'Offered', 'Rejected', 'Withdrawn') NOT NULL DEFAULT 'Draft',
    `submittedDate` DATETIME(3) NULL,
    `shortlistScore` DOUBLE NULL,
    `rank` INTEGER NULL,
    `listStatus` ENUM('Primary', 'Reserve') NULL,
    `cvUrl` VARCHAR(191) NULL,
    `coverLetterUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PanelMember` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `interviewRoundId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `trade` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `staffUserId` INTEGER NULL,
    `score` DOUBLE NULL,
    `comments` TEXT NULL,
    `selfSubmitted` BOOLEAN NOT NULL DEFAULT false,
    `recordedById` INTEGER NULL,
    `submittedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PanelAccessToken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `panelMemberId` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PanelAccessToken_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InterviewRound` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `applicationId` INTEGER NOT NULL,
    `roundNumber` INTEGER NOT NULL,
    `scheduledDate` DATETIME(3) NULL,
    `mode` VARCHAR(191) NULL,
    `score` DOUBLE NULL,
    `recommendation` VARCHAR(191) NULL,
    `conductedById` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Offer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `applicationId` INTEGER NOT NULL,
    `status` ENUM('Recommended', 'Approved', 'Extended', 'Accepted', 'Declined', 'Withdrawn') NOT NULL DEFAULT 'Recommended',
    `recommendedById` INTEGER NULL,
    `approvedById` INTEGER NULL,
    `approvedDate` DATETIME(3) NULL,

    UNIQUE INDEX `Offer_applicationId_key`(`applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationToken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `candidateId` INTEGER NULL,
    `staffId` INTEGER NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `VerificationToken_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `performedById` INTEGER NULL,
    `actingAsId` INTEGER NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `payload` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StaffUser` ADD CONSTRAINT `StaffUser_actingAsId_fkey` FOREIGN KEY (`actingAsId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vacancy` ADD CONSTRAINT `Vacancy_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkExperience` ADD CONSTRAINT `WorkExperience_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Education` ADD CONSTRAINT `Education_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalProfile` ADD CONSTRAINT `InternalProfile_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalProfile` ADD CONSTRAINT `InternalProfile_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Application` ADD CONSTRAINT `Application_vacancyId_fkey` FOREIGN KEY (`vacancyId`) REFERENCES `Vacancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Application` ADD CONSTRAINT `Application_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PanelMember` ADD CONSTRAINT `PanelMember_interviewRoundId_fkey` FOREIGN KEY (`interviewRoundId`) REFERENCES `InterviewRound`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PanelMember` ADD CONSTRAINT `PanelMember_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PanelMember` ADD CONSTRAINT `PanelMember_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PanelAccessToken` ADD CONSTRAINT `PanelAccessToken_panelMemberId_fkey` FOREIGN KEY (`panelMemberId`) REFERENCES `PanelMember`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InterviewRound` ADD CONSTRAINT `InterviewRound_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InterviewRound` ADD CONSTRAINT `InterviewRound_conductedById_fkey` FOREIGN KEY (`conductedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Offer` ADD CONSTRAINT `Offer_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Offer` ADD CONSTRAINT `Offer_recommendedById_fkey` FOREIGN KEY (`recommendedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Offer` ADD CONSTRAINT `Offer_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationToken` ADD CONSTRAINT `VerificationToken_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationToken` ADD CONSTRAINT `VerificationToken_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
