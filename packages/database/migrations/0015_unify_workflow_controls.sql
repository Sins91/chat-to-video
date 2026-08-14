ALTER TABLE `video_workflows`
  DROP COLUMN `pending_restart_id`,
  DROP COLUMN `pending_restart_stage`,
  DROP COLUMN `pending_restart_text`,
  DROP COLUMN `pending_restart_expected_version`,
  DROP COLUMN `pending_restart_requested_at`,
  DROP COLUMN `pending_restart_expires_at`;
