---
name: crafting-mas-agents
description: >-
  Build agents for the Kanban-based multi-agent orchestration system (MAS).
  Use when the user asks to create, modify, or debug an agent script, or when
  working inside the agents/ directory. Covers the AgentInput/AgentOutput
  contracts, execution lifecycle, and the required file structure.
---

# Crafting MAS Agents

## Architecture in 30 Seconds

This system is a Kanban-based multi-agent orchestrator. An **agent** is just an executable script (any language) that the orchestrator spawns as a child process. Communication is exclusively through:

1. **STDIN** -- the orchestrator writes a single UTF-8 JSON document conforming to `AgentInput` (avoids OS CLI argument length limits like Windows `ENAMETOOLONG` on long payloads). For local debugging you may still pass the same JSON as `process.argv[2]` (Node) or `sys.argv[1]` (Python) instead of stdin.
2. **STDOUT** -- the agent prints a JSON object conforming to `AgentOutput` as its last output.

Agents must never import or depend on any orchestrator code. They are fully isolated.

## The Two Contracts

These are the **only** touchpoints between agents and the orchestrator. Both are defined in `src/lib/types.ts`.

### AgentInput (what the agent receives)

```json
{
  "task_id": "ULID",
  "task_body": "The human or parent-agent instruction",
  "system_prompt": "Shared orchestration prompt from settings DB",
  "parent_context": [
    { "id": "...", "title": "...", "body": "...", "output": "...", "agent": "coordinator" }
  ],
  "child_tasks": [
    { "id": "...", "title": "...", "body": "...", "status": "done", "output": "...", "agent": "worker" }
  ],
  "sibling_tasks": [
    { "id": "...", "title": "...", "body": "...", "status": "done", "output": "...", "agent": "worker" }
  ],
  "available_agents": [
    { "name": "coordinator", "description": "High-level strategist" }
  ]
}
```

| Field | Type | Purpose |
|-------|------|---------|
| `task_id` | string | ULID of the current task |
| `task_body` | string | The task instructions |
| `system_prompt` | string | Shared system prompt (from settings DB) |
| `parent_context` | array | Ancestor task chain (nearest parent first, up to 10). Body and output may be truncated |
| `child_tasks` | array | Up to 20 most recent sub-tasks with their current status and output. Body and output may be truncated |
| `sibling_tasks` | array | Other tasks sharing the same parent (up to 20 most recent, excludes self). Use to avoid duplicate work or coordinate with peers |
| `available_agents` | array | All registered agents (name + description) |

### AgentOutput (what the agent must print to stdout)

```json
{
  "output": "Result summary or deliverable",
  "cost": 0.004,
  "status": "done",
  "next_tasks": [
    {
      "title": "Sub-task title",
      "body": "Detailed instructions",
      "agent": "agent_name or null",
      "status": "todo or backlog"
    }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `output` | string | yes | Summary visible to parent agents and humans |
| `cost` | number | no (default 0) | Incremental execution cost (e.g. LLM API cost). The orchestrator accumulates this across re-invocations |
| `status` | string | yes (LLM agents), no (scripts) | Task status after execution. Valid values: `"done"`, `"doing"`, `"error"`. Defaults to `"done"` if omitted. LLM-driven agents should always set this explicitly. `"doing"` keeps the task alive for re-invocation without children. When `next_tasks` are present the orchestrator overrides to `"doing"` |
| `next_tasks` | array | no | Sub-tasks to create. Omit or `[]` when done |
| `next_tasks[].title` | string | yes | Card title |
| `next_tasks[].body` | string | no | Detailed spec |
| `next_tasks[].agent` | string/null | no | Agent name to assign (must match `available_agents`) |
| `next_tasks[].status` | string | no | `"todo"` if agent assigned, `"backlog"` if null |

## Execution Lifecycle

```
todo ──▶ runner spawns agent ──▶ agent prints AgentOutput
                                       │
                          ┌─────────────┴─────────────┐
                     has next_tasks              no next_tasks
                          │                           │
                    stays "doing"          uses agent-provided status
                          │                  (default: "done")
              children execute...
                          │
              all children terminal
                          │
                  agent re-invoked ◀── with child_tasks populated
                          │
                   (loop continues until agent returns no next_tasks)
