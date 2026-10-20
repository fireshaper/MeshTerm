CREATE TABLE `signal_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`node_num` integer NOT NULL,
	`time` integer NOT NULL,
	`snr` real,
	`rssi` integer,
	`hops` integer,
	`via_mqtt` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `signal_log_node_idx` ON `signal_log` (`connection_id`,`node_num`,`time`);--> statement-breakpoint
ALTER TABLE `connections` ADD `firmware` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `public_key` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `via_mqtt` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` ADD `first_seen` integer;--> statement-breakpoint
ALTER TABLE `telemetry` ADD `metrics` text;--> statement-breakpoint
-- Existing nodes: the earliest thing stored about them (else when last heard).
UPDATE `nodes` SET `first_seen` = (
  SELECT min(`t`) FROM (
    SELECT min(`time`) AS `t` FROM `telemetry` WHERE `telemetry`.`connection_id` = `nodes`.`connection_id` AND `telemetry`.`node_num` = `nodes`.`num`
    UNION ALL SELECT min(`rx_time`) FROM `positions` WHERE `positions`.`connection_id` = `nodes`.`connection_id` AND `positions`.`node_num` = `nodes`.`num`
    UNION ALL SELECT min(`rx_time`) FROM `messages` WHERE `messages`.`connection_id` = `nodes`.`connection_id` AND `messages`.`from_num` = `nodes`.`num`
    UNION ALL SELECT `nodes`.`last_heard`
  )
) WHERE `first_seen` IS NULL;
--> statement-breakpoint
-- New nodes: when MeshTerm stored them (wall clock, epoch ms).
CREATE TRIGGER `nodes_first_seen` AFTER INSERT ON `nodes` WHEN NEW.`first_seen` IS NULL
BEGIN
  UPDATE `nodes` SET `first_seen` = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE `connection_id` = NEW.`connection_id` AND `num` = NEW.`num`;
END;
