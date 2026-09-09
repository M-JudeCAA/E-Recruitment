-- AlterTable
ALTER TABLE `Application` ADD COLUMN `desirableResponses` JSON NULL;

-- AlterTable
ALTER TABLE `Vacancy` ADD COLUMN `accountabilities` JSON NULL,
    ADD COLUMN `desirableRequirements` JSON NULL,
    ADD COLUMN `essentialRequirements` JSON NULL,
    ADD COLUMN `generalKnowledge` JSON NULL,
    ADD COLUMN `jobPurpose` TEXT NULL,
    ADD COLUMN `specialSkills` JSON NULL;

