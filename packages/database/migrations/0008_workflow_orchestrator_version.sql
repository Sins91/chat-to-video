ALTER TABLE `video_workflows`
  ADD COLUMN `orchestrator_version` varchar(32) NOT NULL DEFAULT 'mastra-v1' AFTER `pipeline_id`;
--> statement-breakpoint
CREATE INDEX `video_workflows_orchestrator_status_idx`
  ON `video_workflows` (`orchestrator_version`, `status`);
