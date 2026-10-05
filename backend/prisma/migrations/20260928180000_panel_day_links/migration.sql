-- Panel day links: one scoring link per panelist per interview day of a
-- vacancy, covering every candidate they interview that day.

CREATE TABLE `PanelDayLink` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `vacancyId` INTEGER NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `panelistName` VARCHAR(191) NOT NULL,
    `panelistEmail` VARCHAR(191) NULL,
    `staffUserId` INTEGER NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PanelDayLink_token_key`(`token`),
    INDEX `PanelDayLink_vacancyId_day_idx`(`vacancyId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PanelDayLink` ADD CONSTRAINT `PanelDayLink_vacancyId_fkey` FOREIGN KEY (`vacancyId`) REFERENCES `Vacancy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
