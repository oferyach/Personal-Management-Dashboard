CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`owner_user_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`action` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "activity_log_resource_kind_chk" CHECK("resource_type" in ('event', 'task', 'project', 'asset', 'tag')),
	CONSTRAINT "activity_log_action_chk" CHECK("action" in ('created', 'updated', 'deleted', 'completed', 'reopened', 'progress_changed', 'tag_attached', 'tag_detached', 'metadata_changed', 'synchronized'))
);
--> statement-breakpoint
CREATE INDEX `activity_log_owner_time_idx` ON `activity_log` (`owner_user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `activity_log_actor_time_idx` ON `activity_log` (`actor_user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `activity_log_resource_idx` ON `activity_log` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `tag_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`linked_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tag_links_resource_kind_chk" CHECK("resource_type" in ('event', 'task', 'project', 'asset'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_links_unique_link` ON `tag_links` (`tag_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `tag_links_resource_idx` ON `tag_links` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `tag_links_owner_tag_idx` ON `tag_links` (`owner_user_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_owner_name_unique` ON `tags` (`owner_user_id`,`name_normalized`);--> statement-breakpoint
CREATE INDEX `tags_owner_created_idx` ON `tags` (`owner_user_id`,`created_at`);