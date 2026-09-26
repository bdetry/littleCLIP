import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { taskRunner } from "@/lib/runner";
import { getTask, insertAgent, insertTask, resetDb } from "../../test/db-helpers";
import {
  archiveTask,
  createTask,
  getCostData,
  getMonitoringStats,
  getTasks,
  getTasksPaginated,
  getTasksWithLogsPaginated,
  runTask,
  updateTask,
} from "./actions";

vi.mock("@/db");
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/runner", () => ({
  taskRunner: { run: vi.fn().mockResolvedValue(undefined) },
}));

const runMock = vi.mocked(taskRunner.run);
const revalidateMock = vi.mocked(revalidatePath);

/** Whole-second Date: the `timestamp` columns are stored with second precision. */
function at(iso: string): Date {
  return new Date(iso);
}

const ALL_PATHS = ["/", "/agents", "/logs", "/costs"];

beforeEach(async () => {
  await resetDb();
  runMock.mockReset();
  runMock.mockResolvedValue(undefined);
  revalidateMock.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createTask", () => {
  it("defaults to backlog with null fields when no agent is given", async () => {
    const { id } = await createTask({ title: "t" });

    const row = await getTask(id);
    expect(row).toMatchObject({
      title: "t",
      status: "backlog",
      agentId: null,
      body: null,
      parentId: null,
      cost: 0,
    });
  });

  it("defaults to todo when an agent is given", async () => {
    const agent = await insertAgent();
    const { id } = await createTask({ title: "t", agentId: agent.id });
    expect((await getTask(id))?.status).toBe("todo");
  });

  it("respects an explicit status over the derived one", async () => {
    const agent = await insertAgent();
    const { id } = await createTask({ title: "t", agentId: agent.id, status: "backlog" });
    expect((await getTask(id))?.status).toBe("backlog");
  });

  it("persists body and parentId", async () => {
    const parent = await insertTask();
    const { id } = await createTask({ title: "child", body: "details", parentId: parent.id });
    expect(await getTask(id)).toMatchObject({ body: "details", parentId: parent.id });
  });

  it("runs the task immediately when the agent has bypassTick enabled", async () => {
    const agent = await insertAgent({ bypassTick: true });
    const { id } = await createTask({ title: "t", agentId: agent.id });

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(id);
  });

  it("does not run immediately when bypassTick is disabled", async () => {
    const agent = await insertAgent({ bypassTick: false });
    await createTask({ title: "t", agentId: agent.id });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("does not run immediately when bypassTick is enabled but status is forced to backlog", async () => {
    const agent = await insertAgent({ bypassTick: true });
    await createTask({ title: "t", agentId: agent.id, status: "backlog" });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("does not run immediately when no agent is assigned", async () => {
    await createTask({ title: "t", status: "todo" });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("revalidates every board path", async () => {
    await createTask({ title: "t" });
    const paths = revalidateMock.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(ALL_PATHS);
  });
});

describe("updateTask", () => {
  it("updates provided fields, keeps the rest and bumps updatedAt", async () => {
    const task = await insertTask({
      title: "old",
      body: "keep me",
      status: "todo",
      updatedAt: at("2020-01-01T00:00:00Z"),
    });

    const result = await updateTask(task.id, { title: "new", status: "done" });

    const row = await getTask(task.id);
    expect(result).toEqual({ id: task.id });
    expect(row).toMatchObject({ title: "new", status: "done", body: "keep me" });
    expect(row!.updatedAt.getTime()).toBeGreaterThan(at("2020-01-01T00:00:00Z").getTime());
    expect(revalidateMock.mock.calls.map((c) => c[0])).toEqual(ALL_PATHS);
  });
});

describe("archiveTask / getTasks / getTasksPaginated", () => {
  it("archiveTask sets archivedAt and updatedAt", async () => {
    const task = await insertTask({ updatedAt: at("2020-01-01T00:00:00Z") });

    await archiveTask(task.id);

    const row = await getTask(task.id);
    expect(row?.archivedAt).toBeInstanceOf(Date);
    expect(row!.updatedAt.getTime()).toBeGreaterThan(at("2020-01-01T00:00:00Z").getTime());
    expect(revalidateMock.mock.calls.map((c) => c[0])).toEqual(ALL_PATHS);
  });

  it("getTasks excludes archived rows and orders by updatedAt desc", async () => {
    const oldest = await insertTask({ title: "oldest", updatedAt: at("2026-01-01T00:00:00Z") });
    const newest = await insertTask({ title: "newest", updatedAt: at("2026-01-03T00:00:00Z") });
    const middle = await insertTask({ title: "middle", updatedAt: at("2026-01-02T00:00:00Z") });
    await insertTask({ title: "archived", updatedAt: at("2026-01-04T00:00:00Z"), archivedAt: new Date() });

    const rows = await getTasks();

    expect(rows.map((r) => r.id)).toEqual([newest.id, middle.id, oldest.id]);
  });

  it("getTasksPaginated counts only non-archived rows and computes hasMore", async () => {
    for (let i = 0; i < 5; i++) {
      await insertTask({ title: `t${i}`, updatedAt: at(`2026-01-0${i + 1}T00:00:00Z`) });
    }
    await insertTask({ title: "archived", archivedAt: new Date() });

    const page1 = await getTasksPaginated(0, 2);
    expect(page1.total).toBe(5);
    expect(page1.tasks).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.tasks.map((t) => t.title)).toEqual(["t4", "t3"]);

    const page2 = await getTasksPaginated(2, 2);
    expect(page2.tasks.map((t) => t.title)).toEqual(["t2", "t1"]);
    expect(page2.hasMore).toBe(true);

    const page3 = await getTasksPaginated(4, 2);
    expect(page3.tasks.map((t) => t.title)).toEqual(["t0"]);
    expect(page3.hasMore).toBe(false);
  });

  it("getTasksPaginated defaults to offset 0 and limit 100", async () => {
    await insertTask();
    await insertTask();

    const page = await getTasksPaginated();

    expect(page.tasks).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
  });

  it("getTasksPaginated on an empty board", async () => {
    const page = await getTasksPaginated();
    expect(page).toEqual({ tasks: [], total: 0, hasMore: false });
  });
});

describe("runTask", () => {
  it("fires taskRunner.run without awaiting it and revalidates", async () => {
    runMock.mockReturnValue(new Promise<void>(() => {}));

    const result = await runTask("task-1");

    expect(result).toEqual({ id: "task-1" });
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith("task-1");
    expect(revalidateMock.mock.calls.map((c) => c[0])).toEqual(ALL_PATHS);
  });

  it("does not reject when taskRunner.run rejects", async () => {
    runMock.mockRejectedValue(new Error("boom"));
    await expect(runTask("task-1")).resolves.toEqual({ id: "task-1" });
  });
});

describe("getTasksWithLogsPaginated", () => {
  async function seed() {
    const a = await insertAgent({ name: "agent-a" });
    const b = await insertAgent({ name: "agent-b" });
    const rows = {
      todoNoLogs: await insertTask({ title: "todoNoLogs", status: "todo", agentId: a.id, updatedAt: at("2026-01-01T00:00:01Z") }),
      todoLogs: await insertTask({ title: "todoLogs", status: "todo", agentId: a.id, logs: "x", updatedAt: at("2026-01-01T00:00:02Z") }),
      doingNoLogs: await insertTask({ title: "doingNoLogs", status: "doing", agentId: b.id, updatedAt: at("2026-01-01T00:00:03Z") }),
      doneNoLogs: await insertTask({ title: "doneNoLogs", status: "done", agentId: b.id, updatedAt: at("2026-01-01T00:00:04Z") }),
      doneLogs: await insertTask({ title: "doneLogs", status: "done", agentId: a.id, logs: "x", updatedAt: at("2026-01-01T00:00:05Z") }),
      errorNoLogs: await insertTask({ title: "errorNoLogs", status: "error", agentId: b.id, updatedAt: at("2026-01-01T00:00:06Z") }),
      archivedError: await insertTask({ title: "archivedError", status: "error", agentId: a.id, logs: "x", archivedAt: new Date(), updatedAt: at("2026-01-01T00:00:07Z") }),
    };
    return { a, b, rows };
  }

  it("keeps rows with logs, or in doing/error, and drops archived rows", async () => {
    await seed();

    const page = await getTasksWithLogsPaginated();

    expect(page.tasks.map((t) => t.title)).toEqual(["errorNoLogs", "doneLogs", "doingNoLogs", "todoLogs"]);
    expect(page.total).toBe(4);
    expect(page.hasMore).toBe(false);
  });

  it("errorsOnly keeps only error rows", async () => {
    await seed();

    const page = await getTasksWithLogsPaginated(0, 100, undefined, true);

    expect(page.tasks.map((t) => t.title)).toEqual(["errorNoLogs"]);
    expect(page.total).toBe(1);
  });

  it("filters by agent before applying the activity filter", async () => {
    const { a, b } = await seed();

    const pageA = await getTasksWithLogsPaginated(0, 100, a.id);
    expect(pageA.tasks.map((t) => t.title)).toEqual(["doneLogs", "todoLogs"]);

    const pageB = await getTasksWithLogsPaginated(0, 100, b.id);
    expect(pageB.tasks.map((t) => t.title)).toEqual(["errorNoLogs", "doingNoLogs"]);

    const pageBErrors = await getTasksWithLogsPaginated(0, 100, b.id, true);
    expect(pageBErrors.tasks.map((t) => t.title)).toEqual(["errorNoLogs"]);

    const pageAErrors = await getTasksWithLogsPaginated(0, 100, a.id, true);
    expect(pageAErrors).toEqual({ tasks: [], total: 0, hasMore: false });
  });

  it("paginates over the filtered set", async () => {
    await seed();

    const page1 = await getTasksWithLogsPaginated(0, 3);
    expect(page1.tasks.map((t) => t.title)).toEqual(["errorNoLogs", "doneLogs", "doingNoLogs"]);
    expect(page1.total).toBe(4);
    expect(page1.hasMore).toBe(true);

    const page2 = await getTasksWithLogsPaginated(3, 3);
    expect(page2.tasks.map((t) => t.title)).toEqual(["todoLogs"]);
    expect(page2.total).toBe(4);
    expect(page2.hasMore).toBe(false);
  });
});

describe("getCostData", () => {
  it("returns empty structures on an empty board", async () => {
    expect(await getCostData()).toEqual({ burnRate: [], perAgent: [] });
  });

  it("builds the burn rate from tasks with cost > 0 in createdAt order with a running total", async () => {
    const agent = await insertAgent({ name: "worker" });
    await insertTask({ title: "third", agentId: agent.id, cost: 3, createdAt: at("2026-03-03T00:00:00Z") });
    await insertTask({ title: "first", agentId: agent.id, cost: 1, createdAt: at("2026-03-01T00:00:00Z") });
    await insertTask({ title: "free", agentId: agent.id, cost: 0, createdAt: at("2026-03-02T00:00:00Z") });
    await insertTask({ title: "second", agentId: agent.id, cost: 2, createdAt: at("2026-03-02T12:00:00Z") });

    const { burnRate } = await getCostData();

    expect(burnRate).toEqual([
      { date: "2026-03-01", cost: 1, cumulative: 1, task: "first" },
      { date: "2026-03-02", cost: 2, cumulative: 3, task: "second" },
      { date: "2026-03-03", cost: 3, cumulative: 6, task: "third" },
    ]);
  });

  it("aggregates cost per agent name with 4-decimal rounding and ignores unassigned tasks", async () => {
    const a = await insertAgent({ name: "alpha" });
    const b = await insertAgent({ name: "beta" });
    await insertTask({ agentId: a.id, cost: 0.11111, createdAt: at("2026-03-01T00:00:00Z") });
    await insertTask({ agentId: a.id, cost: 0.22222, createdAt: at("2026-03-01T00:00:01Z") });
    await insertTask({ agentId: b.id, cost: 5, createdAt: at("2026-03-01T00:00:02Z") });
    await insertTask({ agentId: b.id, cost: 0, createdAt: at("2026-03-01T00:00:03Z") });
    await insertTask({ agentId: null, cost: 99, createdAt: at("2026-03-01T00:00:04Z") });

    const { perAgent, burnRate } = await getCostData();

    expect(perAgent).toEqual(
      expect.arrayContaining([
        { agent: "alpha", cost: 0.3333 },
        { agent: "beta", cost: 5 },
      ]),
    );
    expect(perAgent).toHaveLength(2);
    // The unassigned task still contributes to the burn rate.
    expect(burnRate.map((b) => b.cost)).toContain(99);
  });

  it("falls back to the raw agent id when the agent row no longer exists", async () => {
    const agent = await insertAgent({ name: "gone" });
    await insertTask({ agentId: agent.id, cost: 2 });
    await db.run(sql`PRAGMA foreign_keys = OFF`);
    await db.delete(agents).where(eq(agents.id, agent.id));
    await db.run(sql`PRAGMA foreign_keys = ON`);

    const { perAgent } = await getCostData();

    expect(perAgent).toEqual([{ agent: agent.id, cost: 2 }]);
  });

  it("narrows both burnRate and perAgent when an agentId is given", async () => {
    const a = await insertAgent({ name: "alpha" });
    const b = await insertAgent({ name: "beta" });
    await insertTask({ title: "a1", agentId: a.id, cost: 1, createdAt: at("2026-03-01T00:00:00Z") });
    await insertTask({ title: "b1", agentId: b.id, cost: 2, createdAt: at("2026-03-01T00:00:01Z") });
    await insertTask({ title: "a2", agentId: a.id, cost: 3, createdAt: at("2026-03-01T00:00:02Z") });

    const { burnRate, perAgent } = await getCostData(a.id);

    expect(burnRate.map((b) => b.task)).toEqual(["a1", "a2"]);
    expect(burnRate.map((b) => b.cumulative)).toEqual([1, 4]);
    expect(perAgent).toEqual([{ agent: "alpha", cost: 4 }]);
  });

  it("includes archived tasks (current behaviour)", async () => {
    const agent = await insertAgent({ name: "alpha" });
    await insertTask({ agentId: agent.id, cost: 1, archivedAt: new Date() });

    const { burnRate, perAgent } = await getCostData();

    expect(burnRate).toHaveLength(1);
    expect(perAgent).toEqual([{ agent: "alpha", cost: 1 }]);
  });
});

describe("getMonitoringStats", () => {
  const NOW = at("2026-06-01T12:00:00Z");
  const recent = at("2026-06-01T00:00:00Z"); // 12h ago
  const stale = at("2026-05-31T11:00:00Z"); // 25h ago

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  it("returns zeros on an empty board", async () => {
    expect(await getMonitoringStats()).toEqual({
      done24h: 0,
      errors24h: 0,
      running: 0,
      cost24h: 0,
      activeAgents24h: 0,
      avgExecMs: 0,
    });
  });

  it("counts done/errors only within the last 24h", async () => {
    await insertTask({ status: "done", updatedAt: recent });
    await insertTask({ status: "done", updatedAt: recent });
    await insertTask({ status: "done", updatedAt: stale });
    await insertTask({ status: "error", updatedAt: recent });
    await insertTask({ status: "error", updatedAt: stale });

    const stats = await getMonitoringStats();

    expect(stats.done24h).toBe(2);
    expect(stats.errors24h).toBe(1);
  });

  it("counts every non-archived doing task regardless of age", async () => {
    await insertTask({ status: "doing", updatedAt: recent });
    await insertTask({ status: "doing", updatedAt: stale });
    await insertTask({ status: "doing", updatedAt: recent, archivedAt: new Date() });

    expect((await getMonitoringStats()).running).toBe(2);
  });

  it("sums recent cost with 4-decimal rounding", async () => {
    await insertTask({ status: "done", cost: 0.11111, updatedAt: recent });
    await insertTask({ status: "todo", cost: 0.22222, updatedAt: recent });
    await insertTask({ status: "done", cost: 100, updatedAt: stale });

    expect((await getMonitoringStats()).cost24h).toBe(0.3333);
  });

  it("counts distinct agents active in the last 24h, ignoring unassigned tasks", async () => {
    const a = await insertAgent();
    const b = await insertAgent();
    const c = await insertAgent();
    await insertTask({ status: "done", agentId: a.id, updatedAt: recent });
    await insertTask({ status: "todo", agentId: a.id, updatedAt: recent });
    await insertTask({ status: "error", agentId: b.id, updatedAt: recent });
    await insertTask({ status: "done", agentId: c.id, updatedAt: stale });
    await insertTask({ status: "done", agentId: null, updatedAt: recent });

    expect((await getMonitoringStats()).activeAgents24h).toBe(2);
  });

  it("averages durationMs of recent terminal tasks only", async () => {
    await insertTask({ status: "done", durationMs: 100, updatedAt: recent });
    await insertTask({ status: "error", durationMs: 301, updatedAt: recent });
    await insertTask({ status: "doing", durationMs: 9999, updatedAt: recent });
    await insertTask({ status: "done", durationMs: 9999, updatedAt: stale });
    await insertTask({ status: "done", durationMs: null, updatedAt: recent });

    // (100 + 301) / 2 = 200.5 -> rounded 201
    expect((await getMonitoringStats()).avgExecMs).toBe(201);
  });

  it("excludes archived rows from every metric", async () => {
    const a = await insertAgent();
    await insertTask({ status: "done", agentId: a.id, cost: 5, durationMs: 100, updatedAt: recent, archivedAt: new Date() });
    await insertTask({ status: "error", agentId: a.id, cost: 5, durationMs: 100, updatedAt: recent, archivedAt: new Date() });

    expect(await getMonitoringStats()).toEqual({
      done24h: 0,
      errors24h: 0,
      running: 0,
      cost24h: 0,
      activeAgents24h: 0,
      avgExecMs: 0,
    });
  });
});