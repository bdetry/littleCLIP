import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertAgent, insertTask, resetDb } from "../../test/db-helpers";
import { setSetting } from "./settings";
import { taskRunner } from "./runner";
import { tickEngine } from "./ticker";

vi.mock("@/db");
vi.mock("./runner", () => ({
  taskRunner: { run: vi.fn().mockResolvedValue(undefined) },
}));

const runMock = vi.mocked(taskRunner.run);

beforeEach(async () => {
  await resetDb();
  runMock.mockReset();
  runMock.mockResolvedValue(undefined);
});

afterEach(() => {
  tickEngine.stop();
  vi.useRealTimers();
});

describe("tick() phase 1: todo tasks", () => {
  it("runs tasks that are todo, assigned to an agent and not archived", async () => {
    const agent = await insertAgent();
    const eligible = await insertTask({ status: "todo", agentId: agent.id });
    await insertTask({ status: "backlog", agentId: agent.id });
    await insertTask({ status: "todo", agentId: null });
    await insertTask({ status: "todo", agentId: agent.id, archivedAt: new Date() });
    await insertTask({ status: "done", agentId: agent.id });

    await tickEngine.tick();

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(eligible.id);
  });

  it("runs every eligible task in the same tick", async () => {
    const agent = await insertAgent();
    const a = await insertTask({ status: "todo", agentId: agent.id });
    const b = await insertTask({ status: "todo", agentId: agent.id });

    await tickEngine.tick();

    const calledIds = runMock.mock.calls.map((c) => c[0]).sort();
    expect(calledIds).toEqual([a.id, b.id].sort());
  });
});

describe("tick() phase 2: doing parents", () => {
  it("re-runs a doing parent whose children are all terminal", async () => {
    const agent = await insertAgent();
    const parent = await insertTask({ status: "doing", agentId: agent.id });
    await insertTask({ status: "done", parentId: parent.id });
    await insertTask({ status: "error", parentId: parent.id });

    await tickEngine.tick();

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(parent.id);
  });

  it("skips a doing parent with no children", async () => {
    const agent = await insertAgent();
    await insertTask({ status: "doing", agentId: agent.id });

    await tickEngine.tick();

    expect(runMock).not.toHaveBeenCalled();
  });

  it.each(["todo", "doing", "backlog"] as const)(
    "skips a doing parent when a child is still %s",
    async (childStatus) => {
      const agent = await insertAgent();
      const parent = await insertTask({ status: "doing", agentId: agent.id });
      await insertTask({ status: "done", parentId: parent.id });
      await insertTask({ status: childStatus, parentId: parent.id });

      await tickEngine.tick();

      expect(runMock).not.toHaveBeenCalled();
    },
  );

  it("skips a doing parent without agent or that is archived", async () => {
    const agent = await insertAgent();
    const noAgent = await insertTask({ status: "doing", agentId: null });
    await insertTask({ status: "done", parentId: noAgent.id });
    const archived = await insertTask({ status: "doing", agentId: agent.id, archivedAt: new Date() });
    await insertTask({ status: "done", parentId: archived.id });

    await tickEngine.tick();

    expect(runMock).not.toHaveBeenCalled();
  });
});

describe("tick() robustness", () => {
  it("skips a tick while the previous one is still in progress", async () => {
    const agent = await insertAgent();
    await insertTask({ status: "todo", agentId: agent.id });

    const first = tickEngine.tick();
    const second = tickEngine.tick();
    await Promise.all([first, second]);

    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("does not fail when taskRunner.run rejects, and records lastTick", async () => {
    runMock.mockRejectedValue(new Error("boom"));
    const agent = await insertAgent();
    await insertTask({ status: "todo", agentId: agent.id });

    const before = Date.now();
    await expect(tickEngine.tick()).resolves.toBeUndefined();

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(tickEngine.getLastTick()).toBeGreaterThanOrEqual(before);
  });

  it("does not run anything when the board is empty", async () => {
    await tickEngine.tick();
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe("start()/stop() lifecycle", () => {
  it("is stopped by default and reports no next tick", () => {
    expect(tickEngine.isRunning()).toBe(false);
    expect(tickEngine.getNextTickAt()).toBeNull();
  });

  it("schedules the next tick at now + interval read from settings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await setSetting("tick_interval_seconds", "5");

    await tickEngine.start();

    expect(tickEngine.isRunning()).toBe(true);
    expect(tickEngine.getNextTickAt()).toBe(Date.now() + 5_000);
  });

  it("start() is idempotent", async () => {
    vi.useFakeTimers();
    await tickEngine.start();
    const firstNext = tickEngine.getNextTickAt();
    const timersAfterFirst = vi.getTimerCount();

    await tickEngine.start();

    expect(tickEngine.getNextTickAt()).toBe(firstNext);
    expect(vi.getTimerCount()).toBe(timersAfterFirst);
  });

  it("installs the tick timer and the watchdog interval, and stop() clears both", async () => {
    vi.useFakeTimers();
    await tickEngine.start();
    expect(vi.getTimerCount()).toBe(2);

    tickEngine.stop();

    expect(tickEngine.isRunning()).toBe(false);
    expect(tickEngine.getNextTickAt()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ticks when the interval elapses and reschedules itself", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await setSetting("tick_interval_seconds", "2");
    const agent = await insertAgent();
    const task = await insertTask({ status: "todo", agentId: agent.id });

    await tickEngine.start();
    const firstNext = tickEngine.getNextTickAt();
    expect(runMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(runMock).toHaveBeenCalledWith(task.id);
    expect(tickEngine.getLastTick()).toBe(Date.now());
    expect(tickEngine.getNextTickAt()).toBe(Date.now() + 2_000);
    expect(tickEngine.getNextTickAt()).not.toBe(firstNext);
  });

  it("does not tick after stop()", async () => {
    vi.useFakeTimers();
    await setSetting("tick_interval_seconds", "1");
    const agent = await insertAgent();
    await insertTask({ status: "todo", agentId: agent.id });

    await tickEngine.start();
    tickEngine.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runMock).not.toHaveBeenCalled();
  });

  it("getIntervalSeconds() reflects the setting", async () => {
    expect(await tickEngine.getIntervalSeconds()).toBe(10);
    await setSetting("tick_interval_seconds", "7");
    expect(await tickEngine.getIntervalSeconds()).toBe(7);
  });
});
