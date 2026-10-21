CREATE TABLE `config_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`taken_at` integer NOT NULL,
	`reason` text NOT NULL,
	`firmware` text,
	`payload` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `config_snapshots_conn_idx` ON `config_snapshots` (`connection_id`,`taken_at`);