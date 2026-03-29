ALTER TABLE `tasks` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `creator_agent_id` text REFERENCES agents(id);
