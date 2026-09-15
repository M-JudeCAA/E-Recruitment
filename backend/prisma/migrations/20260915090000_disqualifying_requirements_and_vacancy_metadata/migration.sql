-- AlterTable
ALTER TABLE `Application` ADD COLUMN `disqualifyingResponses` JSON NULL;

-- AlterTable
ALTER TABLE `Vacancy` ADD COLUMN `disqualifyingRequirements` JSON NULL,
    ADD COLUMN `employmentCategory` ENUM('FullTime', 'Contract', 'FixedTermContract') NULL,
    ADD COLUMN `internalSalaryRange` VARCHAR(191) NULL,
    ADD COLUMN `location` VARCHAR(191) NULL,
    ADD COLUMN `recruiterNotes` TEXT NULL;

