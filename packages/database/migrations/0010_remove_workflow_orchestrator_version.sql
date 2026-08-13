DROP INDEX `video_workflows_orchestrator_status_idx` ON `video_workflows`;
--> statement-breakpoint
ALTER TABLE `video_workflows`
  DROP COLUMN `orchestrator_version`;
