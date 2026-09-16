-- AlterTable
ALTER TABLE `Vacancy` ADD COLUMN `postingTypeLocked` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Vacancy` ADD COLUMN `readvertisedFromId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `Vacancy` ADD CONSTRAINT `Vacancy_readvertisedFromId_fkey` FOREIGN KEY (`readvertisedFromId`) REFERENCES `Vacancy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
