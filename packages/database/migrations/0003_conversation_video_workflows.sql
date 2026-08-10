ALTER TABLE `video_workflows` DROP INDEX `video_workflows_conversation_id_uq`;
--> statement-breakpoint
CREATE INDEX `video_workflows_conversation_id_idx` ON `video_workflows` (`conversation_id`);
