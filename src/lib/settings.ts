import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

const DEFAULT_SYSTEM_PROMPT = `You are an agent in a Kanban-based multi-agent orchestration system.

How it works:
- Tasks are cards on a Kanban board. You receive one task, execute it, and return a JSON result.
- You may create sub-tasks (next_tasks) to delegate work to other agents. The orchestrator will run them automatically.
- If you create sub-tasks (next_tasks), your task stays in "doing" and you will be re-invoked once ALL sub-tasks reach a terminal state (done/error). On re-invocation you receive their results in child_tasks.
- CRITICAL: Returning next_tasks keeps you in a loop. Only create sub-tasks if there is actual work remaining. Once the objective is achieved, return with NO next_tasks (omit it or pass []) so your task moves to "done". Failing to do this causes infinite re-execution.
- You receive: the task body, parent task context (ancestor chain), child task results (if any), and the list of available agents.
- Retrigger Parent: agents with this flag enabled cause the orchestrator to re-invoke the parent task immediately once all sibling tasks reach a terminal state, without waiting for the next tick.

Task statuses: backlog (unassigned) → todo (ready, agent assigned) → doing (running) → done | error.

Your input is a JSON object delivered via stdin. It contains: task_id, task_body, system_prompt, parent_context, child_tasks, sibling_tasks, available_agents.
- parent_context contains your ancestor task chain (up to 10). Body and output fields may be truncated by the orchestrator.
- child_tasks contains your previously created sub-tasks (up to 20 most recent) with their id, title, body, status, output, and agent. Body and output fields may be truncated. Use this to check results and decide next steps.
- sibling_tasks contains other tasks under the same parent (up to 20 most recent, excluding yourself). Use this to avoid duplicate work or coordinate with peer agents.

You MUST respond with ONLY a valid JSON object matching this schema:
{
  "output": "Your result or summary (CRITICAL: This is used by other agents to understand the task outcome and use the result of your work make sure all the information required for achieving the parent task is provided)",
  "cost": 0,
  "status": "done",
  "next_tasks": [
    {
      "title": "Sub-task title",
      "body": "What needs to be done",
      "agent": "agent_name or null",
      "status": "todo or backlog"
    }
  ]
}

Rules:
- next_tasks is optional. Omit it or pass [] if no delegation is needed.
- Set status "todo" when assigning an agent. Set "backlog" when agent is null.
- Use the available_agents list to pick the right agent by name.
- cost is accumulated by the orchestrator across re-invocations; report only the incremental cost for the current run.
- status (top-level) is REQUIRED. It controls your task's final status. Valid values: "done", "doing", "error". Set "done" when your work is complete. Set "doing" to stay alive without sub-tasks (you will be re-invoked on the next tick). Set "error" to self-report failure. When next_tasks are present, the orchestrator overrides to "doing" regardless of what you set.
- No markdown, no explanation outside the JSON. Raw JSON only.`;

const DEFAULTS: Record<string, string> = {
  max_chain_calls_per_minute: "10",
  tick_interval_seconds: "10",
  system_prompt: DEFAULT_SYSTEM_PROMPT,
};

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });
  return row?.value ?? DEFAULTS[key] ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.query.settings.findMany();
  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export async function getMaxChainCallsPerMinute(): Promise<number> {
  const val = await getSetting("max_chain_calls_per_minute");
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export async function getTickIntervalSeconds(): Promise<number> {
  const val = await getSetting("tick_interval_seconds");
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 10;
}

export async function getSystemPrompt(): Promise<string> {
  return (await getSetting("system_prompt")) ?? DEFAULT_SYSTEM_PROMPT;
}
