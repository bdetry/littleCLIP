"use client";

import { useState, useTransition } from "react";
import type { Task } from "@/db/schema";
import { LogsPanel } from "@/components/logs-panel";
import { getTasksWithLogsPaginated } from "@/app/actions";
import { useTaskRefresh } from "@/hooks/use-task-refresh";

const PAGE_SIZE = 100;

export function LogsList({
  initialTasks,
  initialHasMore,
  agentMap,
  agentId,
  errorsOnly,
}: {
  initialTasks: Task[];
  initialHasMore: boolean;
  agentMap: Record<string, string>;
  agentId?: string;
  errorsOnly?: boolean;
}) {
  useTaskRefresh();

  const [prevInitial, setPrevInitial] = useState(initialTasks);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [offset, setOffset] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isPending, startTransition] = useTransition();

  if (initialTasks !== prevInitial) {
    setPrevInitial(initialTasks);
    setTasks(initialTasks);
    setHasMore(initialHasMore);
  }

  function loadMore() {
    startTransition(async () => {
      const result = await getTasksWithLogsPaginated(
        offset,
        PAGE_SIZE,
        agentId,
        errorsOnly
      );
      setTasks((prev) => [...prev, ...result.tasks]);
      setOffset((prev) => prev + PAGE_SIZE);
      setHasMore(result.hasMore);
    });
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          {errorsOnly
            ? "No error logs found."
            : "No execution logs yet. Run an agent to see output here."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {tasks.map((task) => (
        <LogsPanel
          key={task.id}
          task={task}
          agentName={task.agentId ? agentMap[task.agentId] : undefined}
          creatorAgentName={task.creatorAgentId ? agentMap[task.creatorAgentId] : undefined}
        />
      ))}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={isPending}
          className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
        >
          {isPending ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
