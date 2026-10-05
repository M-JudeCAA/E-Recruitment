-- The Uganda NIN is the only identity document a candidate gives, so the
-- National ID / Passport choice goes. A candidate who had entered a
-- passport number keeps it in nationalId, but it fails NIN validation, so
-- their profile shows as incomplete until they enter their NIN.

ALTER TABLE `Candidate` DROP COLUMN `idType`;
