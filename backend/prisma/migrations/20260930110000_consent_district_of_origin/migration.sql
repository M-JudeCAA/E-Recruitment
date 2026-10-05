-- District of Origin on the candidate profile (FR-ATS-034), and the
-- candidate's consent to data processing given at submission (FR-ATS-038).

ALTER TABLE `Candidate` ADD COLUMN `districtOfOrigin` VARCHAR(191) NULL;

ALTER TABLE `Application`
    ADD COLUMN `consentGivenAt` DATETIME(3) NULL,
    ADD COLUMN `consentNoticeVersion` VARCHAR(191) NULL;
