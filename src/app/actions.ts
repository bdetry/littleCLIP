"use server";

import { revalidatePath } from "next/cache";
import { eq, isNull, desc, count } from "drizzle-orm";
import { ulid } from "ulidx";
import { db } from "@/db";
import { tasks, agents } from "@/db/schema";
import type { CreateTaskInput, UpdateTaskInput } from "@/lib/types";
import { taskRunner } from "@/lib/runner";

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/agents");
  revalidatePath("/logs");
  revalidatePath("/costs");
}

export async function getTasks() {
  return db.query.tasks.findMany({
    where: isNull(tasks.archivedAt),
    orderBy: [desc(tasks.updatedAt)],
  });
}

export async function getTasksPaginated(offset = 0, limit = 100) {
  const rows = await db.query.tasks.findMany({
    where: isNull(tasks.archivedAt),
    orderBy: [desc(tasks.updatedAt)],
    limit,
    offset,
  });

  const [{ total }] = await db
    .select({ total: count() })
    .from(tasks)
    .where(isNull(tasks.archivedAt));

  return { tasks: rows, total, hasMore: offset + limit < total };
}

export async function getTask(id: string) {
  return db.query.tasks.findFirst({
    where: eq(tasks.id, id),
  });
}

export async function getChildTasks(parentId: string) {
  return db.query.tasks.findMany({
    where: eq(tasks.parentId, parentId),
    orderBy: [desc(tasks.createdAt)],
  });
}

export async function createTask(input: CreateTaskInput) {
  const id = ulid();
  const status = input.status ?? (input.agentId ? "todo" : "backlog");

  await db.insert(tasks).values({
    id,
    title: input.title,
    body: input.body ?? null,
    status,
    agentId: input.agentId ?? null,
    parentId: input.parentId ?? null,
  });

  if (status === "todo" && input.agentId) {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, input.agentId),
      columns: { bypassTick: true },
    });
    if (agent?.bypassTick) {
      taskRunner.run(id).catch((err) => {
        console.error(`[actions] bypassTick immediate run failed for task ${id}:`, err);
      });
    }
  }

  revalidateAll();

  return { id };
}

export async function updateTask(id: string, input: UpdateTaskInput) {
  const prevTask = await db.query.tasks.findFirst({
    where: eq(tasks.id, id),
  });

  await db
    .update(tasks)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id));

  revalidateAll();

  return { id };
}

export async function archiveTask(id: string) {
  await db
    .update(tasks)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(tasks.id, id));

  revalidateAll();
  return { id };
}

export async function runTask(id: string) {
  taskRunner.run(id).catch((err) => {
    console.error(`[actions] Failed to run task ${id}:`, err);
  });
  revalidateAll();
  return { id };
}

export async function getTasksWithLogs(agentId?: string) {
  const allTasks = await db.query.tasks.findMany({
    where: isNull(tasks.archivedAt),
    orderBy: [desc(tasks.updatedAt)],
  });

  if (agentId) {
    return allTasks.filter((t) => t.agentId === agentId);
  }
  return allTasks;
}

export async function getTasksWithLogsPaginated(
  offset = 0,
  limit = 100,
  agentId?: string,
  errorsOnly = false
) {
  const allTasks = await db.query.tasks.findMany({
    where: isNull(tasks.archivedAt),
    orderBy: [desc(tasks.updatedAt)],
  });

  const filtered = agentId
    ? allTasks.filter((t) => t.agentId === agentId)
    : allTasks;

  const withActivity = filtered.filter((t) =>
    errorsOnly
      ? t.status === "error"
      : t.logs || t.status === "doing" || t.status === "error"
  );

  const page = withActivity.slice(offset, offset + limit);
  return {
    tasks: page,
    total: withActivity.length,
    hasMore: offset + limit < withActivity.length,
  };
}

export async function getCostData(agentId?: string) {
  let allTasks = await db.query.tasks.findMany({
    orderBy: [desc(tasks.createdAt)],
  });

  if (agentId) {
    allTasks = allTasks.filter((t) => t.agentId === agentId);
  }

  const allAgents = await db.query.agents.findMany();
  const agentMap = new Map(allAgents.map((a) => [a.id, a.name]));

  let cumulative = 0;
  const burnRate = allTasks
    .filter((t) => t.cost > 0)
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    .map((t) => {
      cumulative += t.cost;
      return {
        date: t.createdAt?.toISOString().slice(0, 10) ?? "",
        cost: t.cost,
        cumulative,
        task: t.title,
      };
    });

  const agentCosts = new Map<string, number>();
  for (const t of allTasks) {
    if (t.agentId && t.cost > 0) {
      const name = agentMap.get(t.agentId) ?? t.agentId;
      agentCosts.set(name, (agentCosts.get(name) ?? 0) + t.cost);
    }
  }
  const perAgent = Array.from(agentCosts.entries()).map(([name, total]) => ({
    agent: name,
    cost: Math.round(total * 10000) / 10000,
  }));

  return { burnRate, perAgent };
}

export interface MonitoringStats {
  done24h: number;
  errors24h: number;
  running: number;
  cost24h: number;
  activeAgents24h: number;
  avgExecMs: number;
}

export async function getMonitoringStats(): Promise<MonitoringStats> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const allActive = await db.query.tasks.findMany({
    where: isNull(tasks.archivedAt),
  });

  const recent = allActive.filter(
    (t) => t.updatedAt && t.updatedAt >= cutoff
  );

  const done24h = recent.filter((t) => t.status === "done").length;
  const errors24h = recent.filter((t) => t.status === "error").length;
  const running = allActive.filter((t) => t.status === "doing").length;

  let cost24h = 0;
  const agentIds = new Set<string>();
  const durations: number[] = [];
  for (const t of recent) {
    cost24h += t.cost;
    if (t.agentId) agentIds.add(t.agentId);
    if (
      t.durationMs != null &&
      (t.status === "done" || t.status === "error")
    ) {
      durations.push(t.durationMs);
    }
  }

  const avgExecMs =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

  return {
    done24h,
    errors24h,
    running,
    cost24h: Math.round(cost24h * 10000) / 10000,
    activeAgents24h: agentIds.size,
    avgExecMs,
  };
}
