-- A candidate's sessions end when their password is reset (middleware/auth.js).
ALTER TABLE `Candidate` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;
