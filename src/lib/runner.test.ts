import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import {
  fixtureEnv,
  getChildren,
  getTask,
  insertAgent,
  insertTask,
  resetDb,
  sleep,
  waitForDone,
  waitUntil,
} from "../../test/db-helpers";
import { taskEventBus, type TaskChangedEvent } from "./event-bus";
import { setSetting } from "./settings";
import { TaskRunner } from "./runner";
import type { AgentInput } from "./types";

vi.mock("@/db");

interface EchoPayload {
  input: AgentInput;
  env: Record<string, string | undefined>;
}

function parseEcho(output: string | null): EchoPayload {
  if (!output) throw new Error("task output is empty");
  return JSON.parse(output) as EchoPayload;
}

function agentOutput(obj: Record<string, unknown>): string {
  return fixtureEnv({ FIXTURE_STDOUT: JSON.stringify(obj) });
}

let runner: TaskRunner;

beforeEach(async () => {
  await resetDb();
  runner = new TaskRunner();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("run(): happy path", () => {
  it("executes the agent and persists output, cost, duration and logs", async () => {
    const agent = await insertAgent();
    const task = await insertTask({ status: "todo", agentId: agent.id, body: "do it" });

    const changed: TaskChangedEvent[] = [];
    const offChanged = taskEventBus.onTaskChanged((e) => {
      if (e.taskId === task.id) changed.push(e);
    });
    const done = waitForDone(taskEventBus, task.id);

    await runner.run(task.id);
    offChanged();

    const row = await getTask(task.id);
    expect(row?.status).toBe("done");
    expect(row?.cost).toBe(1);
    expect(row?.durationMs).toBeGreaterThanOrEqual(0);
    expect(row?.logs).toContain("[fixture] starting");
    expect(parseEcho(row?.output ?? null).input.task_body).toBe("do it");

    expect(await done).toBe("done");
    expect(changed.map((e) => e.status)).toEqual(["doing", "done"]);
  });
});

describe("run(): AgentInput contents", () => {
  it("passes task_id, task_body, system_prompt, TASK_ID env and agent envVars", async () => {
    await setSetting("system_prompt", "custom system prompt");
    const agent = await insertAgent();
    const custom = await insertAgent({ envVars: JSON.stringify({ FIXTURE_CUSTOM: "hello" }) });
    const task = await insertTask({ status: "todo", agentId: custom.id, body: "body text" });

    await runner.run(task.id);

    const echo = parseEcho((await getTask(task.id))?.output ?? null);
    expect(echo.input.task_id).toBe(task.id);
    expect(echo.input.task_body).toBe("body text");
    expect(echo.input.system_prompt).toBe("custom system prompt");
    expect(echo.env.TASK_ID).toBe(task.id);
    expect(echo.env.FIXTURE_CUSTOM).toBe("hello");
    expect(echo.input.available_agents.map((a) => a.name)).toContain(agent.name);
  });

  it("uses an empty task_body when body is null", async () => {
    const agent = await insertAgent();
    const task = await insertTask({ status: "todo", agentId: agent.id, body: null });
    await runner.run(task.id);
    expect(parseEcho((await getTask(task.id))?.output ?? null).input.task_body).toBe("");
  });

  it("still runs when agent envVars is invalid JSON", async () => {
    const agent = await insertAgent({ envVars: "{not json" });
    const task = await insertTask({ status: "todo", agentId: agent.id });
    await runner.run(task.id);
    expect((await getTask(task.id))?.status).toBe("done");
  });

  it("lists every agent in available_agents with description defaulting to empty string", async () => {
    const a = await insertAgent({ description: "does A" });
    const b = await insertAgent({ description: null });
    const task = await insertTask({ status: "todo", agentId: a.id });

    await runner.run(task.id);

    const echo = parseEcho((await getTask(task.id))?.output ?? null);
    expect(echo.input.available_agents).toEqual(
      expect.arrayContaining([
        { name: a.name, description: "does A" },
        { name: b.name, description: "" },
      ]),
    );
    expect(echo.input.available_agents).toHaveLength(2);
  });

  it("builds parent_context nearest-first, capped at 10 ancestors, with body/output truncation", async () => {
    const agent = await insertAgent();
    let parentId: string | null = null;
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const t = await insertTask({
        title: `ancestor-${i}`,
        status: "doing",
        agentId: agent.id,
        parentId,
        body: "b".repeat(600),
        output: "o".repeat(1200),
      });
      ids.push(t.id);
      parentId = t.id;
    }
    const leaf = await insertTask({ status: "todo", agentId: agent.id, parentId });

    await runner.run(leaf.id);

    const ctx = parseEcho((await getTask(leaf.id))?.output ?? null).input.parent_context;
    expect(ctx).toHaveLength(10);
    expect(ctx[0].id).toBe(ids[11]);
    expect(ctx[0].title).toBe("ancestor-11");
    expect(ctx[9].id).toBe(ids[2]);
    expect(ctx[0].body).toHaveLength(500);
    expect(ctx[0].output).toHaveLength(1000);
    expect(ctx[0].agent).toBe(agent.name);
  });

  it("returns an empty parent_context for a root task", async () => {
    const agent = await insertAgent();
    const task = await insertTask({ status: "todo", agentId: agent.id });
    await runner.run(task.id);
    const echo = parseEcho((await getTask(task.id))?.output ?? null);
    expect(echo.input.parent_context).toEqual([]);
    expect(echo.input.sibling_tasks).toEqual([]);
  });

  it("builds child_tasks from the 20 most recent children with truncation", async () => {
    const agent = await insertAgent();
    const childAgent = await insertAgent({ name: "child-agent" });
    const task = await insertTask({ status: "doing", agentId: agent.id });
    for (let i = 1; i <= 22; i++) {
      await insertTask({
        id: `child-${String(i).padStart(2, "0")}`,
        title: `child ${i}`,
        status: "done",
        parentId: task.id,
        agentId: childAgent.id,
        body: "b".repeat(500),
        output: "o".repeat(900),
      });
    }

    await runner.run(task.id);

    const children = parseEcho((await getTask(task.id))?.output ?? null).input.child_tasks;
    expect(children).toHaveLength(20);
    expect(children[0].id).toBe("child-03");
    expect(children[19].id).toBe("child-22");
    expect(children[0].body).toHaveLength(400);
    expect(children[0].output).toHaveLength(800);
    expect(children[0].status).toBe("done");
    expect(children[0].agent).toBe("child-agent");
  });

  it("builds sibling_tasks from tasks under the same parent, excluding itself", async () => {
    const agent = await insertAgent();
    const parent = await insertTask({ status: "doing", agentId: agent.id });
    const me = await insertTask({ status: "todo", agentId: agent.id, parentId: parent.id });
    const sib1 = await insertTask({ status: "done", parentId: parent.id, output: "sib1 out" });
    const sib2 = await insertTask({ status: "todo", agentId: agent.id, parentId: parent.id });

    await runner.run(me.id);

    const sibs = parseEcho((await getTask(me.id))?.output ?? null).input.sibling_tasks;
    const sibIds = sibs.map((s) => s.id).sort();
    expect(sibIds).toEqual([sib1.id, sib2.id].sort());
    expect(sibs.find((s) => s.id === sib1.id)).toMatchObject({ output: "sib1 out", agent: null });
    expect(sibs.find((s) => s.id === sib2.id)).toMatchObject({ agent: agent.name });
  });
});

describe("run(): status resolution", () => {
  it("defaults to done when the agent omits status", async () => {
    const agent = await insertAgent({ envVars: agentOutput({ output: "x" }) });
    const task = await insertTask({ status: "todo", agentId: agent.id });
    await runner.run(task.id);
    expect((await getTask(task.id))?.status).toBe("done");
  });

  it("keeps the task doing when the agent returns status doing without children", async () => {
    const agent = await insertAgent({ envVars: agentOutput({ output: "x", status: "doing" }) });
    const task = await insertTask({ status: "todo", agentId: agent.id });

    let doneFired = false;
    taskEventBus.onDone(task.id, () => {
      doneFired = true;
    });

    await runner.run(task.id);

    expect((await getTask(task.id))?.status).toBe("doing");
    expect(doneFired).toBe(false);
    taskEventBus.cleanup(task.id);
  });

  it("marks the task error when the agent self-reports status error on exit 0", async () => {
    const agent = await insertAgent({ envVars: agentOutput({ output: "failed", status: "error" }) });
    const task = await insertTask({ status: "todo", agentId: agent.id });
    const done = waitForDone(taskEventBus, task.id);

    await runner.run(task.id);

    expect((await getTask(task.id))?.status).toBe("error");
    expect((await getTask(task.id))?.output).toBe("failed");
    expect(await done).toBe("error");
  });

  it("forces doing when next_tasks are present, regardless of agent status", async () => {
    const agent = await insertAgent({
      envVars: agentOutput({ output: "x", status: "done", next_tasks: [{ title: "sub" }] }),
    });
    const task = await insertTask({ status: "todo", agentId: agent.id });
    await runner.run(task.id);
    expect((await getTask(task.id))?.status).toBe("doing");
  });
});

describe("run(): cost accumulation", () => {
  it("adds the incremental cost to the previous cost", async () => {
    const agent = await insertAgent({ envVars: agentOutput({ output: "x", cost: 0.5 }) });
    const task = await insertTask({ status: "todo", agentId: agent.id, cost: 2 });
    await runner.run(task.id);
    expect((await getTask(task.id))?.cost).toBe(2.5);
  });

  it("treats a missing cost as 0", async () => {
    const agent = await insertAgent({ envVars: agentOutput({ output: "x" }) });
    const task = await insertTask({ status: "todo", agentId: agent.id, cost: 3 });
    await runner.run(task.id);
    expect((await getTask(task.id))?.cost).toBe(3);
  });
});

describe("run(): chaining next_tasks", () => {
  it("inserts children with parentId, creatorAgentId, resolved agent and status", async () => {
    const worker = await insertAgent({ name: "worker" });
    const coordinator = await insertAgent({
      name: "coordinator",
      envVars: agentOutput({
        output: "delegating",
        next_tasks: [
          { title: "known agent, explicit todo", body: "b1", agent: "worker", status: "todo" },
          { title: "unknown agent", agent: "ghost" },
          { title: "no agent, default status" },
        ],
      }),
    });
    const task = await insertTask({ status: "todo", agentId: coordinator.id });

    await runner.run(task.id);

    const children = await getChildren(task.id);
    expect(children).toHaveLength(3);
    for (const c of children) {
      expect(c.parentId).toBe(task.id);
      expect(c.creatorAgentId).toBe(coordinator.id);
    }
    const known = children.find((c) => c.title === "known agent, explicit todo");
    expect(known).toMatchObject({ agentId: worker.id, status: "todo", body: "b1" });
    const unknown = children.find((c) => c.title === "unknown agent");
    expect(unknown).toMatchObject({ agentId: null, status: "backlog" });
    const noAgent = children.find((c) => c.title === "no agent, default status");
    expect(noAgent).toMatchObject({ agentId: null, status: "backlog", body: null });
  });

  it("does not run a todo child immediately when its agent has bypassTick disabled", async () => {
    await insertAgent({ name: "worker", bypassTick: false });
    const coordinator = await insertAgent({
      envVars: agentOutput({ output: "x", next_tasks: [{ title: "sub", agent: "worker", status: "todo" }] }),
    });
    const task = await insertTask({ status: "todo", agentId: coordinator.id });

    await runner.run(task.id);
    await sleep(500);

    const [child] = await getChildren(task.id);
    expect(child.status).toBe("todo");
    expect(child.output).toBeNull();
  });

  it("runs a todo child immediately when its agent has bypassTick enabled", async () => {
    await insertAgent({ name: "worker", bypassTick: true });
    const coordinator = await insertAgent({
      envVars: agentOutput({ output: "x", next_tasks: [{ title: "sub", agent: "worker", status: "todo" }] }),
    });
    const task = await insertTask({ status: "todo", agentId: coordinator.id });

    await runner.run(task.id);

    const child = await waitUntil(async () => {
      const [c] = await getChildren(task.id);
      return c && c.status === "done" ? c : null;
    });
    expect(parseEcho(child.output).input.task_id).toBe(child.id);
    expect(parseEcho(child.output).input.parent_context[0].id).toBe(task.id);
  });

  it("does not bypass tick for a backlog child even if the agent has bypassTick enabled", async () => {
    await insertAgent({ name: "worker", bypassTick: true });
    const coordinator = await insertAgent({
      envVars: agentOutput({ output: "x", next_tasks: [{ title: "sub", agent: "worker", status: "backlog" }] }),
    });
    const task = await insertTask({ status: "todo", agentId: coordinator.id });

    await runner.run(task.id);
    await sleep(500);

    const [child] = await getChildren(task.id);
    expect(child.status).toBe("backlog");
  });
});

describe("run(): retrigger parent", () => {
  it("re-runs the doing parent immediately once all siblings are terminal", async () => {
    const parentAgent = await insertAgent({ envVars: agentOutput({ output: "parent finished" }) });
    const childAgent = await insertAgent({ retriggerParent: true });
    const parent = await insertTask({ status: "doing", agentId: parentAgent.id });
    await insertTask({ status: "done", parentId: parent.id });
    const child = await insertTask({ status: "todo", agentId: childAgent.id, parentId: parent.id });

    const parentDone = waitForDone(taskEventBus, parent.id);
    await runner.run(child.id);

    expect(await parentDone).toBe("done");
    expect((await getTask(parent.id))?.output).toBe("parent finished");
  });

  it("also retriggers when the child ends in error", async () => {
    const parentAgent = await insertAgent({ envVars: agentOutput({ output: "parent finished" }) });
    const childAgent = await insertAgent({
      retriggerParent: true,
      envVars: fixtureEnv({ FIXTURE_EXIT_CODE: "1" }),
    });
    const parent = await insertTask({ status: "doing", agentId: parentAgent.id });
    const child = await insertTask({ status: "todo", agentId: childAgent.id, parentId: parent.id });

    const parentDone = waitForDone(taskEventBus, parent.id);
    await runner.run(child.id);

    expect((await getTask(child.id))?.status).toBe("error");
    expect(await parentDone).toBe("done");
  });

  it("does not retrigger while a sibling is still pending", async () => {
    const parentAgent = await insertAgent();
    const childAgent = await insertAgent({ retriggerParent: true });
    const parent = await insertTask({ status: "doing", agentId: parentAgent.id });
    await insertTask({ status: "todo", agentId: childAgent.id, parentId: parent.id });
    const child = await insertTask({ status: "todo", agentId: childAgent.id, parentId: parent.id });

    await runner.run(child.id);
    await sleep(500);

    const row = await getTask(parent.id);
    expect(row?.status).toBe("doing");
    expect(row?.output).toBeNull();
  });

  it("does not retrigger when the child agent has retriggerParent disabled", async () => {
    const parentAgent = await insertAgent();
    const childAgent = await insertAgent({ retriggerParent: false });
    const parent = await insertTask({ status: "doing", agentId: parentAgent.id });
    const child = await insertTask({ status: "todo", agentId: childAgent.id, parentId: parent.id });

    await runner.run(child.id);
    await sleep(500);

    expect((await getTask(parent.id))?.output).toBeNull();
  });

  it("does not retrigger a parent that is not in doing", async () => {
    const parentAgent = await insertAgent();
    const childAgent = await insertAgent({ retriggerParent: true });
    const parent = await insertTask({ status: "done", agentId: parentAgent.id });
    const child = await insertTask({ status: "todo", agentId: childAgent.id, parentId: parent.id });

    await runner.run(child.id);
    await sleep(500);

    expect((await getTask(parent.id))?.output).toBeNull();
  });
});

describe("run(): rate limiting", () => {
  it("defers the task (stays todo) when the agent limit is reached", async () => {
    const agent = await insertAgent({ maxChainCallsPerMinute: 1 });
    const first = await insertTask({ status: "todo", agentId: agent.id });
    const second = await insertTask({ status: "todo", agentId: agent.id });

    await runner.run(first.id);
    await runner.run(second.id);

    expect((await getTask(first.id))?.status).toBe("done");
    expect((await getTask(second.id))?.status).toBe("todo");
    expect((await getTask(second.id))?.logs).toBeNull();
  });

  it("falls back to the project-wide limit when the agent has none", async () => {
    await setSetting("max_chain_calls_per_minute", "1");
    const agent = await insertAgent({ maxChainCallsPerMinute: null });
    const first = await insertTask({ status: "todo", agentId: agent.id });
    const second = await insertTask({ status: "todo", agentId: agent.id });

    await runner.run(first.id);
    await runner.run(second.id);

    expect((await getTask(first.id))?.status).toBe("done");
    expect((await getTask(second.id))?.status).toBe("todo");
  });

  it("agent limit overrides a stricter project limit", async () => {
    await setSetting("max_chain_calls_per_minute", "1");
    const agent = await insertAgent({ maxChainCallsPerMinute: 5 });
    const first = await insertTask({ status: "todo", agentId: agent.id });
    const second = await insertTask({ status: "todo", agentId: agent.id });

    await runner.run(first.id);
    await runner.run(second.id);

    expect((await getTask(second.id))?.status).toBe("done");
  });

  it("is tracked per agent", async () => {
    const a = await insertAgent({ maxChainCallsPerMinute: 1 });
    const b = await insertAgent({ maxChainCallsPerMinute: 1 });
    const ta = await insertTask({ status: "todo", agentId: a.id });
    const tb = await insertTask({ status: "todo", agentId: b.id });

    await runner.run(ta.id);
    await runner.run(tb.id);

    expect((await getTask(ta.id))?.status).toBe("done");
    expect((await getTask(tb.id))?.status).toBe("done");
  });

  it("releases the limit once the 60s window has elapsed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const agent = await insertAgent({ maxChainCallsPerMinute: 1 });
    const first = await insertTask({ status: "todo", agentId: agent.id });
    const second = await insertTask({ status: "todo", agentId: agent.id });

    await runner.run(first.id);
    await runner.run(second.id);
    expect((await getTask(second.id))?.status).toBe("todo");

    vi.setSystemTime(Date.now() + 61_000);
    await runner.run(second.id);

    expect((await getTask(second.id))?.status).toBe("done");
  });
});