```

Key points:
- Returning `next_tasks` keeps the task in `"doing"` and triggers a re-invocation loop — the orchestrator overrides the agent's `status` to `"doing"` when children are present.
- When there are no `next_tasks`, the orchestrator uses the agent-provided `status` field. If omitted, it defaults to `"done"`.
- An agent can return `status: "error"` to mark its own failure even on exit code 0, or `status: "doing"` with no children to keep itself alive for external re-invocation on subsequent ticks.
- The agent is re-invoked with `child_tasks` populated once all sub-tasks reach a terminal state (`done` or `error`). If a child agent has **Retrigger Parent** enabled, re-invocation happens immediately; otherwise it occurs on the next scheduler tick.
- The agent **must** stop creating sub-tasks once the objective is met, or it loops forever.
- On re-invocation, `child_tasks` contains the results from previous sub-tasks.
- Incremental cost reported on each invocation is automatically summed by the runner (`totalCost = previousCost + incrementalCost`).

## Creating a New Agent

### 1. File structure

```
agents/
  your-agent/
    run.js          # or run.py, run.sh -- any executable
    package.json    # if Node.js (optional)
```

### 2. Minimal agent template (Node.js)

```javascript
async function readMasAgentInput() {
  const fromArg = process.argv[2];
  if (fromArg && fromArg !== "--stdin") return fromArg;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = (await readMasAgentInput()).trim();
  if (!raw) {
    console.error("[your-agent] No AgentInput JSON");
    process.exit(1);
  }

  const input = JSON.parse(raw);
  const { task_id, task_body, system_prompt, parent_context, child_tasks, sibling_tasks, available_agents } = input;

  // --- Your logic here ---

  const result = {
    output: "What this agent accomplished",
    cost: 0,
    status: "done",  // optional: "done" | "doing" | "error" (defaults to "done")
    // next_tasks: [] // optional: sub-tasks to delegate
  };

  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### 3. Minimal agent template (Python)

```python
import sys, json

def read_input():
    if len(sys.argv) > 1 and sys.argv[1] != "--stdin":
        return sys.argv[1]
    return sys.stdin.read()

def main():
    raw = read_input().strip()
    if not raw:
        print("[your-agent] No AgentInput JSON", file=sys.stderr)
        sys.exit(1)

    inp = json.loads(raw)
    task_body = inp["task_body"]
    child_tasks = inp.get("child_tasks", [])
    sibling_tasks = inp.get("sibling_tasks", [])
    available_agents = inp.get("available_agents", [])

    # --- Your logic here ---

    result = {
        "output": "What this agent accomplished",
        "cost": 0,
        "status": "done",  # optional: "done" | "doing" | "error" (defaults to "done")
        # "next_tasks": [] # optional: sub-tasks to delegate
    }

    print(json.dumps(result))

if __name__ == "__main__":
    main()
```

### 4. Register in the UI

Create the agent via the dashboard with:
- **Name**: lowercase, no spaces (e.g. `your-agent`). This is the name other agents use in `next_tasks[].agent`.
- **Command**: `node agents/your-agent/run.js` (or `python agents/your-agent/run.py`).
- **Path**: working directory for the process (project root by default).
- **Description**: one-line summary so other agents know when to assign tasks to this agent.
- **Bypass Tick** (optional): when enabled, child tasks assigned to this agent run immediately after creation instead of waiting for the next scheduler tick. Useful for fast-running agents in tight delegation chains.
- **Retrigger Parent** (optional): when enabled, completing all sibling tasks immediately re-invokes the parent task without waiting for the next scheduler tick.
- **Max Chain Calls / min** (optional): override the global rate limit for this specific agent (defaults to global setting).
- **Timeout** (optional): custom execution timeout in milliseconds (defaults to 60,000 ms / 60 seconds).
- **Environment Variables** (optional): JSON string of custom environment variables injected into `process.env` at spawn time.

## Rules for Agent Scripts

1. **Read AgentInput JSON from stdin** (or `argv[2]` / `argv[1]` for local debugging). The orchestrator always writes stdin; do not rely on argv alone for large payloads.
2. **Print the AgentOutput JSON as the last thing to stdout.** The orchestrator extracts the last valid JSON object from the full stdout stream using regex.
3. **Debug logs are fine** -- print whatever you want to stdout/stderr for debugging. The orchestrator only parses the last JSON object.
4. **Exit code 0** for success. Non-zero exit marks the task as `"error"`.
5. **Never import orchestrator code.** The agent is a standalone process. All context arrives via the JSON input.
6. **Environment variables** from the agent's `envVars` config are injected into `process.env` at spawn time. Use them for API keys. The `TASK_ID` env var is also injected automatically.
7. **Timeout** defaults to 60s. Configure per-agent in the DB if needed.
8. **Rate limiting**: the orchestrator enforces a chain-call limit (global default 10 calls/minute, or per-agent override via `maxChainCallsPerMinute`). When an agent is rate-limited, task execution is **deferred** (the task remains in `"todo"`) until the rolling 1-minute window clears, allowing workflows to proceed once capacity is available rather than failing the task.

## Handling Re-invocation (child_tasks)

When an agent creates sub-tasks and gets re-invoked after they complete:

```javascript
const { child_tasks } = input;

if (child_tasks?.length > 0) {
  const allDone = child_tasks.every(c => c.status === "done");
  const hasErrors = child_tasks.some(c => c.status === "error");

  if (hasErrors) {
    // Decide: retry, skip, or report error
  }

  if (allDone) {
    // Synthesize results from child_tasks[].output
    // Return final output with NO next_tasks to complete
  }
}
```

## Reference

- Contract types: `src/lib/types.ts` (AgentInput, AgentOutput, AgentNextTask, ChildTaskContext, ParentTaskContext, AvailableAgent)
- Task statuses: `backlog` → `todo` → `doing` → `done` | `error` (defined in `src/db/schema.ts` as `TASK_STATUSES`)
- Settings & System prompt: `src/lib/settings.ts` (DEFAULT_SYSTEM_PROMPT, max_chain_calls_per_minute, tick_interval_seconds)
- Runner logic: `src/lib/runner.ts` (spawn, STDIN/STDOUT parsing, rate limiting deferral, retriggerParent, bypassTick)
- Tick Engine & Watchdog: `src/lib/ticker.ts` (scheduler, watchdog recovery, concurrency lock)
- Server initialization: `src/instrumentation.ts` (Next.js server lifecycle register hook)

---

# Orchestrator Architecture & Development Standards

## Process Isolation & Zero Dependency
No physical link, shared code, or runtime dependency may exist between the orchestrator system and agents in the `/agents` folder.
- The orchestrator delivers input exclusively by writing a single UTF-8 JSON payload (`AgentInput`) to the child process's STDIN (avoids OS CLI argument length limits like Windows `ENAMETOOLONG`).
- The orchestrator reads output exclusively from the child process's STDOUT by extracting the LAST valid JSON object (`AgentOutput`).

## Minimalist Architecture Rules
- Use `node:child_process.spawn` with piped `stdio` (`['pipe', 'pipe', 'pipe']`) to allow real-time STDOUT streaming and STDIN payload delivery. Never use `exec`.
- All database state is managed via SQLite tables (`tasks`, `agents`, `settings`) through Drizzle ORM.
- Prioritize STDOUT parsing resilience: Agents may emit arbitrary logs; extract the last outermost JSON object matching `/({[\s\S]*})/g` and validate with Zod.
- Keep Next.js server actions focused: `createTask`, `updateTask`, `runTask`, `toggleTick`, `getTickState`.

## Core-Ledger: Professional Development Standards

### 1. Code Quality
- TypeScript for everything. No `any`.
- Follow a "Functional Core, Imperative Shell" pattern: Keep business and scheduling logic in pure functions; isolate side effects (DB, child process spawning, IPC) in dedicated service files (`runner.ts`, `ticker.ts`).
- Use Drizzle ORM with Zod schemas for all database and contract validation.

### 2. Execution Engine & Lifecycle
- **Process Spawning:** Always use `spawn` with an execution timeout (default 60 seconds per agent).
- **Rate Limiting:** Enforce per-agent call limits (`maxChainCallsPerMinute`, falling back to global project setting). When rate-limited, task execution is **deferred** (kept in `"todo"` for subsequent cycles) rather than aborted with an error.
- **Bypass Tick:** When enabled for an agent, tasks assigned to it run immediately upon creation instead of waiting for the scheduler tick.
- **Retrigger Parent:** When enabled for an agent, completing all sibling tasks immediately re-invokes the parent task when all siblings reach terminal status (`done` | `error`), enabling low-latency synchronous chains.
- **Cost Accumulation:** The runner maintains cumulative cost across repeated invocations (`totalCost = previousCost + incrementalCost`).

### 3. Tick Engine & Background Supervision
- **Server Lifecycle:** Start the `tickEngine` via Next.js `instrumentation.ts` (`register()` hook) on server initialization.
- **Watchdog Supervisor:** An active watchdog monitors scheduled ticks and automatically reschedules overdue cycles if timer drift or unhandled exceptions occur.
- **Live State Synchronization:** Expose tick state (`running`, `nextTickAt`) via server actions to support accurate, real-time client countdowns.

### 4. UI/UX Principles
- **Dev-Tool Aesthetic:** High density, dark mode, monospace fonts for logs, Shadcn/UI components.
- **Immediate Feedback:** Optimistic UI updates for task status changes and tick controls.
- **Execution Visibility:** Display real-time streamed logs, execution duration, accumulated cost, and error states directly on task cards.

