ALTER TABLE `video_workflows`
  ADD COLUMN `state_version` int NOT NULL DEFAULT 0,
  ADD COLUMN `pipeline_definition_version` int NOT NULL DEFAULT 2;
--> statement-breakpoint

CREATE TABLE `workflow_artifact_versions` (
  `id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `pipeline_id` varchar(64) NOT NULL,
  `stage_id` varchar(64) NOT NULL,
  `artifact_kind` varchar(64) NOT NULL,
  `version` int NOT NULL,
  `artifact_json` json NOT NULL,
  `source_action_id` varchar(36),
  `revision_request` text,
  `superseded_at` timestamp(3),
  `superseded_by_restart_id` varchar(36),
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `workflow_artifact_versions_pk` PRIMARY KEY (`id`),
  CONSTRAINT `workflow_artifact_version_uq` UNIQUE (`workflow_id`, `version`),
  INDEX `workflow_artifact_active_stage_idx` (`workflow_id`, `pipeline_id`, `stage_id`, `superseded_at`, `version`)
);
--> statement-breakpoint

INSERT INTO `workflow_artifact_versions`
  (`id`, `workflow_id`, `pipeline_id`, `stage_id`, `artifact_kind`, `version`, `artifact_json`, `revision_request`, `superseded_at`, `superseded_by_restart_id`, `created_at`)
SELECT cav.`id`, cav.`workflow_id`, 'cinematic', cav.`stage`,
  CASE cav.`stage`
    WHEN 'research' THEN 'research_brief'
    WHEN 'proposal' THEN 'proposal'
    WHEN 'script' THEN 'script'
    WHEN 'scene_plan' THEN 'scene_plan'
    WHEN 'assets' THEN 'asset_manifest'
    WHEN 'edit' THEN 'edit_decisions'
    ELSE cav.`stage`
  END,
  cav.`version`, cav.`artifact`, cav.`revision_request`, cp.`superseded_at`, cp.`superseded_by_restart_id`, cav.`created_at`
FROM `cinematic_artifact_versions` cav
INNER JOIN `workflow_stage_checkpoints` cp
  ON cp.`workflow_id` = cav.`workflow_id` AND cp.`version` = cav.`version`;
--> statement-breakpoint

CREATE TABLE `workflow_director_cycles` (
  `id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `trigger_key` varchar(200) NOT NULL,
  `trigger_type` varchar(32) NOT NULL,
  `expected_state_version` int NOT NULL,
  `stage_id` varchar(64) NOT NULL,
  `run_id` varchar(200),
  `status` varchar(16) NOT NULL,
  `claim_token` varchar(36),
  `claim_until` timestamp(3),
  `agent_id` varchar(64) NOT NULL DEFAULT 'workflow-director',
  `model_id` varchar(120),
  `skill_id` varchar(100),
  `skill_version` varchar(64),
  `input_summary_hash` varchar(64),
  `error_code` varchar(64),
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `workflow_director_cycles_pk` PRIMARY KEY (`id`),
  CONSTRAINT `workflow_director_cycle_trigger_uq` UNIQUE (`workflow_id`, `trigger_key`),
  INDEX `workflow_director_cycle_dispatch_idx` (`status`, `claim_until`, `created_at`),
  INDEX `workflow_director_cycle_workflow_idx` (`workflow_id`, `created_at`)
);
--> statement-breakpoint

CREATE TABLE `workflow_agent_actions` (
  `id` varchar(36) NOT NULL,
  `cycle_id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `proposal_sequence` int NOT NULL,
  `accepted_key` varchar(36),
  `expected_state_version` int NOT NULL,
  `action_type` varchar(64) NOT NULL,
  `action_json` json NOT NULL,
  `rationale` text NOT NULL,
  `confidence` decimal(5,4) NOT NULL,
  `status` varchar(16) NOT NULL,
  `policy_code` varchar(64),
  `policy_reason` text,
  `redacted_result` json,
  `error_code` varchar(64),
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `workflow_agent_actions_pk` PRIMARY KEY (`id`),
  CONSTRAINT `workflow_agent_action_proposal_uq` UNIQUE (`cycle_id`, `proposal_sequence`),
  CONSTRAINT `workflow_agent_action_accepted_uq` UNIQUE (`accepted_key`),
  INDEX `workflow_agent_action_workflow_idx` (`workflow_id`, `created_at`)
);
--> statement-breakpoint

CREATE TABLE `workflow_production_decisions` (
  `id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `action_id` varchar(36) NOT NULL,
  `category` varchar(32) NOT NULL,
  `subject` varchar(120) NOT NULL,
  `decision_json` json NOT NULL,
  `approval_id` varchar(36),
  `superseded_at` timestamp(3),
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `workflow_production_decisions_pk` PRIMARY KEY (`id`),
  INDEX `workflow_production_decision_current_idx` (`workflow_id`, `category`, `subject`, `superseded_at`)
);
--> statement-breakpoint

CREATE TABLE `workflow_approvals` (
  `id` varchar(36) NOT NULL,
  `workflow_id` varchar(36) NOT NULL,
  `stage_id` varchar(64) NOT NULL,
  `scope` varchar(32) NOT NULL,
  `target_id` varchar(100) NOT NULL,
  `target_version` int,
  `status` varchar(16) NOT NULL,
  `active_key` varchar(255),
  `request_action_id` varchar(36) NOT NULL,
  `summary` text NOT NULL,
  `user_message_id` varchar(100),
  `requested_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `decided_at` timestamp(3),
  CONSTRAINT `workflow_approvals_pk` PRIMARY KEY (`id`),
  CONSTRAINT `workflow_approval_pending_uq` UNIQUE (`active_key`),
  INDEX `workflow_approval_workflow_idx` (`workflow_id`, `requested_at`)
);
