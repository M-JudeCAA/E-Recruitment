-- Microsoft (Entra ID) sign-in is for staff only. Candidates, internal ones
-- included, sign in with email and password again; an internal candidate is
-- one who registered with a UCAA address. A candidate account opened with
-- Microsoft sign-in keeps a null password until "Forgot password" sets one.

DROP INDEX `Candidate_entraObjectId_key` ON `Candidate`;
ALTER TABLE `Candidate` DROP COLUMN `entraObjectId`;
