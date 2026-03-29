"use server";

import { revalidatePath } from "next/cache";
import { eq, desc } from "drizzle-orm";
import { ulid } from "ulidx";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/db";
import { agents, tasks } from "@/db/schema";
import type { CreateAgentInput, UpdateAgentInput } from "@/lib/types";

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/agents");
  revalidatePath("/logs");
  revalidatePath("/costs");
}

export async function validateAgentPath(agentPath: string): Promise<{
  valid: boolean;
  resolvedPath: string;
  hasRequirements: boolean;
}> {
  const resolved = path.resolve(process.cwd(), agentPath);
  const exists = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  const hasRequirements = exists && fs.existsSync(path.join(resolved, "requirements.md"));
  return { valid: exists, resolvedPath: resolved, hasRequirements };
}

export async function validateFilePath(filePath: string): Promise<{
  valid: boolean;
  resolvedPath: string;
}> {
  const resolved = path.resolve(process.cwd(), filePath);
  const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  return { valid: exists, resolvedPath: resolved };
}

export async function getAgents() {
  return db.query.agents.findMany({
    orderBy: [desc(agents.createdAt)],
  });
}

export async function getAgent(id: string) {
  return db.query.agents.findFirst({
    where: eq(agents.id, id),
  });
}

export async function createAgent(input: CreateAgentInput) {
  const resolved = path.resolve(process.cwd(), input.path);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Agent path does not exist: ${input.path}`);
  }

  if (input.requirementsPath) {
    const reqResolved = path.resolve(process.cwd(), input.requirementsPath);
    if (!fs.existsSync(reqResolved) || !fs.statSync(reqResolved).isFile()) {
      throw new Error(`Requirements file does not exist: ${input.requirementsPath}`);
    }
  }

  const id = ulid();

  await db.insert(agents).values({
    id,
    name: input.name,
    path: input.path,
    command: input.command,
    requirementsPath: input.requirementsPath ?? null,
    envVars: input.envVars ?? null,
    timeout: input.timeout ?? null,
    description: input.description ?? null,
    bypassTick: input.bypassTick ?? false,
    maxChainCallsPerMinute: input.maxChainCallsPerMinute ?? null,
    retriggerParent: input.retriggerParent ?? false,
  });

  revalidateAll();
  return { id };
}

export async function updateAgent(id: string, input: UpdateAgentInput) {
  if (input.path) {
    const resolved = path.resolve(process.cwd(), input.path);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Agent path does not exist: ${input.path}`);
    }
  }

  if (input.requirementsPath) {
    const reqResolved = path.resolve(process.cwd(), input.requirementsPath);
    if (!fs.existsSync(reqResolved) || !fs.statSync(reqResolved).isFile()) {
      throw new Error(`Requirements file does not exist: ${input.requirementsPath}`);
    }
  }

  await db
    .update(agents)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, id));

  revalidateAll();
  return { id };
}

export async function deleteAgent(id: string) {
  const referencingTasks = await db.query.tasks.findFirst({
    where: eq(tasks.agentId, id),
  });

  if (referencingTasks) {
    throw new Error("Cannot delete agent: tasks still reference it. Archive or reassign them first.");
  }

  await db.delete(agents).where(eq(agents.id, id));

  revalidateAll();
  return { id };
}

export async function getAgentStats() {
  const allAgents = await db.query.agents.findMany({
    orderBy: [desc(agents.createdAt)],
  });

  const allTasks = await db.query.tasks.findMany();

  return allAgents.map((agent) => {
    const agentTasks = allTasks.filter((t) => t.agentId === agent.id);
    const totalCost = agentTasks.reduce((sum, t) => sum + t.cost, 0);
    const taskCount = agentTasks.length;
    return { ...agent, taskCount, totalCost };
  });
}
