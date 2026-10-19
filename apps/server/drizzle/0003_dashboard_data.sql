CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`node_num` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`altitude` integer,
	`precision_bits` integer,
	`time` integer NOT NULL,
	`rx_time` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_node_time_idx` ON `positions` (`connection_id`,`node_num`,`time`);--> statement-breakpoint
CREATE TABLE `telemetry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`node_num` integer NOT NULL,
	`kind` text NOT NULL,
	`time` integer NOT NULL,
	`battery_level` integer,
	`voltage` real,
	`channel_util` real,
	`air_util_tx` real,
	`uptime_seconds` integer,
	`temperature` real,
	`humidity` real,
	`pressure` real,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telemetry_node_time_idx` ON `telemetry` (`connection_id`,`node_num`,`kind`,`time`);--> statement-breakpoint
ALTER TABLE `connections` ADD `last_packet_at` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `rssi` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `lat` real;--> statement-breakpoint
ALTER TABLE `nodes` ADD `lon` real;--> statement-breakpoint
ALTER TABLE `nodes` ADD `altitude` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `precision_bits` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `position_time` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `battery_level` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `voltage` real;--> statement-breakpoint
ALTER TABLE `nodes` ADD `channel_util` real;--> statement-breakpoint
ALTER TABLE `nodes` ADD `air_util_tx` real;--> statement-breakpoint
ALTER TABLE `nodes` ADD `uptime_seconds` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `device_time` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `temperature` real;--> statement-breakpoint
ALTER TABLE `nodes` ADD `humidity` real;--> statement-breakpoint
ALTER TABLE `nodes` ADD `pressure` real;--> statement-breakpoint
ALTER TABLE `nodes` ADD `env_time` integer;