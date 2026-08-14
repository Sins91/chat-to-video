ALTER TABLE `video_workflows`
  ADD COLUMN `source_workflow_id` varchar(36),
  ADD COLUMN `successor_workflow_id` varchar(36),
  ADD COLUMN `cancellation_reason` text,
  ADD COLUMN `cancelled_at` timestamp(3);
--> statement-breakpoint

ALTER TABLE `workflow_artifact_versions`
  ADD COLUMN `origin` varchar(16) NOT NULL DEFAULT 'generated',
  ADD COLUMN `source_message_id` varchar(100),
  ADD COLUMN `source_workflow_id` varchar(36),
  ADD COLUMN `source_artifact_version` int,
  ADD COLUMN `control_request_id` varchar(36),
  ADD COLUMN `normalizer_version` varchar(32),
  ADD COLUMN `confirmed_at` timestamp(3);
--> statement-breakpoint

ALTER TABLE `workflow_user_decisions`
  ADD COLUMN `resolution_status` varchar(16) NOT NULL DEFAULT 'resolved';
--> statement-breakpoint

CREATE TABLE `workflow_control_requests` (
  `id` varchar(36) NOT NULL,
  `conversation_id` varchar(36),
  `source_workflow_id` varchar(36),
  `source_message_id` varchar(100) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `status` varchar(16) NOT NULL,
  `target_pipeline_id` varchar(64),
  `target_stage_id` varchar(64),
  `expected_state_version` int NOT NULL,
  `raw_text` text NOT NULL,
  `candidate_json` json,
  `impact_json` json NOT NULL,
  `claim_token` varchar(36),
  `claim_until` timestamp(3),
  `requested_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` timestamp(3) NOT NULL,
  `completed_at` timestamp(3),
  `error_code` varchar(64),
  CONSTRAINT `workflow_control_requests_pk` PRIMARY KEY (`id`),
  CONSTRAINT `workflow_control_request_message_uq` UNIQUE (`source_message_id`),
  INDEX `workflow_control_request_pending_idx` (`status`, `expires_at`),
  INDEX `workflow_control_request_workflow_idx` (`source_workflow_id`, `requested_at`)
);
--> statement-breakpoint

CREATE TABLE `workflow_stage_attempts` (
  `id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `pipeline_id` varchar(64) NOT NULL,
  `stage_id` varchar(64) NOT NULL,
  `attempt` int NOT NULL,
  `status` varchar(24) NOT NULL,
  `partial_progress_json` json,
  `resume_cursor` varchar(200),
  `failure_code` varchar(64),
  `started_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` timestamp(3),
  CONSTRAINT `workflow_stage_attempts_pk` PRIMARY KEY (`id`),
  CONSTRAINT `workflow_stage_attempt_uq` UNIQUE (`workflow_id`, `stage_id`, `attempt`),
  INDEX `workflow_stage_attempt_active_idx` (`workflow_id`, `status`, `started_at`)
);
