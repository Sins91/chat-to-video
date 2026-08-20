ALTER TABLE `video_workflows`
  ALTER COLUMN `output_resolution` SET DEFAULT '480p';
--> statement-breakpoint

ALTER TABLE `video_jobs`
  ADD COLUMN `output_resolution` varchar(16) NOT NULL DEFAULT '720p' AFTER `capability_resolutions`;
--> statement-breakpoint

ALTER TABLE `cinematic_asset_jobs`
  ADD COLUMN `output_resolution` varchar(16) NULL AFTER `capability_resolution`,
  ADD COLUMN `generation_resolution` varchar(16) NULL AFTER `output_resolution`;
--> statement-breakpoint

UPDATE `video_workflows` AS `workflow`
INNER JOIN `workflow_user_decisions` AS `decision`
  ON `decision`.`workflow_id` = `workflow`.`id`
  AND `decision`.`applied_at` IS NOT NULL
  AND `decision`.`created_at` = (
    SELECT MAX(`latest`.`created_at`)
    FROM `workflow_user_decisions` AS `latest`
    WHERE `latest`.`workflow_id` = `workflow`.`id`
      AND `latest`.`applied_at` IS NOT NULL
      AND REGEXP_LIKE(`latest`.`raw_text`, '(480p|720p|768p|1080p|2k|4k)', 'i')
      AND JSON_UNQUOTE(JSON_EXTRACT(`latest`.`decision_json`, '$.type')) IN (
        'update_output_resolution',
        'approve',
        'approve_with_changes',
        'revise_current'
      )
  )
SET `workflow`.`output_resolution` = LOWER(REGEXP_SUBSTR(
  `decision`.`raw_text`,
  '(480p|720p|768p|1080p|2k|4k)',
  1,
  1,
  'i'
))
WHERE `workflow`.`status` = 'awaiting_input'
  AND NOT EXISTS (
    SELECT 1 FROM `video_jobs` AS `video_job`
    WHERE `video_job`.`workflow_id` = `workflow`.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `cinematic_asset_jobs` AS `asset_job`
    WHERE `asset_job`.`workflow_id` = `workflow`.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `cinematic_scene_jobs` AS `scene_job`
    WHERE `scene_job`.`workflow_id` = `workflow`.`id`
  );
