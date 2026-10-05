-- Return-for-revision and resubmission of a vacancy awaiting approval, and
-- a mandatory reason on rejecting or closing one (FR-ATS-009, FR-ATS-027).

ALTER TABLE `Vacancy`
    MODIFY `status` ENUM('PendingApproval', 'Open', 'PartiallyFilled', 'Filled', 'Closed', 'Rejected', 'Returned') NOT NULL DEFAULT 'PendingApproval',
    ADD COLUMN `rejectedAt` DATETIME(3) NULL,
    ADD COLUMN `returnedAt` DATETIME(3) NULL,
    ADD COLUMN `returnReason` TEXT NULL,
    ADD COLUMN `approvalRequestedAt` DATETIME(3) NULL,
    ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `closeReason` TEXT NULL;

-- Notices to a vacancy's creator when it is returned or rejected.
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'VacancyReturned', 'VacancyRejected') NOT NULL;
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'VacancyReturned', 'VacancyRejected') NOT NULL;
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'VacancyReturned', 'VacancyRejected') NOT NULL;
