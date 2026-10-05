-- Staff and internal candidates sign in with their UCAA Microsoft (Entra
-- ID) account. Staff no longer have passwords (only a system
-- administrator's break-glass account may), a system administrator manages
-- staff accounts, and an account can be deactivated.

ALTER TABLE `StaffUser`
    ADD COLUMN `entraObjectId` VARCHAR(191) NULL,
    MODIFY `passwordHash` VARCHAR(191) NULL,
    MODIFY `role` ENUM('HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director') NULL,
    ADD COLUMN `isSystemAdmin` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `active` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `lastLoginAt` DATETIME(3) NULL;
CREATE UNIQUE INDEX `StaffUser_entraObjectId_key` ON `StaffUser`(`entraObjectId`);

-- Staff passwords are gone: none of the existing hashes may keep working.
UPDATE `StaffUser` SET `passwordHash` = NULL;

ALTER TABLE `Candidate`
    ADD COLUMN `entraObjectId` VARCHAR(191) NULL,
    MODIFY `passwordHash` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Candidate_entraObjectId_key` ON `Candidate`(`entraObjectId`);

-- A staff member applied for a vacancy (conflictOfInterestService).
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;
