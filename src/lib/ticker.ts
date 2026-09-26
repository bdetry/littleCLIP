import { eq, and, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks, type TaskStatus } from "@/db/schema";
import { taskRunner } from "./runner";
import { getTickIntervalSeconds } from "./settings";

const MAX_STALE_CYCLES = 30;
const WATCHDOG_MS = 60_000;
const SCHEDULE_RETRY_MS = 30_000;

class TickEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastTickAt: number | null = null;
  private nextTickAt: number | null = null;
  private staleCycles = 0;
  private ticking = false;
  private lastKnownIntervalSec = 10;

  async tick(): Promise<void> {
    console.log(`[ticker] Tick started`);
    if (this.ticking) {
      console.warn("[ticker] Skipping tick: previous tick still in progress");
      return;
    }
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
    this.startWatchdog();
    await this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.nextTickAt = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
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

  private startWatchdog(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.watchdog = setInterval(() => {
      if (!this.running || this.ticking) return;
      const target = this.nextTickAt;
      if (target == null) return;
      const graceMs = 2 * this.lastKnownIntervalSec * 1000;
      if (Date.now() <= target + graceMs) return;

      console.warn(
        `[ticker] Watchdog: tick overdue (nextTickAt was ${new Date(target).toISOString()}), rescheduling`
      );
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      void this.scheduleNext().catch((err) => {
        console.error("[ticker] Watchdog scheduleNext failed:", err);
        this.timer = setTimeout(() => {
          void this.scheduleNext().catch((e) =>
            console.error("[ticker] Watchdog retry scheduleNext failed:", e)
          );
        }, SCHEDULE_RETRY_MS);
      });
    }, WATCHDOG_MS);
  }

  private async scheduleNext(): Promise<void> {
    if (!this.running) return;

    let intervalSec: number;
    try {
      intervalSec = await getTickIntervalSeconds();
      this.lastKnownIntervalSec = intervalSec;
    } catch (err) {
      console.error("[ticker] Failed to read interval, using last known:", err);
      intervalSec = this.lastKnownIntervalSec;
    }

    this.nextTickAt = Date.now() + intervalSec * 1000;
    console.log(`[ticker] Next tick scheduled in ${intervalSec}s (at ${new Date(this.nextTickAt).toISOString()})`);

    this.timer = setTimeout(() => {
      void (async () => {
        this.nextTickAt = null;
        try {
          await this.tick();
        } catch (err) {
          console.error("[ticker] Unexpected tick error:", err);
        }
        try {
          await this.scheduleNext();
        } catch (err) {
          console.error("[ticker] scheduleNext failed, retrying in 30s:", err);
          this.timer = setTimeout(() => {
            void this.scheduleNext().catch((e) =>
              console.error("[ticker] Retry scheduleNext failed:", e)
            );
          }, SCHEDULE_RETRY_MS);
        }
      })();
    }, intervalSec * 1000);
  }
}

const globalForTicker = globalThis as unknown as { __tickEngine?: TickEngine };

export const tickEngine =
  globalForTicker.__tickEngine ?? new TickEngine();

if (process.env.NODE_ENV !== "production") {
  globalForTicker.__tickEngine = tickEngine;
}
