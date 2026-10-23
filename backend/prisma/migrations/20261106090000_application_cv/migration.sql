-- A candidate's own CV, uploaded on the application's Documents step as a
-- supporting document of its own kind (at most one per application,
-- applicationDraftController.addDocument). Optional - HR also has the CV the
-- system generates from the profile.

-- AlterTable
ALTER TABLE `ApplicationDocument` MODIFY `category` ENUM('Academic', 'Other', 'Evidence', 'CV') NOT NULL;
