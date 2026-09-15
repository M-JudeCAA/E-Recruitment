-- AlterTable
ALTER TABLE `Application` ADD COLUMN `rejectedAt` DATETIME(3) NULL,
    ADD COLUMN `rejectedById` INTEGER NULL,
    ADD COLUMN `rejectionReason` TEXT NULL;

-- AlterTable
ALTER TABLE `CandidateNotification` MODIFY `type` ENUM('ProfileCompleted', 'ApplicationSubmitted', 'ApplicationShortlisted', 'ApplicationRejected', 'InterviewScheduled', 'OfferReceived') NOT NULL;

-- AlterTable
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted') NOT NULL;

-- AlterTable
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted') NOT NULL;

-- AlterTable
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted') NOT NULL;

-- AddForeignKey
ALTER TABLE `Application` ADD CONSTRAINT `Application_rejectedById_fkey` FOREIGN KEY (`rejectedById`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
