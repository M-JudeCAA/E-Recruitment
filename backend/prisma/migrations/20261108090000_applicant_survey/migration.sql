-- The short survey internal candidates are offered after submitting an
-- application (pilot feedback), read by HR and system administrators.
-- CreateTable
CREATE TABLE `ApplicantSurvey` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidateId` INTEGER NOT NULL,
    `applicationId` INTEGER NOT NULL,
    `vacancyTitle` VARCHAR(255) NOT NULL,
    `jobRef` VARCHAR(60) NULL,
    `overallRating` INTEGER NOT NULL,
    `easeRating` INTEGER NOT NULL,
    `clarityRating` INTEGER NOT NULL,
    `timeTaken` VARCHAR(20) NULL,
    `hadProblems` BOOLEAN NOT NULL DEFAULT false,
    `problems` TEXT NULL,
    `suggestions` TEXT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ApplicantSurvey_applicationId_key`(`applicationId`),
    INDEX `ApplicantSurvey_submittedAt_idx`(`submittedAt`),
    INDEX `ApplicantSurvey_candidateId_idx`(`candidateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ApplicantSurvey` ADD CONSTRAINT `ApplicantSurvey_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
