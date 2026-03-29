import { relations } from "drizzle-orm/relations";
import { agents, tasks } from "./schema";

export const tasksRelations = relations(tasks, ({one, many}) => ({
	agent_creatorAgentId: one(agents, {
		fields: [tasks.creatorAgentId],
		references: [agents.id],
		relationName: "tasks_creatorAgentId_agents_id"
	}),
	task: one(tasks, {
		fields: [tasks.parentId],
		references: [tasks.id],
		relationName: "tasks_parentId_tasks_id"
	}),
	tasks: many(tasks, {
		relationName: "tasks_parentId_tasks_id"
	}),
	agent_agentId: one(agents, {
		fields: [tasks.agentId],
		references: [agents.id],
		relationName: "tasks_agentId_agents_id"
	}),
}));

export const agentsRelations = relations(agents, ({many}) => ({
	tasks_creatorAgentId: many(tasks, {
		relationName: "tasks_creatorAgentId_agents_id"
	}),
	tasks_agentId: many(tasks, {
		relationName: "tasks_agentId_agents_id"
	}),
}));