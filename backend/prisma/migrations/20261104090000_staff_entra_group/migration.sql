-- Creating a staff account adds the person to the staff app's Entra group,
-- deactivating removes them (services/staffGroupService.js): where each
-- account stands, and a notice to system administrators when it fails.

-- AlterTable
ALTER TABLE `StaffUser` ADD COLUMN `entraGroupState` ENUM('InGroup', 'NotInGroup', 'Failed') NULL,
    ADD COLUMN `entraGroupError` VARCHAR(300) NULL,
    ADD COLUMN `entraGroupCheckedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'DirectorateApproval', 'PositionApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict', 'ApplicationWithdrawn', 'ShortlistProposed', 'PendingApprovalsDigest', 'StaffGroupSyncFailed') NOT NULL;

-- AlterTable
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'DirectorateApproval', 'PositionApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict', 'ApplicationWithdrawn', 'ShortlistProposed', 'PendingApprovalsDigest', 'StaffGroupSyncFailed') NOT NULL;

-- AlterTable
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'DirectorateApproval', 'PositionApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict', 'ApplicationWithdrawn', 'ShortlistProposed', 'PendingApprovalsDigest', 'StaffGroupSyncFailed') NOT NULL;
