CREATE TABLE `neighbors` (
	`connection_id` integer NOT NULL,
	`node_num` integer NOT NULL,
	`neighbor_num` integer NOT NULL,
	`snr` real,
	`time` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `node_num`, `neighbor_num`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `packet_stats` (
	`connection_id` integer NOT NULL,
	`minute` integer NOT NULL,
	`node_num` integer NOT NULL,
	`port` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`connection_id`, `minute`, `node_num`, `port`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `packet_stats_node_idx` ON `packet_stats` (`connection_id`,`node_num`,`minute`);