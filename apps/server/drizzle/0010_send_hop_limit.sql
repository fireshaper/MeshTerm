ALTER TABLE `connections` ADD `hop_limit` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `relayed` integer DEFAULT false NOT NULL;