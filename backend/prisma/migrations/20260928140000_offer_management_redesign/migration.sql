-- Offer management redesign: offer terms (salary, start date, contract,
-- conditions, response window), the Returned and Expired states, return /
-- decline / withdrawal reasons, and snapshots of the candidate's merit
-- position. Every new column is nullable or has a default, so existing
-- offers stay valid (they have no response deadline, so never expire).

ALTER TABLE `Offer`
    MODIFY `status` ENUM('Recommended', 'Returned', 'Approved', 'Extended', 'Accepted', 'Declined', 'Expired', 'Withdrawn') NOT NULL DEFAULT 'Recommended',
    ADD COLUMN `salaryAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `salaryCurrency` VARCHAR(191) NOT NULL DEFAULT 'UGX',
    ADD COLUMN `salaryPeriod` VARCHAR(191) NULL,
    ADD COLUMN `allowances` TEXT NULL,
    ADD COLUMN `employmentCategory` ENUM('FullTime', 'Contract', 'FixedTermContract') NULL,
    ADD COLUMN `contractMonths` INTEGER NULL,
    ADD COLUMN `startDate` DATETIME(3) NULL,
    ADD COLUMN `dutyStation` VARCHAR(191) NULL,
    ADD COLUMN `conditions` JSON NULL,
    ADD COLUMN `responseDays` INTEGER NOT NULL DEFAULT 14,
    ADD COLUMN `responseDeadline` DATETIME(3) NULL,
    ADD COLUMN `responseReminderSentAt` DATETIME(3) NULL,
    ADD COLUMN `meritRankAtOffer` INTEGER NULL,
    ADD COLUMN `interviewScoreAtOffer` DOUBLE NULL,
    ADD COLUMN `returnedAt` DATETIME(3) NULL,
    ADD COLUMN `returnedById` INTEGER NULL,
    ADD COLUMN `returnReason` TEXT NULL,
    ADD COLUMN `declineReason` TEXT NULL,
    ADD COLUMN `withdrawnById` INTEGER NULL,
    ADD COLUMN `withdrawalReason` TEXT NULL;

ALTER TABLE `Offer` ADD CONSTRAINT `Offer_returnedById_fkey` FOREIGN KEY (`returnedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Offer` ADD CONSTRAINT `Offer_withdrawnById_fkey` FOREIGN KEY (`withdrawnById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- New SlaTaskType values (OfferReturned, OfferExpired).
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired') NOT NULL;
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired') NOT NULL;
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired') NOT NULL;

-- New CandidateNotificationType values (OfferExpiring, OfferExpired).
ALTER TABLE `CandidateNotification` MODIFY `type` ENUM('ProfileCompleted', 'ApplicationSubmitted', 'ApplicationShortlisted', 'ApplicationRejected', 'InterviewScheduled', 'OfferReceived', 'OfferWithdrawn', 'InterviewRescheduled', 'InterviewCancelled', 'InterviewReminder', 'OfferExpiring', 'OfferExpired') NOT NULL;
