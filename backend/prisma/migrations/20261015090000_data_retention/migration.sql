-- Candidate data retention and data-subject requests: settings HR
-- (Manager+) or a system administrator changes, candidates' erasure
-- requests, and a log of every erasure (services/candidatePurgeService.js).
-- AlterTable
ALTER TABLE `Candidate` ADD COLUMN `purgedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `CandidateNotification` MODIFY `type` ENUM('ProfileCompleted', 'ApplicationSubmitted', 'ApplicationShortlisted', 'ApplicationRejected', 'InterviewScheduled', 'OfferReceived', 'OfferWithdrawn', 'InterviewRescheduled', 'InterviewCancelled', 'InterviewReminder', 'OfferExpiring', 'OfferExpired', 'DataRequestRefused') NOT NULL;

-- AlterTable
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;

-- AlterTable
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;

-- AlterTable
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(60) NOT NULL,
    `value` JSON NOT NULL,
    `updatedById` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataSubjectRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidateId` INTEGER NOT NULL,
    `reason` TEXT NULL,
    `status` ENUM('Pending', 'Completed', 'Refused') NOT NULL DEFAULT 'Pending',
    `decidedById` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DataSubjectRequest_status_idx`(`status`),
    INDEX `DataSubjectRequest_candidateId_idx`(`candidateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataPurgeLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidateId` INTEGER NOT NULL,
    `reason` VARCHAR(30) NOT NULL,
    `requestId` INTEGER NULL,
    `performedById` INTEGER NULL,
    `removed` JSON NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DataPurgeLog_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Setting` ADD CONSTRAINT `Setting_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DataSubjectRequest` ADD CONSTRAINT `DataSubjectRequest_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DataSubjectRequest` ADD CONSTRAINT `DataSubjectRequest_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

