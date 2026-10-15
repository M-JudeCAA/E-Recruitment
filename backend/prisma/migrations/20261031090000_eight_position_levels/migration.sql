-- Position levels go from five to eight (utils/positionLevels.js):
--   before: Officer 1, Senior 2, Principal 3, Manager 4, Director 5
--   now:    Assistant 1, Assistant Officer 2, Officer 3, Senior Officer 4,
--           Principal 5, Chief 6, Manager 7, Director 8
-- Each position keeps its level, renumbered. Nobody becomes a Chief,
-- Assistant Officer or Assistant here - HR (or the organisation workbook,
-- scripts/seedDepartments.js) sets those. One statement, so no row is moved
-- twice.
UPDATE `Position`
SET `level` = CASE `level` WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 7 WHEN 5 THEN 8 ELSE `level` END;
