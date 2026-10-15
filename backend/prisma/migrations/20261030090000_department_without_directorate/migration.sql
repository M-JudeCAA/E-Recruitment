-- A department can sit outside every directorate (the Director General's
-- Office). Codes and names of such departments are kept unique among
-- themselves by the application: MySQL lets a unique key repeat when one of
-- its columns is NULL, so @@unique([code, directorateId]) doesn't cover them.

-- AlterTable
ALTER TABLE `Department` MODIFY `directorateId` INTEGER NULL;
