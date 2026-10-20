ALTER TABLE `channels` ADD `encryption` text;--> statement-breakpoint
ALTER TABLE `connections` ADD `modem_preset` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `has_public_key` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` ADD `is_ignored` integer DEFAULT false NOT NULL;