describe("run(): failure paths", () => {
  it("marks error on non-zero exit and appends stderr to logs", async () => {
    const agent = await insertAgent({
      envVars: fixtureEnv({ FIXTURE_EXIT_CODE: "2", FIXTURE_STDERR: "something broke" }),
    });
    const task = await insertTask({ status: "todo", agentId: agent.id });
    const done = waitForDone(taskEventBus, task.id);

    await runner.run(task.id);

    const row = await getTask(task.id);
    expect(row?.status).toBe("error");
    expect(row?.logs).toContain("--- STDERR ---");
    expect(row?.logs).toContain("something broke");
    expect(row?.output).toBeNull();
    expect(await done).toBe("error");
  });

  it("marks error when stdout has no valid AgentOutput JSON", async () => {
    const agent = await insertAgent({ envVars: fixtureEnv({ FIXTURE_STDOUT: "just some text" }) });
    const task = await insertTask({ status: "todo", agentId: agent.id });

    await runner.run(task.id);

    const row = await getTask(task.id);
    expect(row?.status).toBe("error");
    expect(row?.logs).toContain("[system] Failed to parse agent JSON output.");
    expect(row?.output).toBe("[fixture] starting\njust some text");
  });

  it("marks error when the JSON does not match the AgentOutput schema", async () => {
    const agent = await insertAgent({ envVars: agentOutput({ result: "missing output field" }) });
    const task = await insertTask({ status: "todo", agentId: agent.id });

    await runner.run(task.id);

    expect((await getTask(task.id))?.status).toBe("error");
  });

  it("marks error when the agent exceeds its timeout", async () => {
    const agent = await insertAgent({ timeout: 300, envVars: fixtureEnv({ FIXTURE_DELAY_MS: "5000" }) });
    const task = await insertTask({ status: "todo", agentId: agent.id });

    await runner.run(task.id);

    const row = await getTask(task.id);
    expect(row?.status).toBe("error");
    expect(row?.durationMs).toBeGreaterThanOrEqual(250);
    expect(row?.durationMs).toBeLessThan(4000);
  });

  it("appends a re-execution separator to logs on subsequent runs", async () => {
    const agent = await insertAgent({ envVars: agentOutput({ output: "x", status: "doing" }) });
    const task = await insertTask({ status: "todo", agentId: agent.id });

    await runner.run(task.id);
    const firstLogs = (await getTask(task.id))?.logs ?? "";
    await runner.run(task.id);

    const row = await getTask(task.id);
    expect(row?.logs).toContain("═══ Re-execution");
    expect(row?.logs?.startsWith(firstLogs)).toBe(true);
  });
});

