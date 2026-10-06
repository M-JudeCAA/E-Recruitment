-- Shortlisting committee nominations go to the DHRA for approval (FR-ATS-046),
-- and members' access can end on a set date (FR-ATS-048).
-- AlterTable
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;

-- AlterTable
ALTER TABLE `ShortlistExercise` ADD COLUMN `accessExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `nominationDecidedAt` DATETIME(3) NULL,
    ADD COLUMN `nominationDecidedById` INTEGER NULL,
    ADD COLUMN `nominationReturnReason` TEXT NULL,
    ADD COLUMN `nominationStatus` ENUM('Draft', 'Submitted', 'Approved', 'Returned') NOT NULL DEFAULT 'Draft',
    ADD COLUMN `nominationSubmittedAt` DATETIME(3) NULL,
    ADD COLUMN `nominationSubmittedById` INTEGER NULL;

-- AlterTable
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;

-- AlterTable
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;


-- Committees already past Setup went ahead before this approval existed.
UPDATE `ShortlistExercise` SET `nominationStatus` = 'Approved', `nominationDecidedAt` = `ratingOpenedAt` WHERE `status` <> 'Setup';
