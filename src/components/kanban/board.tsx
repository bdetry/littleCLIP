"use client";

import { useState, useTransition } from "react";
import type { Task, Agent } from "@/db/schema";
import { TASK_STATUSES, type TaskStatus } from "@/db/schema";
import { KanbanColumn } from "./column";
import { getTasksPaginated } from "@/app/actions";
import { useTaskRefresh } from "@/hooks/use-task-refresh";

const PAGE_SIZE = 100;

export function KanbanBoard({
  initialTasks,
  agents,
  initialHasMore,
  maxHeight,
}: {
  initialTasks: Task[];
  agents: Agent[];
  initialHasMore: boolean;
  maxHeight?: string;
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
      const result = await getTasksPaginated(offset, PAGE_SIZE);
      setTasks((prev) => [...prev, ...result.tasks]);
      setOffset((prev) => prev + PAGE_SIZE);
      setHasMore(result.hasMore);
    });
  }

  const grouped = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = tasks.filter((t) => t.status === status);
      return acc;
    },
    {} as Record<TaskStatus, Task[]>
  );

  return (
    <div className="grid grid-cols-5 gap-3 pb-4">
      {TASK_STATUSES.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          tasks={grouped[status]}
          agents={agents}
          hasMore={hasMore}
          isLoadingMore={isPending}
          onLoadMore={loadMore}
          {...(maxHeight ? { maxHeight } : {})}
        />
      ))}
    </div>
  );
}
