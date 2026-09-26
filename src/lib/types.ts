import { z } from "zod/v4";
import { TASK_STATUSES } from "@/db/schema";

export const AgentNextTaskSchema = z.object({
  title: z.string(),
  body: z.string().optional(),
  agent: z.string().nullish(),
  status: z.enum(TASK_STATUSES).optional(),
});

export const AgentOutputSchema = z.object({
  output: z.string(),
  cost: z.number().default(0),
  status: z.enum(TASK_STATUSES).optional(),
  next_tasks: z.array(AgentNextTaskSchema).optional(),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;
export type AgentNextTask = z.infer<typeof AgentNextTaskSchema>;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface ParentTaskContext {
  id: string;
  title: string;
  body: string | null;
  output: string | null;
  agent: string | null;
}

export interface ChildTaskContext {
  id: string;
  title: string;
  body: string | null;
  status: string;
  output: string | null;
  agent: string | null;
}

export interface AvailableAgent {
  name: string;
  description: string;
}

export interface AgentInput {
  task_id: string;
  task_body: string;
  system_prompt: string;
  parent_context: ParentTaskContext[];
  child_tasks: ChildTaskContext[];
  sibling_tasks: ChildTaskContext[];
  available_agents: AvailableAgent[];
}

export interface CreateTaskInput {
  title: string;
  body?: string;
  status?: TaskStatus;
  agentId?: string;
  parentId?: string;
}

export interface UpdateTaskInput {
  title?: string;
  body?: string;
  status?: TaskStatus;
  agentId?: string | null;
  output?: string;
  logs?: string;
  cost?: number;
}

export interface CreateAgentInput {
  name: string;
  path: string;
  command: string;
  requirementsPath?: string;
  envVars?: string;
  timeout?: number;
  description?: string;
  bypassTick?: boolean;
  maxChainCallsPerMinute?: number | null;
  retriggerParent?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  path?: string;
  command?: string;
  requirementsPath?: string;
  envVars?: string;
  timeout?: number | null;
  description?: string;
  bypassTick?: boolean;
  maxChainCallsPerMinute?: number | null;
  retriggerParent?: boolean;
}
