ALTER TABLE `cinematic_asset_batches`
  ADD COLUMN `stage_id` varchar(64) NOT NULL DEFAULT 'assets' AFTER `plan_version`;
--> statement-breakpoint
ALTER TABLE `cinematic_asset_batches`
  DROP INDEX `cinematic_asset_batch_workflow_version_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `cinematic_asset_batch_workflow_stage_version_uq`
  ON `cinematic_asset_batches` (`workflow_id`, `stage_id`, `plan_version`);
--> statement-breakpoint
ALTER TABLE `cinematic_asset_jobs`
  ADD COLUMN `reference_group_id` varchar(100) NULL AFTER `scene_order`,
  ADD COLUMN `reference_bindings_json` json NULL AFTER `reference_group_id`,
  ADD COLUMN `prompt_hash` varchar(64) NULL AFTER `reference_bindings_json`,
  ADD COLUMN `reused_from_asset_id` varchar(100) NULL AFTER `prompt_hash`;
--> statement-breakpoint
UPDATE `cinematic_asset_jobs`
  SET `reference_bindings_json` = JSON_ARRAY(),
      `prompt_hash` = SHA2(CONCAT(`id`, ':legacy'), 256)
  WHERE `reference_bindings_json` IS NULL OR `prompt_hash` IS NULL;
--> statement-breakpoint
ALTER TABLE `cinematic_asset_jobs`
  MODIFY COLUMN `reference_bindings_json` json NOT NULL,
  MODIFY COLUMN `prompt_hash` varchar(64) NOT NULL;
--> statement-breakpoint
ALTER TABLE `video_workflows`
  ALTER COLUMN `pipeline_definition_version` SET DEFAULT 3;