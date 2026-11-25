CREATE TABLE `event_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_participants_unique_participant` ON `event_participants` (`event_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `event_participants_user_idx` ON `event_participants` (`user_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `event_participants_event_idx` ON `event_participants` (`event_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Jerusalem' NOT NULL,
	`is_all_day` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'tentative' NOT NULL,
	`category` text,
	`color` text,
	`location` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "events_start_utc_chk" CHECK("start_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z' and length("start_at") between 21 and 32),
	CONSTRAINT "events_end_utc_chk" CHECK("end_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z' and length("end_at") between 21 and 32),
	CONSTRAINT "events_time_chk" CHECK("end_at" > "start_at"),
	CONSTRAINT "events_all_day_bounds_chk" CHECK("is_all_day" = 0 OR (substr("start_at", 12, 8) = '00:00:00' AND substr("end_at", 12, 8) = '00:00:00')),
	CONSTRAINT "events_status_chk" CHECK("status" in ('tentative', 'confirmed', 'cancelled')),
	CONSTRAINT "events_all_day_chk" CHECK("is_all_day" in (0, 1)),
	CONSTRAINT "events_title_chk" CHECK(length("title") between 1 and 300),
	CONSTRAINT "events_description_chk" CHECK("description" is null or length("description") <= 5000),
	CONSTRAINT "events_category_chk" CHECK("category" is null or length("category") between 1 and 60),
	CONSTRAINT "events_location_chk" CHECK("location" is null or length("location") <= 300),
	CONSTRAINT "events_color_chk" CHECK("color" is null or "color" glob '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),
	CONSTRAINT "events_timezone_chk" CHECK(length("timezone") between 1 and 64)
);
--> statement-breakpoint
CREATE INDEX `events_owner_start_idx` ON `events` (`owner_user_id`,`start_at`,`id`);--> statement-breakpoint
CREATE INDEX `events_owner_status_start_idx` ON `events` (`owner_user_id`,`status`,`start_at`);--> statement-breakpoint
CREATE INDEX `events_status_start_idx` ON `events` (`status`,`start_at`);