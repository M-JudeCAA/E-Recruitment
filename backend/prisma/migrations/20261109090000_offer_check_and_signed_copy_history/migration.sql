-- A Manager checks a recommended offer and forwards it to a Director for
-- approval (Offer.checkedById/checkedAt); ApprovalGiven, the notice to
-- whoever asked for an approval that it was given; and the history of
-- replacements of a vacancy's signed requisition copy.

-- AlterTable
ALTER TABLE `Offer` ADD COLUMN `checkedAt` DATETIME(3) NULL,
    ADD COLUMN `checkedById` INTEGER NULL;

-- AlterTable
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'DirectorateApproval', 'PositionApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict', 'ApplicationWithdrawn', 'ShortlistProposed', 'PendingApprovalsDigest', 'StaffGroupSyncFailed', 'ApprovalGiven') NOT NULL;

-- AlterTable
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'DirectorateApproval', 'PositionApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict', 'ApplicationWithdrawn', 'ShortlistProposed', 'PendingApprovalsDigest', 'StaffGroupSyncFailed', 'ApprovalGiven') NOT NULL;

-- AlterTable
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'DirectorateApproval', 'PositionApproval', 'CommitteeNominationSubmitted', 'CommitteeNominationDecided', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'DataErasureRequested', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict', 'ApplicationWithdrawn', 'ShortlistProposed', 'PendingApprovalsDigest', 'StaffGroupSyncFailed', 'ApprovalGiven') NOT NULL;

-- CreateTable
CREATE TABLE `RequisitionSignedCopyChange` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vacancyId` INTEGER NOT NULL,
    `previousUrl` VARCHAR(191) NULL,
    `previousName` VARCHAR(191) NULL,
    `previousHash` VARCHAR(64) NULL,
    `newUrl` VARCHAR(191) NOT NULL,
    `newName` VARCHAR(191) NOT NULL,
    `newHash` VARCHAR(64) NOT NULL,
    `reason` TEXT NULL,
    `afterApproval` BOOLEAN NOT NULL,
    `changedById` INTEGER NOT NULL,
    `changedByRole` ENUM('HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director') NULL,
    `actingAsId` INTEGER NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RequisitionSignedCopyChange_vacancyId_idx`(`vacancyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Offer` ADD CONSTRAINT `Offer_checkedById_fkey` FOREIGN KEY (`checkedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequisitionSignedCopyChange` ADD CONSTRAINT `RequisitionSignedCopyChange_vacancyId_fkey` FOREIGN KEY (`vacancyId`) REFERENCES `Vacancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequisitionSignedCopyChange` ADD CONSTRAINT `RequisitionSignedCopyChange_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

