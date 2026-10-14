-- The system administrator's audit log: who did what, when and from where.
-- Each audit row now records the request it came from (actor, IP address,
-- browser, method and path, request id); the access log gains the browser
-- and request id; and ActivityLog records every change request, sign-ins
-- included, with its outcome.

-- AlterTable
ALTER TABLE `AuditLog` ADD COLUMN `actorType` VARCHAR(20) NULL,
    ADD COLUMN `actorLabel` VARCHAR(255) NULL,
    ADD COLUMN `ipAddress` VARCHAR(64) NULL,
    ADD COLUMN `userAgent` VARCHAR(500) NULL,
    ADD COLUMN `requestMethod` VARCHAR(10) NULL,
    ADD COLUMN `requestPath` VARCHAR(500) NULL,
    ADD COLUMN `requestId` VARCHAR(36) NULL;

-- CreateIndex
CREATE INDEX `AuditLog_timestamp_idx` ON `AuditLog`(`timestamp`);

-- CreateIndex
CREATE INDEX `AuditLog_entityType_entityId_idx` ON `AuditLog`(`entityType`, `entityId`);

-- CreateIndex
CREATE INDEX `AuditLog_requestId_idx` ON `AuditLog`(`requestId`);

-- AlterTable
ALTER TABLE `DataAccessLog` ADD COLUMN `userAgent` VARCHAR(500) NULL,
    ADD COLUMN `requestId` VARCHAR(36) NULL;

-- CreateTable
CREATE TABLE `ActivityLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `requestId` VARCHAR(36) NULL,
    `actorType` VARCHAR(20) NOT NULL,
    `staffUserId` INTEGER NULL,
    `candidateId` INTEGER NULL,
    `actingAsId` INTEGER NULL,
    `actorLabel` VARCHAR(255) NULL,
    `method` VARCHAR(10) NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `route` VARCHAR(300) NULL,
    `action` VARCHAR(255) NULL,
    `statusCode` INTEGER NOT NULL,
    `outcome` VARCHAR(20) NOT NULL,
    `durationMs` INTEGER NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(500) NULL,
    `detail` JSON NULL,

    INDEX `ActivityLog_at_idx`(`at`),
    INDEX `ActivityLog_staffUserId_idx`(`staffUserId`),
    INDEX `ActivityLog_candidateId_idx`(`candidateId`),
    INDEX `ActivityLog_ipAddress_idx`(`ipAddress`),
    INDEX `ActivityLog_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
