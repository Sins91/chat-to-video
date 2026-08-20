ALTER TABLE `reference_images`
  ADD COLUMN `resolution_json` json NULL AFTER `analysis_json`;
--> statement-breakpoint

CREATE TABLE `reference_image_resolution_requests` (
  `id` varchar(36) NOT NULL,
  `conversation_id` varchar(36) NOT NULL,
  `message_id` varchar(100) NOT NULL,
  `workflow_id` varchar(36) NULL,
  `workflow_version` int NULL,
  `original_text` text NOT NULL,
  `reference_image_ids_json` json NOT NULL,
  `video_model` varchar(64) NOT NULL,
  `status` varchar(16) NOT NULL,
  `expires_at` timestamp(3) NOT NULL,
  `resolved_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `reference_resolution_message_uq` (`conversation_id`, `message_id`),
  KEY `reference_resolution_pending_idx` (`conversation_id`, `status`, `expires_at`)
);
