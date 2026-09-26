import type { Task, Agent, TaskStatus } from "@/db/schema";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskCard } from "./card";

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "bg-zinc-500" },
  todo: { label: "Todo", color: "bg-blue-500" },
  doing: { label: "Doing", color: "bg-amber-500" },
  done: { label: "Done", color: "bg-emerald-500" },
  error: { label: "Error", color: "bg-red-500" },
};

export function KanbanColumn({
  status,
  tasks,
  agents,
  maxHeight = "calc(100vh - 12rem)",
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  status: TaskStatus;
  tasks: Task[];
  agents: Agent[];
  maxHeight?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const config = STATUS_CONFIG[status];

  return (
    <div
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border/50 bg-muted/30"
      style={{ maxHeight }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className={`h-2 w-2 rounded-full ${config.color}`} />
        <span className="text-sm font-medium text-foreground">
          {config.label}
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1 p-2">
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} agents={agents} />
          ))}
          {tasks.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No tasks
            </p>
          )}
          {hasMore && tasks.length > 0 && (
            <button
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="mt-1 w-full rounded-md border border-border/50 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
