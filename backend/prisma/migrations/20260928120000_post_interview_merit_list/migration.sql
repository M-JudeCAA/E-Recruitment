-- Post-interview merit list: the ranking (Primary/Reserve) that decides who
-- is offered the job now comes from interview results, not from the
-- pre-interview shortlist. Every new column is nullable, so existing rows
-- stay valid; vacancies with offers already in flight keep using the old
-- Application.rank/listStatus for the decline cascade (see
-- workflowService.handleOfferDeclined).

ALTER TABLE `Application`
    ADD COLUMN `meritRank` INTEGER NULL,
    ADD COLUMN `meritListStatus` ENUM('Primary', 'Reserve') NULL,
    ADD COLUMN `meritStatus` ENUM('Proposed', 'Approved') NULL,
    ADD COLUMN `meritProposedAt` DATETIME(3) NULL,
    ADD COLUMN `meritProposedById` INTEGER NULL,
    ADD COLUMN `meritApprovedAt` DATETIME(3) NULL,
    ADD COLUMN `meritApprovedById` INTEGER NULL;

ALTER TABLE `Application` ADD CONSTRAINT `Application_meritProposedById_fkey` FOREIGN KEY (`meritProposedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Application` ADD CONSTRAINT `Application_meritApprovedById_fkey` FOREIGN KEY (`meritApprovedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- New SlaTaskType value (MeritListProposed) - MODIFY to a superset, on all
-- three columns that use this enum.
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed') NOT NULL;
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed') NOT NULL;
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed') NOT NULL;
