"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { Task, Agent } from "@/db/schema";
import { TASK_STATUSES } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { archiveTask, getChildTasks, getTask, runTask, updateTask } from "@/app/actions";
import { LogViewer } from "../log-viewer";

const costFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

const STATUS_COLOR: Record<string, string> = {
  backlog: "bg-zinc-500",
  todo: "bg-blue-500",
  doing: "bg-amber-500",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

export function TaskDetailDialog({
  task,
  agents,
  open,
  onOpenChange,
}: {
  task: Task;
  agents: Agent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [taskStack, setTaskStack] = useState<Task[]>([task]);
  const [childTasks, setChildTasks] = useState<Task[]>([]);
  const [prevTaskId, setPrevTaskId] = useState(task.id);

  if (task.id !== prevTaskId) {
    setPrevTaskId(task.id);
    setTaskStack([task]);
  }

  const current = taskStack[taskStack.length - 1];
  const canGoBack = taskStack.length > 1;

  const agent = agents.find((a) => a.id === current.agentId);
  const creatorAgent = agents.find((a) => a.id === current.creatorAgentId);

  useEffect(() => {
    if (open) {
      getChildTasks(current.id).then(setChildTasks);
    }
  }, [open, current.id]);

  const navigateTo = useCallback((target: Task) => {
    setTaskStack((prev) => [...prev, target]);
  }, []);

  const goBack = useCallback(() => {
    setTaskStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const closeAll = useCallback(() => {
    onOpenChange(false);
    setTaskStack([task]);
  }, [onOpenChange, task]);

  const openParentTask = () => {
    if (!current.parentId) return;
    startTransition(async () => {
      const parent = await getTask(current.parentId!);
      if (parent) navigateTo(parent);
    });
  };

  const handleStatusChange = (newStatus: string | null) => {
    if (!newStatus) return;
    startTransition(async () => {
      await updateTask(current.id, { status: newStatus as Task["status"] });
    });
  };

  const handleAgentChange = (newAgentId: string | null) => {
    startTransition(async () => {
      await updateTask(current.id, { agentId: newAgentId || null });
    });
  };

  const handleArchive = () => {
    startTransition(async () => {
      await archiveTask(current.id);
      if (canGoBack) {
        goBack();
      } else {
        closeAll();
      }
    });
  };

  const handleRun = () => {
    startTransition(async () => {
      await runTask(current.id);
    });
  };

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setTaskStack([task]);
      onOpenChange(next);
    },
    [onOpenChange, task],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] sm:max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {canGoBack && (
              <button
                onClick={goBack}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Back"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <DialogTitle className="flex-1">{current.title}</DialogTitle>
          </div>
          {canGoBack && (
            <p className="text-xs text-muted-foreground">
              Viewing {taskStack.length - 1} {taskStack.length - 1 === 1 ? "level" : "levels"} deep
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Status
              </label>
              <Select
                value={current.status}
                onValueChange={handleStatusChange}
                disabled={isPending}
              >
                <SelectTrigger className="w-36">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${STATUS_COLOR[current.status]}`} />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${STATUS_COLOR[s]}`} />
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Agent
              </label>
              <Select
                value={current.agentId ?? ""}
                onValueChange={handleAgentChange}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {agent && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Command
              </label>
              <code className="block rounded bg-muted px-3 py-2 font-mono text-sm">
                {agent.command}
              </code>
            </div>
          )}

          {current.body && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Body
              </label>
              <pre className="max-h-40 overflow-auto rounded bg-muted px-3 py-2 font-mono text-sm whitespace-pre-wrap">
                {current.body}
              </pre>
            </div>
          )}

          {current.output && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Output
              </label>
              <pre className="max-h-40 overflow-auto rounded bg-muted px-3 py-2 font-mono text-sm whitespace-pre-wrap">
                {current.output}
              </pre>
            </div>
          )}

          {current.cost > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Cost
              </label>
              <span className="font-mono text-sm">
                {costFormatter.format(current.cost)}
              </span>
            </div>
          )}

          {childTasks.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Child Tasks ({childTasks.length})
              </label>
              <div className="max-h-48 overflow-auto rounded border border-border/50">
                {childTasks.map((child) => (
                  <button
                    key={child.id}
                    onClick={() => navigateTo(child)}
                    className="flex w-full items-center gap-2 border-b border-border/30 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/50"
                  >
                    <div className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[child.status]}`} />
                    <span className="min-w-0 flex-1 truncate">{child.title}</span>
                    <code className="shrink-0 font-mono text-xs text-muted-foreground">
                      {child.status}
                    </code>
                  </button>
                ))}
              </div>
            </div>
          )}

          {current.status === "doing" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Live Logs
              </label>
              <LogViewer taskId={current.id} />
            </div>
          )}

          {current.logs && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Execution Logs
              </label>
              <pre className="max-h-60 overflow-auto rounded bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300 whitespace-pre-wrap">
                {current.logs}
              </pre>
            </div>
          )}

          {creatorAgent && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Created by
              </label>
              <code className="rounded bg-muted px-2 py-1 font-mono text-sm text-muted-foreground">
                {creatorAgent.name}
              </code>
            </div>
          )}

          {current.parentId && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Parent Task
              </label>
              <button
                onClick={openParentTask}
                disabled={isPending}
                className="rounded bg-muted px-2 py-1 font-mono text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-50"
              >
                {current.parentId}
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>ID: {current.id}</span>
            {current.createdAt && (
              <span>Created: {current.createdAt.toLocaleString()}</span>
            )}
          </div>

          <Separator />

          <div className="flex items-center gap-2">
            {task.agentId && task.status !== "doing" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleRun}
                disabled={isPending}
              >
                Run
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={handleArchive}
              disabled={isPending}
            >
              Archive
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              onClick={closeAll}
            >
              Close All
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
