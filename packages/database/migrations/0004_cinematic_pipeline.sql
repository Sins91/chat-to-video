ALTER TABLE `video_workflows` ADD `cinematic_stage` varchar(32) DEFAULT 'research' NOT NULL;
--> statement-breakpoint
CREATE TABLE `cinematic_artifact_versions` (
  `id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `stage` varchar(32) NOT NULL,
  `version` int NOT NULL,
  `revision_request` text,
  `artifact` json NOT NULL,
  `created_at` timestamp(3) DEFAULT (now()) NOT NULL,
  CONSTRAINT `cinematic_artifact_versions_id` PRIMARY KEY(`id`),
  CONSTRAINT `cinematic_artifact_workflow_version_uq` UNIQUE(`workflow_id`,`version`)
);
--> statement-breakpoint
CREATE INDEX `cinematic_artifact_workflow_stage_idx` ON `cinematic_artifact_versions` (`workflow_id`,`stage`);
--> statement-breakpoint
CREATE TABLE `cinematic_scene_jobs` (
  `id` varchar(100) NOT NULL,
  `video_job_id` varchar(100) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `scene_order` int NOT NULL,
  `status` varchar(32) NOT NULL,
  `progress` int DEFAULT 0 NOT NULL,
  `provider_task_id` varchar(200),
  `object_key` varchar(512) NOT NULL,
  `error_message` text,
  `created_at` timestamp(3) DEFAULT (now()) NOT NULL,
  `updated_at` timestamp(3) DEFAULT (now()) NOT NULL,
  CONSTRAINT `cinematic_scene_jobs_id` PRIMARY KEY(`id`),
  CONSTRAINT `cinematic_scene_job_order_uq` UNIQUE(`video_job_id`,`scene_order`)
);
--> statement-breakpoint
CREATE INDEX `cinematic_scene_job_workflow_idx` ON `cinematic_scene_jobs` (`workflow_id`);
