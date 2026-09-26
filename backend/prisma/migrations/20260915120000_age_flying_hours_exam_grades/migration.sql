-- AlterTable
ALTER TABLE `Candidate` ADD COLUMN `dateOfBirth` DATETIME(3) NULL,
    ADD COLUMN `flyingHours` INTEGER NULL;

-- AlterTable
ALTER TABLE `Education` MODIFY `qualificationLevel` ENUM('OLevel', 'ALevel', 'Certificate', 'Diploma', 'Bachelors', 'Postgraduate', 'Masters', 'PhD') NULL;

-- AlterTable
ALTER TABLE `Vacancy` ADD COLUMN `maximumAge` INTEGER NULL,
    ADD COLUMN `minimumAge` INTEGER NULL,
    ADD COLUMN `minimumFlyingHours` INTEGER NULL,
    ADD COLUMN `requiredExamGrades` JSON NULL,
    MODIFY `minimumEducationLevel` ENUM('OLevel', 'ALevel', 'Certificate', 'Diploma', 'Bachelors', 'Postgraduate', 'Masters', 'PhD') NULL;

-- CreateTable
CREATE TABLE `ExamGrade` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidateId` INTEGER NOT NULL,
    `level` ENUM('OLevel', 'ALevel') NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `grade` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ExamGrade` ADD CONSTRAINT `ExamGrade_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

