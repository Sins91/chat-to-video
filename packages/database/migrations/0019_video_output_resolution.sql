ALTER TABLE `video_workflows`
  ADD COLUMN `output_resolution` varchar(16) NOT NULL DEFAULT '720p' AFTER `duration_seconds`;
--> statement-breakpoint

UPDATE `video_workflows`
SET `output_resolution` = LOWER(REGEXP_SUBSTR(
  `initial_prompt`,
  '(480p|720p|768p|1080p|2k|4k)',
  1,
  1,
  'i'
))
WHERE REGEXP_LIKE(`initial_prompt`, '(480p|720p|768p|1080p|2k|4k)', 'i');
