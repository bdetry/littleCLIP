"use client";

import { useTransition, useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TASK_STATUSES } from "@/db/schema";
import type { TaskStatus, Agent } from "@/db/schema";
import { createTask } from "@/app/actions";
import { toggleTick, getTickState } from "@/app/settings-actions";

export function CreateTaskDialog({
  agents,
  tickRunning: initialTickRunning,
}: {
  agents: Agent[];
  tickRunning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [tickActive, setTickActive] = useState(initialTickRunning);
  const [toggling, startToggle] = useTransition();

  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const nextTickAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!tickActive) {
      nextTickAtRef.current = null;
      return;
    }

    let cancelled = false;

    async function sync() {
      if (cancelled) return;
      try {
        const state = await getTickState();
        if (cancelled) return;
        setTickActive(state.running);
        nextTickAtRef.current = state.nextTickAt;
      } catch { /* ignore */ }
    }

    sync();
    const pollId = setInterval(sync, 2000);
    return () => { cancelled = true; clearInterval(pollId); };
  }, [tickActive]);

  useEffect(() => {
    const id = setInterval(() => {
      const target = nextTickAtRef.current;
      if (!tickActive || target == null) {
        setRemainingMs((prev) => (prev === null ? prev : null));
        return;
      }
      setRemainingMs(Math.max(0, target - Date.now()));
    }, 200);
    return () => clearInterval(id);
  }, [tickActive]);

  const selectedAgent = agents.find((a) => a.id === agentId);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);

    startTransition(async () => {
      await createTask({
        title: form.get("title") as string,
        body: (form.get("body") as string) || undefined,
        agentId: agentId ?? undefined,
        status,
        parentId: (form.get("parentId") as string) || undefined,
      });
      setOpen(false);
      setStatus("backlog");
      setAgentId(null);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span className="mr-2 inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 py-1 pl-2.5 pr-1 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
        {tickActive ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
        ) : (
          <span className="flex h-2 w-2 rounded-full bg-zinc-500" />
        )}
        {tickActive && remainingMs != null && (
          <span title="Time until next tick">
            {remainingMs >= 1000
              ? `${Math.ceil(remainingMs / 1000)}s`
              : "now"}
          </span>
        )}
        <button
          type="button"
          disabled={toggling}
          onClick={() => {
            startToggle(async () => {
              const running = await toggleTick();
              setTickActive(running);
              if (!running) nextTickAtRef.current = null;
            });
          }}
          className="ml-1 rounded-full p-0.5 transition-colors hover:bg-muted"
          title={tickActive ? "Pause tick engine" : "Resume tick engine"}
        >
          {tickActive ? (
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          ) : (
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
      </span>
      <DialogTrigger render={<Button size="sm" variant="default" />}>
        + New Task
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Title *
            </label>
            <Input
              name="title"
              required
              placeholder="Summarize the research paper"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Body
            </label>
            <Textarea
              name="body"
              placeholder="Markdown or JSON payload for the agent..."
              rows={3}
              className="font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Agent
            </label>
            <Select
              value={agentId ?? ""}
              onValueChange={(val) => setAgentId(val || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No agent (unassigned)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">
                  No agent
                </SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedAgent && (
              <code className="mt-1 block truncate rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                {selectedAgent.command}
              </code>
            )}
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Status
              </label>
              <Select
                value={status}
                onValueChange={(val) => setStatus(val as TaskStatus)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.filter((s) => s !== "doing").map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Parent ID
              </label>
              <Input
                name="parentId"
                placeholder="Optional ULID"
                className="font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
