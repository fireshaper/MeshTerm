CREATE TABLE `user_notification_prefs` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`dnd_until` integer,
	`quiet_start` text,
	`quiet_end` text,
	`quiet_allow_dms` integer DEFAULT false NOT NULL,
	`mention_keywords` text DEFAULT '[]' NOT NULL,
	`reactions_mode` text DEFAULT 'in-app' NOT NULL,
	`match_short_name` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE `conversation_state` ADD `notify_level` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `mentions_me` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_backlog` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_reply_to_me` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `messages_mentions_idx` ON `messages` (`connection_id`,`mentions_me`,`rx_time`);--> statement-breakpoint
-- Mute becomes the "none" notification level (CR-003 §4).
UPDATE `conversation_state` SET `notify_level` = 'none' WHERE `muted` = 1;
