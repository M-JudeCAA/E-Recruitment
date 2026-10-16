-- An internal candidate's department and position are picked from the
-- organisation structure on Internal Careers, not typed in. The ids are kept
-- beside the names (which stay as HR sees them). Deleting the department or
-- position clears the link and leaves the name.

-- AlterTable
ALTER TABLE `InternalProfile` ADD COLUMN `departmentId` INTEGER NULL,
    ADD COLUMN `positionId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `InternalProfile` ADD CONSTRAINT `InternalProfile_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalProfile` ADD CONSTRAINT `InternalProfile_positionId_fkey` FOREIGN KEY (`positionId`) REFERENCES `Position`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
