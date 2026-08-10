CREATE TABLE `video_workflows` (
  `id` varchar(36) NOT NULL,
  `run_id` varchar(200),
  `request_id` varchar(36) NOT NULL,
  `initial_prompt` text NOT NULL,
  `status` varchar(32) NOT NULL,
  `current_version` int NOT NULL DEFAULT 0,
  `error_message` text,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `video_workflows_request_id_uq` (`request_id`)
);
--> statement-breakpoint

CREATE TABLE `storyboard_versions` (
  `id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `version` int NOT NULL,
  `revision_request` text,
  `storyboard` json NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `storyboard_workflow_version_uq` (`workflow_id`, `version`),
  KEY `storyboard_workflow_idx` (`workflow_id`)
);
--> statement-breakpoint

CREATE TABLE `video_jobs` (
  `id` varchar(100) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `storyboard_version` int NOT NULL,
  `status` varchar(32) NOT NULL,
  `progress` int NOT NULL DEFAULT 0,
  `provider_task_id` varchar(200),
  `object_key` varchar(512) NOT NULL,
  `error_message` text,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `video_jobs_workflow_version_uq` (`workflow_id`, `storyboard_version`),
  KEY `video_jobs_workflow_idx` (`workflow_id`)
);
--> statement-breakpoint

CREATE TABLE `video_outputs` (
  `id` varchar(36) NOT NULL,
  `job_id` varchar(100) NOT NULL,
  `object_key` varchar(512) NOT NULL,
  `mime_type` varchar(100) NOT NULL,
  `size_bytes` int NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `video_outputs_job_uq` (`job_id`)
);
--> statement-breakpoint

CREATE TABLE `video_workflow_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` varchar(100) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `request_id` varchar(36) NOT NULL,
  `type` varchar(64) NOT NULL,
  `data` json NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `video_workflow_events_event_id_uq` (`event_id`),
  KEY `video_workflow_events_cursor_idx` (`workflow_id`, `id`)
);
