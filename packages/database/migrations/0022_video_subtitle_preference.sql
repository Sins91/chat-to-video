ALTER TABLE `video_workflows`
	ADD `subtitles_enabled` boolean NOT NULL DEFAULT false AFTER `video_model`;
--> statement-breakpoint
ALTER TABLE `reference_image_resolution_requests`
	ADD `subtitles_enabled` boolean NOT NULL DEFAULT false AFTER `video_model`;
