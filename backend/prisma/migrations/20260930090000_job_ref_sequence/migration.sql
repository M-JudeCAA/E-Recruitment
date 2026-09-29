-- Running number for job references: UCAA/ADV/{INT|EXT}/{NNN}/{YYYY}.
-- Existing month-based refs (UCAA/ADV/EXT/09/2026) are left unchanged.

CREATE TABLE `JobRefSequence` (
    `typeCode` VARCHAR(3) NOT NULL,
    `year` INTEGER NOT NULL,
    `lastNumber` INTEGER NOT NULL,

    PRIMARY KEY (`typeCode`, `year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
