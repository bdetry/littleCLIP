import { spawn, type ChildProcess } from "node:child_process";
import { eq, and, ne } from "drizzle-orm";
import { ulid } from "ulidx";
import { db } from "@/db";
import { tasks, agents, type TaskStatus } from "@/db/schema";
import { extractLastJson } from "./json-parser";
import { AgentOutputSchema, type AgentInput, type ParentTaskContext, type ChildTaskContext, type AvailableAgent } from "./types";
import { taskEventBus } from "./event-bus";
import { getMaxChainCallsPerMinute, getSystemPrompt } from "./settings";

const DEFAULT_TIMEOUT_MS = 60_000;

const WINDOW_MS = 60_000;

export class TaskRunner {
  private chainTimestamps = new Map<string, number[]>();

  private isRateLimited(agentName: string, limit: number): boolean {
    const now = Date.now();
    const timestamps = this.chainTimestamps.get(agentName) ?? [];
    const recent = timestamps.filter((t) => now - t < WINDOW_MS);
    this.chainTimestamps.set(agentName, recent);
    return recent.length >= limit;
  }

  private recordCall(agentName: string): void {
    const stamps = this.chainTimestamps.get(agentName) ?? [];
    stamps.push(Date.now());
    this.chainTimestamps.set(agentName, stamps);
  }

