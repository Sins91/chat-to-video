ALTER TABLE `video_jobs`
  ADD COLUMN `capability_resolutions` json AFTER `provider_task_id`;
--> statement-breakpoint
CREATE TABLE `cinematic_asset_batches` (
  `id` varchar(100) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `plan_version` int NOT NULL,
  `status` varchar(32) NOT NULL,
  `error_message` text,
  `superseded_at` timestamp(3),
  `superseded_by_restart_id` varchar(36),
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `cinematic_asset_batches_id` PRIMARY KEY(`id`),
  CONSTRAINT `cinematic_asset_batch_workflow_version_uq` UNIQUE(`workflow_id`,`plan_version`)
);
--> statement-breakpoint
CREATE INDEX `cinematic_asset_batch_workflow_status_idx`
  ON `cinematic_asset_batches` (`workflow_id`,`status`);
--> statement-breakpoint
CREATE TABLE `cinematic_asset_jobs` (
  `id` varchar(100) NOT NULL,
  `batch_id` varchar(100) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `scene_order` int,
  `kind` varchar(32) NOT NULL,
  `status` varchar(32) NOT NULL,
  `progress` int NOT NULL DEFAULT 0,
  `capability_resolution` json NOT NULL,
  `provider_task_id` varchar(200),
  `object_key` varchar(512) NOT NULL,
  `mime_type` varchar(100),
  `size_bytes` int,
  `error_message` text,
  `superseded_at` timestamp(3),
  `superseded_by_restart_id` varchar(36),
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `cinematic_asset_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `cinematic_asset_job_batch_status_idx`
  ON `cinematic_asset_jobs` (`batch_id`,`status`);
--> statement-breakpoint
CREATE INDEX `cinematic_asset_job_workflow_idx`
  ON `cinematic_asset_jobs` (`workflow_id`);
