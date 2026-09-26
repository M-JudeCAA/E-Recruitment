-- New SlaTaskType values (OfferDeclined, VacancyFilledWithOpenOffers,
-- SystemHealthAlert). MODIFY to a superset of the existing values keeps
-- every existing row valid, on all three columns that use this enum.
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert') NOT NULL;
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert') NOT NULL;
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert') NOT NULL;

-- New CandidateNotificationType value (OfferWithdrawn).
ALTER TABLE `CandidateNotification` MODIFY `type` ENUM('ProfileCompleted', 'ApplicationSubmitted', 'ApplicationShortlisted', 'ApplicationRejected', 'InterviewScheduled', 'OfferReceived', 'OfferWithdrawn') NOT NULL;

-- CreateTable
CREATE TABLE `SystemHealth` (
    `key` VARCHAR(191) NOT NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastFailureAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
    `alertedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
