ALTER TABLE `video_workflows`
  ADD COLUMN `active_run_context` json NULL AFTER `run_id`,
  ADD COLUMN `last_progress_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER `error_message`,
  ADD COLUMN `failure_code` varchar(64) NULL AFTER `last_progress_at`,
  ADD COLUMN `watchdog_claim_token` varchar(36) NULL AFTER `failure_code`,
  ADD COLUMN `watchdog_claim_until` timestamp(3) NULL AFTER `watchdog_claim_token`;
--> statement-breakpoint
CREATE INDEX `video_workflows_status_progress_idx`
  ON `video_workflows` (`status`, `last_progress_at`);
