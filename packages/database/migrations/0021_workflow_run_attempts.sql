CREATE TABLE `workflow_run_attempts` (
	`id` varchar(36) NOT NULL,
	`workflow_id` varchar(36) NOT NULL,
	`kind` varchar(24) NOT NULL,
	`idempotency_key` varchar(200) NOT NULL,
	`run_context_json` json NOT NULL,
	`mastra_run_id` varchar(200) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'pending',
	`claim_token` varchar(36),
	`claim_until` timestamp(3),
	`error_code` varchar(64),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`started_at` timestamp(3),
	`completed_at` timestamp(3),
	CONSTRAINT `workflow_run_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_run_attempts_idempotency_uq` UNIQUE(`idempotency_key`),
	CONSTRAINT `workflow_run_attempts_mastra_run_uq` UNIQUE(`mastra_run_id`)
);
--> statement-breakpoint
CREATE INDEX `workflow_run_attempts_dispatch_idx` ON `workflow_run_attempts` (`status`,`claim_until`,`created_at`);
--> statement-breakpoint
CREATE INDEX `workflow_run_attempts_workflow_idx` ON `workflow_run_attempts` (`workflow_id`,`created_at`);
