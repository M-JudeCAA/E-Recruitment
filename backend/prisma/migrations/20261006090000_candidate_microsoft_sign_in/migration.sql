-- Internal candidates sign in with their UCAA Microsoft account again (the
-- previous migration dropped this for a staff-only sign-in, since reverted).
-- A candidate unlinked by that drop is linked again by email on their next
-- Microsoft sign-in (candidateAuthController.entraLogin).

ALTER TABLE `Candidate` ADD COLUMN `entraObjectId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Candidate_entraObjectId_key` ON `Candidate`(`entraObjectId`);
