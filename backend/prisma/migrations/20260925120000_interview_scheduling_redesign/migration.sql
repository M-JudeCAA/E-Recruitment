-- Interview scheduling redesign: time/duration/venue/rubric/lifecycle on
-- InterviewRound, chair/rubric scores/recusal on PanelMember, and the new
-- notification types. Every new column is nullable or has a default, so
-- existing rows stay valid (existing rounds read as status Scheduled; a
-- round that already has a recommendation is backfilled to Completed).

ALTER TABLE `InterviewRound`
    ADD COLUMN `durationMinutes` INTEGER NULL,
    ADD COLUMN `location` VARCHAR(191) NULL,
    ADD COLUMN `meetingLink` TEXT NULL,
    ADD COLUMN `instructions` TEXT NULL,
    ADD COLUMN `internalNotes` TEXT NULL,
    ADD COLUMN `criteria` JSON NULL,
    ADD COLUMN `sessionKey` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('Scheduled', 'Completed', 'Cancelled', 'NoShow') NOT NULL DEFAULT 'Scheduled',
    ADD COLUMN `candidateResponse` ENUM('Pending', 'Confirmed', 'RescheduleRequested') NOT NULL DEFAULT 'Pending',
    ADD COLUMN `candidateResponseNote` TEXT NULL,
    ADD COLUMN `candidateRespondedAt` DATETIME(3) NULL,
    ADD COLUMN `rescheduleCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancelledById` INTEGER NULL,
    ADD COLUMN `cancellationReason` TEXT NULL,
    ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD COLUMN `reminderSentAt` DATETIME(3) NULL,
    ADD COLUMN `scoreNudgeSentAt` DATETIME(3) NULL,
    ADD COLUMN `scheduledById` INTEGER NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

UPDATE `InterviewRound` SET `status` = 'Completed' WHERE `recommendation` IS NOT NULL;

CREATE INDEX `InterviewRound_scheduledDate_idx` ON `InterviewRound`(`scheduledDate`);
CREATE INDEX `InterviewRound_sessionKey_idx` ON `InterviewRound`(`sessionKey`);

ALTER TABLE `InterviewRound` ADD CONSTRAINT `InterviewRound_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `InterviewRound` ADD CONSTRAINT `InterviewRound_scheduledById_fkey` FOREIGN KEY (`scheduledById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PanelMember`
    ADD COLUMN `isChair` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `criterionScores` JSON NULL,
    ADD COLUMN `recusedAt` DATETIME(3) NULL,
    ADD COLUMN `recusalReason` TEXT NULL;

-- New SlaTaskType values (InterviewRescheduleRequested,
-- InterviewReadyToFinalize, InterviewScoresOverdue) - MODIFY to a superset,
-- on all three columns that use this enum.
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue') NOT NULL;
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue') NOT NULL;
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue') NOT NULL;

-- New CandidateNotificationType values.
ALTER TABLE `CandidateNotification` MODIFY `type` ENUM('ProfileCompleted', 'ApplicationSubmitted', 'ApplicationShortlisted', 'ApplicationRejected', 'InterviewScheduled', 'OfferReceived', 'OfferWithdrawn', 'InterviewRescheduled', 'InterviewCancelled', 'InterviewReminder') NOT NULL;
