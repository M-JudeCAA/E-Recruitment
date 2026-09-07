-- AlterTable
ALTER TABLE `Application` ADD COLUMN `desiredSalary` VARCHAR(191) NULL,
    ADD COLUMN `earliestStartDate` DATETIME(3) NULL,
    ADD COLUMN `openToRelocate` VARCHAR(191) NULL,
    ADD COLUMN `whyThisRole` TEXT NULL;

-- AlterTable
ALTER TABLE `Candidate` ADD COLUMN `linkedinUrl` VARCHAR(191) NULL,
    ADD COLUMN `location` VARCHAR(191) NULL,
    ADD COLUMN `portfolioUrl` VARCHAR(191) NULL,
    ADD COLUMN `workAuthorization` VARCHAR(191) NULL;

