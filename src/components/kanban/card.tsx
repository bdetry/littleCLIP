"use client";

import { useState, useTransition } from "react";
import type { Task, Agent, TaskStatus } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateTask } from "@/app/actions";
import { TaskDetailDialog } from "./task-detail-dialog";

const costFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

const STATUS_ARROWS: Record<TaskStatus, { prev?: TaskStatus; next?: TaskStatus }> = {
  backlog: { next: "todo" },
  todo: { prev: "backlog", next: "doing" },
  doing: { prev: "todo", next: "done" },
  done: { prev: "doing" },
  error: { prev: "todo" },
};

export function TaskCard({ task, agents }: { task: Task; agents: Agent[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const arrows = STATUS_ARROWS[task.status];
  const agent = agents.find((a) => a.id === task.agentId);

  const moveTask = (newStatus: TaskStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    startTransition(async () => {
      await updateTask(task.id, { status: newStatus });
    });
  };

  return (
    <>
      <Card
        className="group cursor-pointer border-border/50 bg-card/50 transition-colors hover:border-border hover:bg-card"
        onClick={() => setOpen(true)}
      >
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm font-medium leading-tight">
            {task.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 p-3 pt-0">
          {agent && (
            <code className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {agent.name}
            </code>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {task.cost > 0 && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {costFormatter.format(task.cost)}
                </Badge>
              )}
              {task.parentId && (
                <Badge variant="outline" className="text-xs">
                  child
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {arrows.prev && (
                <button
                  onClick={(e) => moveTask(arrows.prev!, e)}
                  disabled={isPending}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title={`Move to ${arrows.prev}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              {arrows.next && (
                <button
                  onClick={(e) => moveTask(arrows.next!, e)}
                  disabled={isPending}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title={`Move to ${arrows.next}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <TaskDetailDialog task={task} agents={agents} open={open} onOpenChange={setOpen} />
    </>
  );
}
