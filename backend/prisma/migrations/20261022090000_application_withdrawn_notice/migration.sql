-- HR is told when a candidate withdraws a submitted application
-- (SlaTaskType.ApplicationWithdrawn).
-- AlterTable
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict', 'ApplicationWithdrawn') NOT NULL;

-- AlterTable
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict', 'ApplicationWithdrawn') NOT NULL;

-- AlterTable
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict', 'ApplicationWithdrawn') NOT NULL;
