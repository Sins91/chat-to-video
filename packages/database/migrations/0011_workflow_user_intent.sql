CREATE TABLE `workflow_user_decisions` (
  `id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `conversation_message_id` varchar(100) NOT NULL,
  `pipeline_id` varchar(64) NOT NULL,
  `stage_id` varchar(64) NOT NULL,
  `artifact_version` int NOT NULL,
  `raw_text` text NOT NULL,
  `decision_json` json NOT NULL,
  `resolver_version` varchar(32) NOT NULL,
  `decision_source` varchar(16) NOT NULL,
  `requires_confirmation` int NOT NULL DEFAULT 0,
  `confirmed_at` timestamp(3) NULL,
  `applied_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `workflow_user_decisions_id_pk` PRIMARY KEY (`id`),
  CONSTRAINT `workflow_user_decisions_message_uq` UNIQUE (`conversation_message_id`)
);
--> statement-breakpoint
CREATE INDEX `workflow_user_decisions_workflow_idx`
  ON `workflow_user_decisions` (`workflow_id`, `created_at`);
