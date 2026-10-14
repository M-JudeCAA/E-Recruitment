-- The position at the head of each directorate (its Director, or for
-- Corporate the Deputy Director General): managers in the directorate and
-- everyone in the head's own office report to it (reportingLineService).

-- AlterTable
ALTER TABLE `Directorate` ADD COLUMN `headPositionId` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Directorate_headPositionId_key` ON `Directorate`(`headPositionId`);

-- AddForeignKey
ALTER TABLE `Directorate` ADD CONSTRAINT `Directorate_headPositionId_fkey` FOREIGN KEY (`headPositionId`) REFERENCES `Position`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
