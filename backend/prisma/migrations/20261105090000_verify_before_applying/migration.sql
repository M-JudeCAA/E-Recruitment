-- Internal candidates apply only once HR has verified their UCAA employment
-- details (applicationDraftController.submit, internalVerificationService):
-- when the details were last changed, and the candidate's notices about
-- HR's check.

-- AlterTable
ALTER TABLE `InternalProfile` ADD COLUMN `detailsUpdatedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `CandidateNotification` MODIFY `type` ENUM('ProfileCompleted', 'ApplicationSubmitted', 'ApplicationShortlisted', 'ApplicationRejected', 'InterviewScheduled', 'OfferReceived', 'OfferWithdrawn', 'InterviewRescheduled', 'InterviewCancelled', 'InterviewReminder', 'OfferExpiring', 'OfferExpired', 'DataRequestRefused', 'ApplicationReinstated', 'RecruitmentDiscontinued', 'EmploymentVerified', 'EmploymentDiscrepancy') NOT NULL;