describe("run(): guards", () => {
  it("throws for an unknown task", async () => {
    await expect(runner.run("nope")).rejects.toThrow("Task nope not found");
  });

  it("throws for a task without agent", async () => {
    const task = await insertTask({ status: "todo", agentId: null });
    await expect(runner.run(task.id)).rejects.toThrow("has no agent assigned");
  });

  it("throws when the assigned agent no longer exists", async () => {
    const agent = await insertAgent();
    const task = await insertTask({ status: "todo", agentId: agent.id });
    // Point the task at an agent id that does not exist (FK check bypassed on purpose).
    await db.run(sql`PRAGMA foreign_keys = OFF`);
    await db.update(tasks).set({ agentId: "ghost" }).where(eq(tasks.id, task.id));
    await db.run(sql`PRAGMA foreign_keys = ON`);

    await expect(runner.run(task.id)).rejects.toThrow("Agent ghost not found");
  });

  it("skips a task that is already done without touching it", async () => {
    const agent = await insertAgent();
    const task = await insertTask({ status: "done", agentId: agent.id, output: "kept" });

    await runner.run(task.id);

    const row = await getTask(task.id);
    expect(row?.status).toBe("done");
    expect(row?.output).toBe("kept");
    expect(row?.logs).toBeNull();
  });
});
