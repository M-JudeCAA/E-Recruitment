-- A rejection can be undone (applicationReinstatementService): the status
-- the application had when it was rejected is kept so it can go back there.
-- Two candidate notices: the reinstatement, and UCAA ending the recruitment
-- for a vacancy while applications were in progress (vacancyClosureService).

-- AlterTable
ALTER TABLE `Application` ADD COLUMN `statusBeforeRejection` ENUM('Draft', 'Submitted', 'UnderReview', 'ShortlistProposed', 'Shortlisted', 'InterviewScheduled', 'Interviewed', 'Offered', 'Rejected', 'Withdrawn') NULL;

-- AlterTable
ALTER TABLE `CandidateNotification` MODIFY `type` ENUM('ProfileCompleted', 'ApplicationSubmitted', 'ApplicationShortlisted', 'ApplicationRejected', 'InterviewScheduled', 'OfferReceived', 'OfferWithdrawn', 'InterviewRescheduled', 'InterviewCancelled', 'InterviewReminder', 'OfferExpiring', 'OfferExpired', 'DataRequestRefused', 'ApplicationReinstated', 'RecruitmentDiscontinued') NOT NULL;
