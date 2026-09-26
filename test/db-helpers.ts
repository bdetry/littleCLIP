import path from "node:path";
import { ulid } from "ulidx";
import { db } from "@/db";
import { agents, settings, tasks, type NewAgent, type NewTask } from "@/db/schema";

/** Absolute path to the env-driven fake agent script. */
export const FIXTURE_AGENT_PATH = path.join(process.cwd(), "test", "fixtures", "agent.js");

/**
 * Command used by test agents. `runner.ts` splits the command on whitespace,
 * so the fixture path must not contain spaces (the repo path does not).
 */
export const FIXTURE_AGENT_COMMAND = `node ${FIXTURE_AGENT_PATH}`;

export async function resetDb(): Promise<void> {
  await db.delete(tasks);
  await db.delete(agents);
  await db.delete(settings);
}

export interface FixtureEnv {
  FIXTURE_STDOUT?: string;
  FIXTURE_STDERR?: string;
  FIXTURE_EXIT_CODE?: string;
  FIXTURE_DELAY_MS?: string;
}

export function fixtureEnv(env: FixtureEnv): string {
  return JSON.stringify(env);
}

export async function insertAgent(overrides: Partial<NewAgent> = {}) {
  const row: NewAgent = {
    id: ulid(),
    name: `agent-${ulid().toLowerCase()}`,
    command: FIXTURE_AGENT_COMMAND,
    ...overrides,
  };
  await db.insert(agents).values(row);
  const inserted = await db.query.agents.findFirst({ where: (a, { eq }) => eq(a.id, row.id) });
  if (!inserted) throw new Error("insertAgent: row not found after insert");
  return inserted;
}

export async function insertTask(overrides: Partial<NewTask> = {}) {
  const row: NewTask = {
    id: ulid(),
    title: "test task",
    ...overrides,
  };
  await db.insert(tasks).values(row);
  const inserted = await db.query.tasks.findFirst({ where: (t, { eq }) => eq(t.id, row.id) });
  if (!inserted) throw new Error("insertTask: row not found after insert");
  return inserted;
}

export async function getTask(id: string) {
  return db.query.tasks.findFirst({ where: (t, { eq }) => eq(t.id, id) });
}

export async function getChildren(parentId: string) {
  return db.query.tasks.findMany({ where: (t, { eq }) => eq(t.parentId, parentId) });
}

/** Resolves when `taskEventBus` emits `done:<taskId>`, or rejects after `ms`. */
export function waitForDone(
  bus: { onDone: (taskId: string, handler: (e: { status: "done" | "error" }) => void) => () => void },
  taskId: string,
  ms = 10_000,
): Promise<"done" | "error"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Timed out waiting for done:${taskId}`));
    }, ms);
    const off = bus.onDone(taskId, (e) => {
      clearTimeout(timer);
      resolve(e.status);
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Polls `probe` until it returns a non-null/undefined value, or throws after `ms`. */
export async function waitUntil<T>(
  probe: () => Promise<T | null | undefined | false>,
  ms = 10_000,
  stepMs = 50,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitUntil: timed out");
    await sleep(stepMs);
  }
}
