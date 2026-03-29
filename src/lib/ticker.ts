import { eq, and, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks, type TaskStatus } from "@/db/schema";
import { taskRunner } from "./runner";
import { getTickIntervalSeconds } from "./settings";

const MAX_STALE_CYCLES = 30;

class TickEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastTickAt: number | null = null;
  private nextTickAt: number | null = null;
  private staleCycles = 0;
  private ticking = false;

  async tick(): Promise<void> {
    console.log(`[ticker] Tick started`);
    if (this.ticking) return;
    this.ticking = true;

    try {
      const todoTasks = await db.query.tasks.findMany({
        where: and(
          eq(tasks.status, "todo"),
          isNotNull(tasks.agentId),
          isNull(tasks.archivedAt),
        ),
      });

      let executed = 0;

      for (const task of todoTasks) {
        executed++;

        taskRunner.run(task.id).catch((err) => {
          console.error(`[ticker] Failed to run task ${task.id}:`, err);
        });
      }

      // Phase 2: re-run "doing" parents whose children are all terminal
      const doingTasks = await db.query.tasks.findMany({
        where: and(
          eq(tasks.status, "doing"),
          isNotNull(tasks.agentId),
          isNull(tasks.archivedAt),
        ),
      });

      for (const parent of doingTasks) {
        const children = await db.query.tasks.findMany({
          where: eq(tasks.parentId, parent.id),
          columns: { status: true },
        });

        if (children.length === 0) continue;

        const terminal: TaskStatus[] = ["done", "error"];
        const allTerminal = children.every((c) => terminal.includes(c.status as TaskStatus));
        if (!allTerminal) continue;

        executed++;

        console.log(`[ticker] Re-running "doing" parent task ${parent.id} (${children.length} children all terminal)`);
        taskRunner.run(parent.id).catch((err) => {
          console.error(`[ticker] Failed to re-run task ${parent.id}:`, err);
        });
      }

      this.lastTickAt = Date.now();

      if (executed > 0) {
        this.staleCycles = 0;
        console.log(`[ticker] Executed/promoted ${executed} task(s)`);
      } else {
        this.staleCycles++;
        console.log(`[ticker] No tasks executed/promoted`);

      }

      if (this.staleCycles >= MAX_STALE_CYCLES) {
        console.warn(
          `[ticker] ${MAX_STALE_CYCLES} consecutive idle cycles, still running`
        );
        this.staleCycles = 0;
      }
    } catch (err) {
      console.error("[ticker] Tick error:", err);
    } finally {
      this.ticking = false;
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log("[ticker] Started");
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.nextTickAt = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[ticker] Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  getLastTick(): number | null {
    return this.lastTickAt;
  }

  getNextTickAt(): number | null {
    return this.running ? this.nextTickAt : null;
  }

  getIntervalSeconds(): Promise<number> {
    return getTickIntervalSeconds();
  }

  private async scheduleNext(): Promise<void> {
    if (!this.running) return;
    const intervalSec = await getTickIntervalSeconds();
    this.nextTickAt = Date.now() + intervalSec * 1000;

    this.timer = setTimeout(async () => {
      this.nextTickAt = null;
      await this.tick();
      this.scheduleNext();
    }, intervalSec * 1000);
  }
}

const globalForTicker = globalThis as unknown as { __tickEngine?: TickEngine };

export const tickEngine =
  globalForTicker.__tickEngine ?? new TickEngine();

if (process.env.NODE_ENV !== "production") {
  globalForTicker.__tickEngine = tickEngine;
}