  private async maybeRetriggerParent(taskId: string): Promise<void> {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      columns: { parentId: true, agentId: true },
    });
    if (!task?.parentId || !task.agentId) return;

    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, task.agentId),
      columns: { retriggerParent: true },
    });
    if (!agent?.retriggerParent) return;

    const siblings = await db.query.tasks.findMany({
      where: eq(tasks.parentId, task.parentId),
      columns: { status: true },
    });
    if (siblings.length === 0) return;

    const TERMINAL: TaskStatus[] = ["done", "error"];
    if (!siblings.every((s) => TERMINAL.includes(s.status))) return;

    const parent = await db.query.tasks.findFirst({
      where: eq(tasks.id, task.parentId),
      columns: { id: true, status: true, agentId: true },
    });
    if (!parent || parent.status !== "doing" || !parent.agentId) return;

    console.log(`[runner] retriggerParent: immediately re-running parent task ${parent.id} (all ${siblings.length} children terminal)`);
    this.run(parent.id).catch((err) => {
      console.error(`[runner] retriggerParent re-run failed for parent task ${parent.id}:`, err);
    });
  }

  private async buildParentContext(parentId: string | null): Promise<ParentTaskContext[]> {
    const MAX_ANCESTORS = 10;
    const MAX_OUTPUT_LEN = 1000;
    const MAX_BODY_LEN = 500;
    const ancestors: ParentTaskContext[] = [];
    let currentId = parentId;

    while (currentId && ancestors.length < MAX_ANCESTORS) {
      const row = await db.query.tasks.findFirst({
        where: eq(tasks.id, currentId),
        columns: { id: true, title: true, body: true, output: true, parentId: true, agentId: true },
      });
      if (!row) break;

      let agentName: string | null = null;
      if (row.agentId) {
        const a = await db.query.agents.findFirst({
          where: eq(agents.id, row.agentId),
          columns: { name: true },
        });
        agentName = a?.name ?? null;
      }

      ancestors.push({
        id: row.id,
        title: row.title,
        body: row.body ? row.body.slice(0, MAX_BODY_LEN) : row.body,
        output: row.output ? row.output.slice(0, MAX_OUTPUT_LEN) : row.output,
        agent: agentName,
      });

      currentId = row.parentId;
    }

    return ancestors;
  }

  private async buildAgentsList(): Promise<AvailableAgent[]> {
    const allAgents = await db.query.agents.findMany({
      columns: { name: true, description: true },
    });
    return allAgents.map((a) => ({ name: a.name, description: a.description ?? "" }));
  }

  private async buildChildContext(taskId: string): Promise<ChildTaskContext[]> {
    const MAX_CHILDREN = 20;
    const MAX_OUTPUT_LEN = 800;
    const MAX_BODY_LEN = 400;

    const children = await db.query.tasks.findMany({
      where: eq(tasks.parentId, taskId),
      columns: { id: true, title: true, body: true, status: true, output: true, agentId: true },
    });

    const sorted = children.sort((a, b) => a.id.localeCompare(b.id));
    const recent = sorted.slice(-MAX_CHILDREN);

    const result: ChildTaskContext[] = [];
    for (const child of recent) {
      let agentName: string | null = null;
      if (child.agentId) {
        const a = await db.query.agents.findFirst({
          where: eq(agents.id, child.agentId),
          columns: { name: true },
        });
        agentName = a?.name ?? null;
      }
      result.push({
        id: child.id,
        title: child.title,
        body: child.body ? child.body.slice(0, MAX_BODY_LEN) : child.body,
        status: child.status,
        output: child.output ? child.output.slice(0, MAX_OUTPUT_LEN) : child.output,
        agent: agentName,
      });
    }
    return result;
  }

  private async buildSiblingContext(taskId: string, parentId: string | null): Promise<ChildTaskContext[]> {
    if (!parentId) return [];

    const siblings = await db.query.tasks.findMany({
      where: and(eq(tasks.parentId, parentId), ne(tasks.id, taskId)),
      columns: { id: true, title: true, body: true, status: true, output: true, agentId: true },
    });

    const sorted = siblings.sort((a, b) => a.id.localeCompare(b.id));
    const recent = sorted.slice(-20);

    const result: ChildTaskContext[] = [];
    for (const sib of recent) {
      let agentName: string | null = null;
      if (sib.agentId) {
        const a = await db.query.agents.findFirst({
          where: eq(agents.id, sib.agentId),
          columns: { name: true },
        });
        agentName = a?.name ?? null;
      }
      result.push({
        id: sib.id,
        title: sib.title,
        body: sib.body,
        status: sib.status,
        output: sib.output,
        agent: agentName,
      });
    }
    return result;
  }

  async run(taskId: string): Promise<void> {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status === "done") {
      console.log(`[runner] Skipping task ${taskId}, status is already "done"`);
      return;
    }
    if (!task.agentId) throw new Error(`Task ${taskId} has no agent assigned`);

    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, task.agentId),
    });

    if (!agent) throw new Error(`Agent ${task.agentId} not found for task ${taskId}`);

    const projectLimit = await getMaxChainCallsPerMinute();
    const effectiveLimit = agent.maxChainCallsPerMinute ?? projectLimit;

    if (this.isRateLimited(agent.name, effectiveLimit)) {
      console.warn(
        `[runner] Agent "${agent.name}" rate-limited (${effectiveLimit}/min), deferring task ${taskId}`
      );
      return;
    }

    this.recordCall(agent.name);

    await db
      .update(tasks)
      .set({ status: "doing", updatedAt: new Date() })
      .where(eq(tasks.id, taskId));

    taskEventBus.emitTaskChanged({ taskId, status: "doing", timestamp: Date.now() });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const agentEnv: Record<string, string> = {};
    if (agent.envVars) {
      try {
        Object.assign(agentEnv, JSON.parse(agent.envVars));
      } catch {
        console.error(`[runner] Failed to parse agent environment variables for agent ${agent.id}:`, agent.envVars);
      }
    }

    const timeout = agent.timeout ?? DEFAULT_TIMEOUT_MS;

    const agentInput: AgentInput = {
      task_id: taskId,
      task_body: task.body ?? "",
      system_prompt: await getSystemPrompt(),
      parent_context: await this.buildParentContext(task.parentId),
      child_tasks: await this.buildChildContext(taskId),
      sibling_tasks: await this.buildSiblingContext(taskId, task.parentId),
      available_agents: await this.buildAgentsList(),
    };

    return new Promise<void>((resolve) => {
      // Pass JSON on stdin — Windows ENAMETOOLONG when the same string is argv (long parent_context, etc.).
      const payload = JSON.stringify(agentInput);

      console.log(`[runner] AgentInput for task ${taskId}: parent_context=${agentInput.parent_context.length} ancestors, available_agents=${agentInput.available_agents.length}`);

      const startTime = Date.now();

      // Parse command into executable + script args so spawn passes argv correctly.
      // With shell: true, args get concatenated and may not reach process.argv[2]/[3].
      const parts = agent.command.trim().split(/\s+/);
      const executable = parts[0];
      const scriptArgs = parts.slice(1);
      const allArgs = [...scriptArgs];

      let child: ChildProcess;
      try {
        child = spawn(executable, allArgs, {
          timeout,
          cwd: agent.path ?? undefined,
          env: { ...process.env, ...agentEnv, TASK_ID: taskId },
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err) {
        // spawn() can throw synchronously (e.g. ENAMETOOLONG on Windows) before a ChildProcess
        // exists, so child.on("error") never runs. Mark the task failed so it does not stay "doing".
        const durationMs = Date.now() - startTime;
        const message = err instanceof Error ? err.message : String(err);
        const code =
          err instanceof Error && "code" in err
            ? String((err as NodeJS.ErrnoException).code ?? "")
            : "";
        const logLine = `Spawn error: ${message}${code ? ` [${code}]` : ""}`;
        void (async () => {
          try {
            const existing = await db.query.tasks.findFirst({
              where: eq(tasks.id, taskId),
              columns: { logs: true },
            });
            const allLogs = existing?.logs
              ? `${existing.logs}\n\n═══ Spawn failure ${new Date().toISOString()} ═══\n\n${logLine}`
              : logLine;
            await db
              .update(tasks)
              .set({
                status: "error",
                logs: allLogs,
                durationMs,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, taskId));
            taskEventBus.emitDone(taskId, {
              status: "error",
              timestamp: Date.now(),
            });
            taskEventBus.emitTaskChanged({ taskId, status: "error", timestamp: Date.now() });
            this.maybeRetriggerParent(taskId).catch((retriggerErr) => {
              console.error(`[runner] retriggerParent check failed for task ${taskId}:`, retriggerErr);
            });
          } catch (persistErr) {
            console.error(`[runner] Failed to persist synchronous spawn error for task ${taskId}:`, persistErr);
          } finally {
            resolve();
          }
        })();
        return;
      }

      console.log(`[runner] Spawning agent ${agent.name} (${executable}) for task ${taskId}`);

      const stdin = child.stdin;
      if (stdin) {
        stdin.on("error", (e) => {
          console.error(`[runner] Agent stdin error for task ${taskId}:`, e);
          child.kill("SIGTERM");
        });
        stdin.end(payload, "utf8");
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutChunks.push(text);
        taskEventBus.emitLog(taskId, {
          stream: "stdout",
          data: text,
          timestamp: Date.now(),
        });
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrChunks.push(text);
        taskEventBus.emitLog(taskId, {
          stream: "stderr",
          data: text,
          timestamp: Date.now(),
        });
      });

      child.on("close", async (code) => {
        console.log(`[runner] Agent ${agent.name} closed with code ${code}`);
        const durationMs = Date.now() - startTime;
        const allStdout = stdoutChunks.join("");
        const allStderr = stderrChunks.join("");
        const runLogs = allStdout + (allStderr ? "\n--- STDERR ---\n" + allStderr : "");

        const existing = await db.query.tasks.findFirst({
          where: eq(tasks.id, taskId),
          columns: { logs: true, cost: true },
        });
        const allLogs = existing?.logs
          ? existing.logs + `\n\n═══ Re-execution ${new Date().toISOString()} ═══\n\n` + runLogs
          : runLogs;

        if (code !== 0) {
          await db
            .update(tasks)
            .set({
              status: "error",
              logs: allLogs,
              durationMs,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, taskId));

          taskEventBus.emitDone(taskId, {
            status: "error",
            timestamp: Date.now(),
          });
          taskEventBus.emitTaskChanged({ taskId, status: "error", timestamp: Date.now() });
          this.maybeRetriggerParent(taskId).catch((err) => {
            console.error(`[runner] retriggerParent check failed for task ${taskId}:`, err);
          });
          resolve();
          return;
        }

        console.log(`[runner] All stdout: ${allStdout}`);
        const rawJson = extractLastJson(allStdout);
        console.log(`[runner] Raw JSON: ${JSON.stringify(rawJson)}`);
        const parsed = rawJson ? AgentOutputSchema.safeParse(rawJson) : null;
        console.log(`[runner] Parsed: ${JSON.stringify(parsed)}`);

        if (parsed?.success) {
          const result = parsed.data;
          const hasChildren = !!result.next_tasks?.length;
          const previousCost = existing?.cost ?? 0;
          const totalCost = previousCost + result.cost;

          const agentStatus: TaskStatus = result.status ?? "done";
          const finalStatus: TaskStatus = hasChildren ? "doing" : agentStatus;

          await db
            .update(tasks)
            .set({
              status: finalStatus,
              output: result.output,
              cost: totalCost,
              logs: allLogs,
              durationMs,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, taskId));

          if (hasChildren) {
            await this.chainTasks(taskId, result.next_tasks!);
            console.log(`[runner] Task ${taskId} stays "doing" — waiting for ${result.next_tasks!.length} child task(s)`);
            taskEventBus.emitTaskChanged({ taskId, status: "doing", timestamp: Date.now() });
          }

          if (finalStatus === "done" || finalStatus === "error") {
            taskEventBus.emitDone(taskId, { status: finalStatus, timestamp: Date.now() });
            taskEventBus.emitTaskChanged({ taskId, status: finalStatus, timestamp: Date.now() });
            this.maybeRetriggerParent(taskId).catch((err) => {
              console.error(`[runner] retriggerParent check failed for task ${taskId}:`, err);
            });
          }
        } else {
          console.error(`[runner] Failed to parse agent JSON output for task ${taskId}:`, allStdout);
          const parseErrorMsg = `[system] Failed to parse agent JSON output.`;
          console.error(`[runner] ${parseErrorMsg} Task ${taskId}:`, parsed);

          await db
            .update(tasks)
            .set({
              status: "error",
              output: allStdout.trim() || null,
              logs: allLogs + "\n" + parseErrorMsg,
              durationMs,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, taskId));

          taskEventBus.emitDone(taskId, { status: "error", timestamp: Date.now() });
          taskEventBus.emitTaskChanged({ taskId, status: "error", timestamp: Date.now() });
          this.maybeRetriggerParent(taskId).catch((err) => {
            console.error(`[runner] retriggerParent check failed for task ${taskId}:`, err);
          });
        }

        resolve();
      });

      child.on("error", async (err) => {
        const durationMs = Date.now() - startTime;
        await db
          .update(tasks)
          .set({
            status: "error",
            logs: `Spawn error: ${err.message}`,
            durationMs,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, taskId));

        taskEventBus.emitDone(taskId, {
          status: "error",
          timestamp: Date.now(),
        });
        taskEventBus.emitTaskChanged({ taskId, status: "error", timestamp: Date.now() });
        this.maybeRetriggerParent(taskId).catch((retriggerErr) => {
          console.error(`[runner] retriggerParent check failed for task ${taskId}:`, retriggerErr);
        });
        resolve();
      });
    });
  }

  private async chainTasks(
    parentId: string,
    nextTasks: { title: string; body?: string; agent?: string | null; status?: TaskStatus }[]
  ): Promise<void> {
    console.log(`[runner] Chaining tasks: ${JSON.stringify(nextTasks)}`);

    const parentTask = await db.query.tasks.findFirst({
      where: eq(tasks.id, parentId),
      columns: { agentId: true },
    });
    const creatorAgentId = parentTask?.agentId ?? null;

    for (const nt of nextTasks) {
      let agentId: string | null = null;
      let bypassTick = false;

      if (nt.agent) {
        const found = await db.query.agents.findFirst({
          where: eq(agents.name, nt.agent),
        });
        if (found) {
          agentId = found.id;
          bypassTick = found.bypassTick;
        }
      }

      const childId = ulid();
      const status: TaskStatus = nt.status ?? "backlog";

      const t = {
        id: childId,
        title: nt.title,
        body: nt.body ?? null,
        agentId,
        status,
        parentId,
        creatorAgentId,
      }
      console.log(`[runner] Task to insert: ${JSON.stringify(t)}`);
      await db.insert(tasks).values(t);

      taskEventBus.emitTaskChanged({ taskId: childId, status, timestamp: Date.now() });

      if (status === "todo" && bypassTick) {
        console.log(`[runner] bypassTick: immediately running child task ${childId}`);
        this.run(childId).catch((err) => {
          console.error(`[runner] bypassTick immediate run failed for task ${childId}:`, err);
        });
      }

    }
  }
}

const globalForRunner = globalThis as unknown as { __taskRunner?: TaskRunner };

export const taskRunner =
  globalForRunner.__taskRunner ?? new TaskRunner();

if (process.env.NODE_ENV !== "production") {
  globalForRunner.__taskRunner = taskRunner;
}
