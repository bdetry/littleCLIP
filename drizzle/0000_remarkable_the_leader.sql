CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`command` text NOT NULL,
	`requirements_path` text,
	`env_vars` text,
	`timeout` integer,
	`description` text,
	`bypass_tick` integer DEFAULT false NOT NULL,
	`max_chain_calls_per_minute` integer,
	`retrigger_parent` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_name_unique` ON `agents` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'backlog' NOT NULL,
	`agent_id` text,
	`output` text,
	`logs` text,
	`cost` real DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`parent_id` text,
	`creator_agent_id` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
