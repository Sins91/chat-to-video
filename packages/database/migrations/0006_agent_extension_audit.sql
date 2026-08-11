CREATE TABLE `agent_extension_executions` (
	`id` varchar(36) NOT NULL,
	`call_key` varchar(200) NOT NULL,
	`request_id` varchar(36) NOT NULL,
	`workflow_id` varchar(36),
	`conversation_id` varchar(36),
	`agent_id` varchar(64) NOT NULL,
	`stage` varchar(32),
	`extension_kind` varchar(16) NOT NULL,
	`extension_id` varchar(100) NOT NULL,
	`attempt` int NOT NULL,
	`activity_sequence` int NOT NULL,
	`status` varchar(16) NOT NULL,
	`input_summary` text,
	`estimated_cost_usd` decimal(12,6),
	`duration_ms` int,
	`error_code` varchar(100),
	`started_at` timestamp(3) NOT NULL DEFAULT (now()),
	`completed_at` timestamp(3),
	CONSTRAINT `agent_extension_executions_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_extension_executions_call_key_uq` UNIQUE(`call_key`)
);
--> statement-breakpoint
CREATE INDEX `agent_extension_executions_request_idx` ON `agent_extension_executions` (`request_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `agent_extension_executions_workflow_idx` ON `agent_extension_executions` (`workflow_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `agent_extension_executions_conversation_idx` ON `agent_extension_executions` (`conversation_id`,`started_at`);
