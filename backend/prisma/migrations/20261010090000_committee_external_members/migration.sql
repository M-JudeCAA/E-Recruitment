-- Shortlisting committees: anyone at UCAA may sit on one, HR included; a
-- member from outside UCAA is a special case and records the reason.
-- AlterTable
ALTER TABLE `ShortlistMember` ADD COLUMN `externalReason` TEXT NULL;

