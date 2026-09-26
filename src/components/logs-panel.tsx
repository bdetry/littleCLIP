"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { LogViewer } from "@/components/log-viewer";

interface TaskSummary {
  id: string;
  title: string;
  status: "backlog" | "todo" | "doing" | "done" | "error";
  agentId: string | null;
  logs: string | null;
  cost: number;
  durationMs: number | null;
  parentId: string | null;
  creatorAgentId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

const STATUS_COLOR: Record<string, string> = {
  doing: "bg-amber-500",
  done: "bg-emerald-500",
  error: "bg-red-500",
  todo: "bg-blue-500",
  backlog: "bg-zinc-500",
};

export function LogsPanel({
  task,
  agentName,
  creatorAgentName,
}: {
  task: TaskSummary;
  agentName?: string;
  creatorAgentName?: string;
}) {
  const [expanded, setExpanded] = useState(task.status === "doing");

  return (
    <div className="rounded-lg border border-border/50 bg-card/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[task.status] ?? "bg-zinc-500"} ${task.status === "doing" ? "animate-pulse" : ""}`}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {task.title}
        </span>
        {creatorAgentName && (
          <code className="hidden truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground/70 sm:block sm:max-w-48" title={`Created by ${creatorAgentName}`}>
             {creatorAgentName} →
          </code> 
        )}
        {agentName && (
          <code className="hidden truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground sm:block sm:max-w-64">
            {agentName}
          </code>
        )}
        <Badge
          variant={task.status === "error" ? "destructive" : "secondary"}
          className="shrink-0"
        >
          {task.status}
        </Badge>
        {task.cost > 0 && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            ${task.cost.toFixed(4)}
          </span>
        )}
        <svg
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-border/50 p-4">
          <div className="mb-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">ID: {task.id}</span>
            {task.parentId && (
              <span className="font-mono">Parent: {task.parentId}</span>
            )}
            {task.durationMs != null && (
              <span className="font-mono">
                {task.durationMs >= 1000
                  ? `${(task.durationMs / 1000).toFixed(2)}s`
                  : `${task.durationMs}ms`}
              </span>
            )}
            {task.createdAt && (
              <span suppressHydrationWarning>
                {task.createdAt.toLocaleString()}
              </span>
            )}
          </div>

          {task.status === "doing" ? (
            <LogViewer taskId={task.id} />
          ) : task.logs ? (
            <pre className="max-h-80 overflow-auto rounded bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap">
              {task.logs}
            </pre>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No logs captured for this task.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
