-- Interviews are scored on paper, outside the system: HR records the panel's
-- overall score, verdict and signed score sheet per round. This removes the
-- in-app scoring - panelists' scoring links (single and per-day), the
-- run-the-session rows, rubrics and per-panelist scores - and adds the
-- results fields. InterviewRound.score and .recommendation are kept as they
-- were, so rounds already finalized keep their result. Per-panelist scores
-- of earlier rounds are dropped with their columns.
-- DropForeignKey
ALTER TABLE `InterviewDay` DROP FOREIGN KEY `InterviewDay_vacancyId_fkey`;

-- DropForeignKey
ALTER TABLE `PanelAccessToken` DROP FOREIGN KEY `PanelAccessToken_panelMemberId_fkey`;

-- DropForeignKey
ALTER TABLE `PanelDayLink` DROP FOREIGN KEY `PanelDayLink_vacancyId_fkey`;

-- DropForeignKey
ALTER TABLE `PanelMember` DROP FOREIGN KEY `PanelMember_recordedById_fkey`;

-- AlterTable
ALTER TABLE `InterviewRound` DROP COLUMN `calledInAt`,
    DROP COLUMN `calledInById`,
    DROP COLUMN `criteria`,
    DROP COLUMN `scoreNudgeSentAt`,
    ADD COLUMN `resultNotes` TEXT NULL,
    ADD COLUMN `resultsRecordedAt` DATETIME(3) NULL,
    ADD COLUMN `resultsReminderSentAt` DATETIME(3) NULL,
    ADD COLUMN `scoreSheetName` VARCHAR(191) NULL,
    ADD COLUMN `scoreSheetUrl` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;

-- AlterTable
ALTER TABLE `PanelMember` DROP COLUMN `comments`,
    DROP COLUMN `criterionScores`,
    DROP COLUMN `recordedById`,
    DROP COLUMN `recusalReason`,
    DROP COLUMN `recusedAt`,
    DROP COLUMN `score`,
    DROP COLUMN `selfSubmitted`,
    DROP COLUMN `submittedAt`;

-- AlterTable
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;

-- AlterTable
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'InterviewResultsOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted', 'VacancyReturned', 'VacancyRejected', 'StaffApplicantConflict') NOT NULL;

-- DropTable
DROP TABLE `InterviewDay`;

-- DropTable
DROP TABLE `PanelAccessToken`;

-- DropTable
DROP TABLE `PanelDayLink`;

