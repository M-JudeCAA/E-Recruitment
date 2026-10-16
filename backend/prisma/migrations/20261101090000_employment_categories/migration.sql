-- UCAA's employment categories are now Fixed term contract, Secondment and
-- Full secondment. Full-time (permanent) and Contract are gone: vacancies
-- and offers that used them become Fixed term contract. Only a fixed term
-- contract has a length (Offer.contractMonths), a secondment has none.

-- Allow the new values alongside the old while the rows move over.
ALTER TABLE `Vacancy` MODIFY `employmentCategory` ENUM('FullTime', 'Contract', 'FixedTermContract', 'Secondment', 'FullSecondment') NULL;
ALTER TABLE `Offer` MODIFY `employmentCategory` ENUM('FullTime', 'Contract', 'FixedTermContract', 'Secondment', 'FullSecondment') NULL;

UPDATE `Vacancy` SET `employmentCategory` = 'FixedTermContract' WHERE `employmentCategory` IN ('FullTime', 'Contract');
UPDATE `Offer` SET `employmentCategory` = 'FixedTermContract' WHERE `employmentCategory` IN ('FullTime', 'Contract');

-- AlterTable
ALTER TABLE `Vacancy` MODIFY `employmentCategory` ENUM('FixedTermContract', 'Secondment', 'FullSecondment') NULL;

-- AlterTable
ALTER TABLE `Offer` MODIFY `employmentCategory` ENUM('FixedTermContract', 'Secondment', 'FullSecondment') NULL;
