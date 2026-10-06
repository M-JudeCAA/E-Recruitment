-- When a vacancy last changed. The approver sends the value they reviewed,
-- so a vacancy edited after they looked at it is refused rather than
-- approved unseen (vacancyController.approve, VACANCY_CHANGED).
ALTER TABLE `Vacancy` ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
