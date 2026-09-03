-- CreateIndex
CREATE UNIQUE INDEX `Application_vacancyId_candidateId_key` ON `Application`(`vacancyId`, `candidateId`);
