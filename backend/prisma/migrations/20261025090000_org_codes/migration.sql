-- Directorates, departments and positions get a short code beside their full
-- name (utils/orgFields.js). Directorates and departments were stored by
-- their short names (DHRA, ARFFS, ...): those become the code, and the names
-- we are sure of are spelled out (the list frontend/src/utils/orgNames.js
-- showed candidates). The rest keep the short name as their name until HR
-- edits it. Positions from before have no code until HR gives them one.

-- AlterTable
ALTER TABLE `Directorate` ADD COLUMN `code` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `Department` ADD COLUMN `code` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `Position` ADD COLUMN `code` VARCHAR(64) NULL;

-- The old short name becomes the code (names are unique case-insensitively
-- within their scope already, so upper-casing them clashes with nothing).
UPDATE `Directorate` SET `code` = UPPER(IF(CHAR_LENGTH(`name`) <= 64, `name`, CONCAT(LEFT(`name`, 50), '-', `id`)));
UPDATE `Department` SET `code` = UPPER(IF(CHAR_LENGTH(`name`) <= 64, `name`, CONCAT(LEFT(`name`, 50), '-', `id`)));

-- Full names we are sure of - skipped where another row already has that name.
UPDATE `Directorate` d LEFT JOIN `Directorate` o ON o.`name` = 'Air Navigation Services' AND o.`id` <> d.`id`
  SET d.`name` = 'Air Navigation Services' WHERE d.`code` = 'DANS' AND o.`id` IS NULL;
UPDATE `Directorate` d LEFT JOIN `Directorate` o ON o.`name` = 'Airports and Aviation Security' AND o.`id` <> d.`id`
  SET d.`name` = 'Airports and Aviation Security' WHERE d.`code` = 'DAAS' AND o.`id` IS NULL;
UPDATE `Directorate` d LEFT JOIN `Directorate` o ON o.`name` = 'Safety, Security and Economic Regulation' AND o.`id` <> d.`id`
  SET d.`name` = 'Safety, Security and Economic Regulation' WHERE d.`code` = 'DSSER' AND o.`id` IS NULL;
UPDATE `Directorate` d LEFT JOIN `Directorate` o ON o.`name` = 'Finance' AND o.`id` <> d.`id`
  SET d.`name` = 'Finance' WHERE d.`code` = 'DF' AND o.`id` IS NULL;
UPDATE `Directorate` d LEFT JOIN `Directorate` o ON o.`name` = 'Human Resource and Administration' AND o.`id` <> d.`id`
  SET d.`name` = 'Human Resource and Administration' WHERE d.`code` = 'DHRA' AND o.`id` IS NULL;

UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Accounts' AND o.`id` <> d.`id`
  SET d.`name` = 'Accounts' WHERE d.`code` = 'ACCOUNTS' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Administration' AND o.`id` <> d.`id`
  SET d.`name` = 'Administration' WHERE d.`code` = 'ADMIN' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Aeronautical Information Management' AND o.`id` <> d.`id`
  SET d.`name` = 'Aeronautical Information Management' WHERE d.`code` = 'AIM' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Aerodrome Rescue and Fire Fighting Services' AND o.`id` <> d.`id`
  SET d.`name` = 'Aerodrome Rescue and Fire Fighting Services' WHERE d.`code` = 'ARFFS' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Air Traffic Management' AND o.`id` <> d.`id`
  SET d.`name` = 'Air Traffic Management' WHERE d.`code` = 'ATM' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Internal Audit' AND o.`id` <> d.`id`
  SET d.`name` = 'Internal Audit' WHERE d.`code` = 'AUDIT' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Aviation Security' AND o.`id` <> d.`id`
  SET d.`name` = 'Aviation Security' WHERE d.`code` = 'AVSEC' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Economic Regulation' AND o.`id` <> d.`id`
  SET d.`name` = 'Economic Regulation' WHERE d.`code` = 'ER' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Finance' AND o.`id` <> d.`id`
  SET d.`name` = 'Finance' WHERE d.`code` = 'FINANCE' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Flight Safety Standards' AND o.`id` <> d.`id`
  SET d.`name` = 'Flight Safety Standards' WHERE d.`code` = 'FSS' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Human Resource' AND o.`id` <> d.`id`
  SET d.`name` = 'Human Resource' WHERE d.`code` = 'HR' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Information Technology' AND o.`id` <> d.`id`
  SET d.`name` = 'Information Technology' WHERE d.`code` = 'IT' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Management Accounting' AND o.`id` <> d.`id`
  SET d.`name` = 'Management Accounting' WHERE d.`code` = 'MGT ACCT' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Operations' AND o.`id` <> d.`id`
  SET d.`name` = 'Operations' WHERE d.`code` = 'OPS' AND o.`id` IS NULL;
UPDATE `Department` d LEFT JOIN `Department` o ON o.`directorateId` = d.`directorateId` AND o.`name` = 'Procurement and Disposal' AND o.`id` <> d.`id`
  SET d.`name` = 'Procurement and Disposal' WHERE d.`code` = 'PDU' AND o.`id` IS NULL;

-- AlterTable
ALTER TABLE `Directorate` MODIFY `code` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `Department` MODIFY `code` VARCHAR(64) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Directorate_code_key` ON `Directorate`(`code`);

-- CreateIndex
CREATE UNIQUE INDEX `Department_code_directorateId_key` ON `Department`(`code`, `directorateId`);

-- CreateIndex
CREATE UNIQUE INDEX `Position_code_departmentId_key` ON `Position`(`code`, `departmentId`);
