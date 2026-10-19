CREATE TABLE `channels` (
	`connection_id` integer NOT NULL,
	`channel_index` integer NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`connection_id`, `channel_index`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`transport` text DEFAULT 'tcp' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` integer NOT NULL,
	`packet_id` integer NOT NULL,
	`from_num` integer NOT NULL,
	`to_num` integer NOT NULL,
	`peer` integer,
	`channel_index` integer NOT NULL,
	`text` text NOT NULL,
	`rx_time` integer NOT NULL,
	`direction` text NOT NULL,
	`status` text,
	`rx_snr` real,
	`rx_rssi` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_channel_idx` ON `messages` (`connection_id`,`channel_index`,`rx_time`);--> statement-breakpoint
CREATE INDEX `messages_peer_idx` ON `messages` (`connection_id`,`peer`,`rx_time`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`connection_id` integer NOT NULL,
	`num` integer NOT NULL,
	`long_name` text DEFAULT '' NOT NULL,
	`short_name` text DEFAULT '' NOT NULL,
	`hw_model` text,
	`role` text,
	`last_heard` integer,
	`snr` real,
	`hops_away` integer,
	`is_favorite` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`connection_id`, `num`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
