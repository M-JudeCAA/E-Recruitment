-- Widen StaffRole first so both old and new values are valid simultaneously,
-- migrate the data, then narrow to the final 5-tier set. Doing it in one
-- step would either reject the existing `DHRA_Manager_HR` rows or silently
-- truncate them.
ALTER TABLE `StaffUser` MODIFY COLUMN `role` ENUM('HR_Officer', 'Principal_HR_Officer', 'DHRA_Manager_HR', 'Senior_HR_Officer', 'Manager', 'Director') NOT NULL;

UPDATE `StaffUser` SET `role` = 'Director' WHERE `role` = 'DHRA_Manager_HR';

ALTER TABLE `StaffUser` MODIFY COLUMN `role` ENUM('HR_Officer', 'Senior_HR_Officer', 'Principal_HR_Officer', 'Manager', 'Director') NOT NULL;

-- AlterTable
ALTER TABLE `Directorate` ADD COLUMN `directorName` VARCHAR(191) NULL,
    ADD COLUMN `directorEmail` VARCHAR(191) NULL;
