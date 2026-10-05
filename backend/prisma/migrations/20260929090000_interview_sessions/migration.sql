-- Interview sessions: HR starts and ends each vacancy's interview day, and
-- calls each candidate in; panelists score only called-in candidates.

CREATE TABLE `InterviewDay` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vacancyId` INTEGER NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `startedById` INTEGER NULL,
    `endedAt` DATETIME(3) NULL,
    `endedById` INTEGER NULL,
    `closesAt` DATETIME(3) NULL,
    `notStartedAlertAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InterviewDay_vacancyId_day_key`(`vacancyId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InterviewDay` ADD CONSTRAINT `InterviewDay_vacancyId_fkey` FOREIGN KEY (`vacancyId`) REFERENCES `Vacancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InterviewRound`
    ADD COLUMN `calledInAt` DATETIME(3) NULL,
    ADD COLUMN `calledInById` INTEGER NULL;

-- New SlaTaskType value (InterviewSessionNotStarted).
ALTER TABLE `Notification` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted') NOT NULL;
ALTER TABLE `SlaPolicy` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted') NOT NULL;
ALTER TABLE `TaskEscalation` MODIFY `taskType` ENUM('VacancyApproval', 'DepartmentApproval', 'OfferApproval', 'VacancyDeadlinePassed', 'NewApplicationSubmitted', 'OfferDeclined', 'VacancyFilledWithOpenOffers', 'SystemHealthAlert', 'InterviewRescheduleRequested', 'InterviewReadyToFinalize', 'InterviewScoresOverdue', 'MeritListProposed', 'OfferReturned', 'OfferExpired', 'InterviewSessionNotStarted') NOT NULL;
