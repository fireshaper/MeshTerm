CREATE TABLE `conversation_state` (
	`connection_id` integer NOT NULL,
	`kind` text NOT NULL,
	`key` integer NOT NULL,
	`last_read_rx_time` integer DEFAULT 0 NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`deleted_before` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`connection_id`, `kind`, `key`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `messages_channel_idx`;--> statement-breakpoint
ALTER TABLE `messages` ADD `pki_encrypted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `via_mqtt` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `reply_id` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `emoji` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `hop_start` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `hop_limit` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `error_reason` text;--> statement-breakpoint
CREATE INDEX `messages_channel_idx` ON `messages` (`connection_id`,`channel_index`,`rx_time`) WHERE "messages"."peer" IS NULL;--> statement-breakpoint
-- A text our own node sent to someone (from another client on it) was stored as an
-- incoming DM with ourselves as the peer; it is an outgoing DM to `to_num`.
UPDATE `messages` SET `peer` = `to_num`, `direction` = 'out'
WHERE `peer` IS NOT NULL AND `peer` = `from_num`
  AND `from_num` = (SELECT `my_node_num` FROM `connections` WHERE `connections`.`id` = `messages`.`connection_id`);
