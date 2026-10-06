-- Evidence for what screening relies on: an Evidence document category,
-- filed under the requirement it backs (ApplicationDocument.evidenceKey).
-- AlterTable
ALTER TABLE `ApplicationDocument` ADD COLUMN `evidenceKey` VARCHAR(80) NULL,
    MODIFY `category` ENUM('Academic', 'Other', 'Evidence') NOT NULL;

