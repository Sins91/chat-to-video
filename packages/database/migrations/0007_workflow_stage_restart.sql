ALTER TABLE `video_workflows` ADD `pipeline_id` varchar(64) DEFAULT 'cinematic' NOT NULL;
--> statement-breakpoint
ALTER TABLE `video_workflows` ADD `current_stage_id` varchar(64) DEFAULT 'research' NOT NULL;
--> statement-breakpoint
UPDATE `video_workflows` SET `current_stage_id` = `cinematic_stage`;
--> statement-breakpoint
ALTER TABLE `video_workflows` ADD `pending_restart_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `video_workflows` ADD `pending_restart_stage` varchar(64);
--> statement-breakpoint
ALTER TABLE `video_workflows` ADD `pending_restart_text` text;
--> statement-breakpoint
ALTER TABLE `video_workflows` ADD `pending_restart_expected_version` int;
--> statement-breakpoint
ALTER TABLE `video_workflows` ADD `pending_restart_requested_at` timestamp(3);
--> statement-breakpoint
ALTER TABLE `video_workflows` ADD `pending_restart_expires_at` timestamp(3);
--> statement-breakpoint
ALTER TABLE `video_jobs` ADD `superseded_at` timestamp(3);
--> statement-breakpoint
ALTER TABLE `video_jobs` ADD `superseded_by_restart_id` varchar(36);
--> statement-breakpoint
CREATE INDEX `video_jobs_active_workflow_idx` ON `video_jobs` (`workflow_id`,`superseded_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX `video_workflows_pipeline_status_idx` ON `video_workflows` (`pipeline_id`,`status`);
--> statement-breakpoint
CREATE TABLE `workflow_stage_checkpoints` (
	`id` varchar(100) NOT NULL,
	`workflow_id` varchar(36) NOT NULL,
	`pipeline_id` varchar(64) NOT NULL,
	`stage_id` varchar(64) NOT NULL,
	`version` int NOT NULL,
	`superseded_at` timestamp(3),
	`superseded_by_restart_id` varchar(36),
	`created_at` timestamp(3) DEFAULT (now()) NOT NULL,
	CONSTRAINT `workflow_stage_checkpoints_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_stage_checkpoint_version_uq` UNIQUE(`workflow_id`,`version`)
);
--> statement-breakpoint
INSERT INTO `workflow_stage_checkpoints` (`id`, `workflow_id`, `pipeline_id`, `stage_id`, `version`, `created_at`)
SELECT CONCAT(`workflow_id`, ':', `version`), `workflow_id`, 'cinematic', `stage`, `version`, `created_at`
FROM `cinematic_artifact_versions`;
--> statement-breakpoint
CREATE INDEX `workflow_stage_checkpoint_active_idx` ON `workflow_stage_checkpoints` (`workflow_id`,`pipeline_id`,`stage_id`,`superseded_at`,`version`);
