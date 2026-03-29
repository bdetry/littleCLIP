import { EventEmitter } from "node:events";

export interface TaskLogEvent {
  stream: "stdout" | "stderr";
  data: string;
  timestamp: number;
}

export interface TaskDoneEvent {
  status: "done" | "error";
  timestamp: number;
}

export interface TaskChangedEvent {
  taskId: string;
  status: string;
  timestamp: number;
}

class TaskEventBus extends EventEmitter {
  emitLog(taskId: string, event: TaskLogEvent) {
    this.emit(`log:${taskId}`, event);
  }

  emitDone(taskId: string, event: TaskDoneEvent) {
    this.emit(`done:${taskId}`, event);
  }

  emitTaskChanged(event: TaskChangedEvent) {
    this.emit("task-changed", event);
  }

  onLog(taskId: string, handler: (event: TaskLogEvent) => void) {
    this.on(`log:${taskId}`, handler);
    return () => this.off(`log:${taskId}`, handler);
  }

  onDone(taskId: string, handler: (event: TaskDoneEvent) => void) {
    this.once(`done:${taskId}`, handler);
    return () => this.off(`done:${taskId}`, handler);
  }

  onTaskChanged(handler: (event: TaskChangedEvent) => void) {
    this.on("task-changed", handler);
    return () => this.off("task-changed", handler);
  }

  cleanup(taskId: string) {
    this.removeAllListeners(`log:${taskId}`);
    this.removeAllListeners(`done:${taskId}`);
  }
}

const globalForBus = globalThis as unknown as { __taskEventBus?: TaskEventBus };

function getOrCreateBus(): TaskEventBus {
  const cached = globalForBus.__taskEventBus;
  if (cached && typeof cached.onTaskChanged === "function") return cached;
  return new TaskEventBus();
}

export const taskEventBus = getOrCreateBus();

if (process.env.NODE_ENV !== "production") {
  globalForBus.__taskEventBus = taskEventBus;
}

taskEventBus.setMaxListeners(100);
