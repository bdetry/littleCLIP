"use server";

import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks, agents } from "@/db/schema";

export interface GraphNode {
  id: string;
  name: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface AgentGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function getAgentGraph(): Promise<AgentGraphData> {
  const allAgents = await db.query.agents.findMany();
  const nodes: GraphNode[] = allAgents.map((a) => ({ id: a.id, name: a.name }));

  const allTasks = await db.query.tasks.findMany({
    where: isNotNull(tasks.parentId),
  });

  const taskMap = new Map<string, string | null>();
  const allTaskRows = await db.query.tasks.findMany();
  for (const t of allTaskRows) {
    taskMap.set(t.id, t.agentId);
  }

  const edgeCounts = new Map<string, number>();

  for (const child of allTasks) {
    if (!child.agentId || !child.parentId) continue;
    const parentAgentId = taskMap.get(child.parentId);
    if (!parentAgentId) continue;

    const key = `${parentAgentId}::${child.agentId}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  const edges: GraphEdge[] = [];
  for (const [key, weight] of edgeCounts) {
    const [source, target] = key.split("::");
    edges.push({ source, target, weight });
  }

  return { nodes, edges };
}
