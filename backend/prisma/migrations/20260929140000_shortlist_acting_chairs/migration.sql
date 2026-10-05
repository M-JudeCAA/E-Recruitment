-- A member named to rule on one applicant's disputed items in place of a
-- conflicted chair.

ALTER TABLE `ShortlistExercise` ADD COLUMN `actingChairs` JSON NULL;
