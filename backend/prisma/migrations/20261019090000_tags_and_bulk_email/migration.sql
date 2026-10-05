-- Candidate tags (FR-ATS-051) and bulk emails to candidates (FR-ATS-050).
-- CreateTable
CREATE TABLE `CandidateTag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CandidateTag_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CandidateTagging` (
    `candidateId` INTEGER NOT NULL,
    `tagId` INTEGER NOT NULL,
    `addedById` INTEGER NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CandidateTagging_tagId_idx`(`tagId`),
    PRIMARY KEY (`candidateId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BulkEmail` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateKey` VARCHAR(60) NULL,
    `subject` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `vacancyId` INTEGER NULL,
    `sentById` INTEGER NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recipientCount` INTEGER NOT NULL,
    `failedCount` INTEGER NOT NULL DEFAULT 0,

    INDEX `BulkEmail_vacancyId_idx`(`vacancyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BulkEmailRecipient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bulkEmailId` INTEGER NOT NULL,
    `candidateId` INTEGER NOT NULL,
    `applicationId` INTEGER NULL,
    `email` VARCHAR(191) NOT NULL,
    `sent` BOOLEAN NOT NULL,

    INDEX `BulkEmailRecipient_candidateId_idx`(`candidateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CandidateTag` ADD CONSTRAINT `CandidateTag_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateTagging` ADD CONSTRAINT `CandidateTagging_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateTagging` ADD CONSTRAINT `CandidateTagging_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `CandidateTag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CandidateTagging` ADD CONSTRAINT `CandidateTagging_addedById_fkey` FOREIGN KEY (`addedById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BulkEmail` ADD CONSTRAINT `BulkEmail_sentById_fkey` FOREIGN KEY (`sentById`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BulkEmailRecipient` ADD CONSTRAINT `BulkEmailRecipient_bulkEmailId_fkey` FOREIGN KEY (`bulkEmailId`) REFERENCES `BulkEmail`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BulkEmailRecipient` ADD CONSTRAINT `BulkEmailRecipient_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `Candidate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

