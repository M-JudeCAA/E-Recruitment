-- "Submit when verified": an Internal candidate still waiting for HR to
-- verify their UCAA employment can queue an application to be submitted by
-- itself once they are (Application.submitWhenVerifiedAt), and is told if a
-- queued application then could not be submitted.

-- AlterTable
ALTER TABLE `Application` ADD COLUMN `submitWhenVerifiedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `CandidateNotification` MODIFY `type` ENUM('ProfileCompleted', 'ApplicationSubmitted', 'ApplicationShortlisted', 'ApplicationRejected', 'InterviewScheduled', 'OfferReceived', 'OfferWithdrawn', 'InterviewRescheduled', 'InterviewCancelled', 'InterviewReminder', 'OfferExpiring', 'OfferExpired', 'DataRequestRefused', 'ApplicationReinstated', 'RecruitmentDiscontinued', 'EmploymentVerified', 'EmploymentDiscrepancy', 'QueuedApplicationNotSubmitted') NOT NULL;
