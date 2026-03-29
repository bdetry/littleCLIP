import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  path: text("path"),
  command: text("command").notNull(),
  requirementsPath: text("requirements_path"),
  envVars: text("env_vars"),
  timeout: integer("timeout"),
  description: text("description"),
  bypassTick: integer("bypass_tick", { mode: "boolean" }).notNull().default(false),
  maxChainCallsPerMinute: integer("max_chain_calls_per_minute"),
  retriggerParent: integer("retrigger_parent", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "doing",
  "done",
  "error",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body"),
  status: text("status", { enum: TASK_STATUSES }).notNull().default("backlog"),
  agentId: text("agent_id").references(() => agents.id),
  output: text("output"),
  logs: text("logs"),
  cost: real("cost").notNull().default(0),
  durationMs: integer("duration_ms"),
  parentId: text("parent_id").references((): ReturnType<typeof text> => tasks.id),
  creatorAgentId: text("creator_agent_id").references(() => agents.id),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
