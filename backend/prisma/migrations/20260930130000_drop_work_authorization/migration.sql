-- Every candidate now gives a Uganda NIN, so "Authorized to work in
-- Uganda?" no longer tells HR anything and is no longer asked.

ALTER TABLE `Candidate` DROP COLUMN `workAuthorization`;
