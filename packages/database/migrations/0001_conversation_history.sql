CREATE TABLE `conversations` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `project_id` varchar(64) NOT NULL,
  `title` varchar(100) NOT NULL,
  `deleted_at` timestamp(3),
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `conversations_scope_updated_idx` (`tenant_id`, `project_id`, `updated_at`)
);
--> statement-breakpoint
CREATE TABLE `conversation_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `conversation_id` varchar(36) NOT NULL,
  `message_id` varchar(100) NOT NULL,
  `role` varchar(16) NOT NULL,
  `content` text NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `conversation_messages_message_uq` (`conversation_id`, `message_id`),
  KEY `conversation_messages_order_idx` (`conversation_id`, `id`)
);
--> statement-breakpoint
ALTER TABLE `video_workflows` ADD `conversation_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `video_workflows` ADD CONSTRAINT `video_workflows_conversation_id_uq` UNIQUE (`conversation_id`);
