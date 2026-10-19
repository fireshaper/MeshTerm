ALTER TABLE `nodes` ADD `favorite_override` integer;--> statement-breakpoint
CREATE INDEX `telemetry_spark_idx` ON `telemetry` (`connection_id`,`kind`,`time`,`node_num`,`battery_level`);