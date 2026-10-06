-- Where a candidate saw the advert, for the Source of Hire report (FR-ATS-070).
-- AlterTable
ALTER TABLE `Application` ADD COLUMN `source` VARCHAR(40) NULL,
    ADD COLUMN `sourceDetail` VARCHAR(200) NULL;

