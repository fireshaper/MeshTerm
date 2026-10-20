CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`time` integer NOT NULL,
	`kind` text NOT NULL,
	`node_num` integer,
	`message_id` text,
	`value` real,
	`detail` text,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_time_idx` ON `activity` (`connection_id`,`time`);--> statement-breakpoint
CREATE INDEX `messages_time_idx` ON `messages` (`connection_id`,`rx_time`,`direction`);