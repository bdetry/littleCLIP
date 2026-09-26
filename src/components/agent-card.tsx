"use client";

import { useState, useTransition, useCallback } from "react";
import type { Agent } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { updateAgent, deleteAgent, validateAgentPath, validateFilePath } from "@/app/agent-actions";

const AGENTS_PREFIX = "agents/";

interface AgentWithStats extends Agent {
  taskCount: number;
  totalCost: number;
}

const costFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
});

function extractFolderName(fullPath: string | null): string {
  if (!fullPath) return "";
  const stripped = fullPath.replace(/^agents[/\\]/, "").replace(/[/\\]+$/, "");
  return stripped;
}

function extractReqFile(fullReqPath: string | null, fullPath: string | null): string {
  if (!fullReqPath || !fullPath) return "";
  const prefix = fullPath.replace(/[/\\]+$/, "") + "/";
  if (fullReqPath.startsWith(prefix)) {
    return fullReqPath.slice(prefix.length);
  }
  return fullReqPath;
}

type ValidationStatus = "idle" | "checking" | "valid" | "invalid";

export function AgentCard({ agent }: { agent: AgentWithStats }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [folderName, setFolderName] = useState(extractFolderName(agent.path));
  const [pathStatus, setPathStatus] = useState<ValidationStatus>(agent.path ? "valid" : "idle");

  const [reqFile, setReqFile] = useState(extractReqFile(agent.requirementsPath, agent.path));
  const [reqStatus, setReqStatus] = useState<ValidationStatus>(
    agent.requirementsPath ? "valid" : "idle"
  );

  const [bypassTick, setBypassTick] = useState(agent.bypassTick);
  const [retriggerParent, setRetriggerParent] = useState(agent.retriggerParent);
  const [maxChainCalls, setMaxChainCalls] = useState(agent.maxChainCallsPerMinute?.toString() ?? "");
  const [error, setError] = useState("");

  const fullPath = folderName ? `${AGENTS_PREFIX}${folderName}` : "";
  const editName = folderName;
  const fullReqPath = reqFile && folderName ? `${AGENTS_PREFIX}${folderName}/${reqFile}` : "";

  const checkFolder = useCallback((value: string) => {
    const clean = value.replace(/[/\\]/g, "");
    setFolderName(clean);
    setError("");

    if (!clean) {
      setPathStatus("idle");
      return;
    }

    setPathStatus("checking");
    startTransition(async () => {
      const result = await validateAgentPath(`${AGENTS_PREFIX}${clean}`);
      setPathStatus(result.valid ? "valid" : "invalid");
    });
  }, [startTransition]);

  const checkReqFile = useCallback((value: string) => {
    setReqFile(value);
    setError("");

    if (!value.trim() || !folderName) {
      setReqStatus("idle");
      return;
    }

    const full = `${AGENTS_PREFIX}${folderName}/${value}`;
    setReqStatus("checking");
    startTransition(async () => {
      const result = await validateFilePath(full);
      setReqStatus(result.valid ? "valid" : "invalid");
    });
  }, [startTransition, folderName]);

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (pathStatus !== "valid") {
      setError("Agent folder must exist inside agents/.");
      return;
    }
    if (reqStatus !== "valid") {
      setError("Requirements file must exist on disk.");
      return;
    }

    const form = new FormData(e.currentTarget);
    const timeoutRaw = form.get("timeout") as string;

    startTransition(async () => {
      try {
        await updateAgent(agent.id, {
          name: editName,
          command: form.get("command") as string,
          path: fullPath || undefined,
          requirementsPath: fullReqPath || undefined,
          description: (form.get("description") as string) || undefined,
          envVars: (form.get("envVars") as string) || undefined,
          timeout: timeoutRaw ? parseInt(timeoutRaw, 10) : null,
          bypassTick,
          retriggerParent,
          maxChainCallsPerMinute: maxChainCalls ? parseInt(maxChainCalls, 10) : null,
        });
        setOpen(false);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update agent.");
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteAgent(agent.id);
        setOpen(false);
      } catch {
        setError("Cannot delete: tasks still reference this agent.");
      }
    });
  };

  const handleOpen = () => {
    setFolderName(extractFolderName(agent.path));
    setPathStatus(agent.path ? "valid" : "idle");
    setReqFile(extractReqFile(agent.requirementsPath, agent.path));
    setReqStatus(agent.requirementsPath ? "valid" : "idle");
    setBypassTick(agent.bypassTick);
    setRetriggerParent(agent.retriggerParent);
    setMaxChainCalls(agent.maxChainCallsPerMinute?.toString() ?? "");
    setError("");
    setOpen(true);
  };

  return (
    <>
      <Card
        className="cursor-pointer border-border/50 bg-card/50 transition-colors hover:border-border hover:bg-card"
        onClick={handleOpen}
      >
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            {agent.name}
            <Badge variant="secondary" className="font-mono text-xs">
              {agent.taskCount} tasks
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 p-4 pt-0">
          <code className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {agent.command}
          </code>
          {agent.path && (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {agent.path}
            </span>
          )}
          {agent.description && (
            <p className="truncate text-xs text-muted-foreground">
              {agent.description}
            </p>
          )}
          <div className="flex items-center gap-2">
            {agent.totalCost > 0 && (
              <span className="font-mono text-xs text-muted-foreground">
                {costFormatter.format(agent.totalCost)}
              </span>
            )}
            {agent.timeout && (
              <span className="font-mono text-xs text-muted-foreground">
                {agent.timeout / 1000}s timeout
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Agent: {agent.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Agent Folder *
              </label>
              <div className="relative flex items-center">
                <span className="flex h-8 shrink-0 items-center rounded-l-lg border border-r-0 border-input bg-muted px-2.5 font-mono text-sm text-muted-foreground">
                  agents/
                </span>
                <Input
                  value={folderName}
                  onChange={(e) => checkFolder(e.target.value)}
                  required
                  className="rounded-l-none font-mono pr-8"
                />
                <StatusIndicator status={pathStatus} />
              </div>
              {pathStatus === "valid" && fullPath && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">{fullPath}</p>
              )}
              {pathStatus === "invalid" && (
                <p className="mt-1 text-xs text-red-400">
                  Folder does not exist.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Agent Name (from folder)
              </label>
              <Input
                value={editName}
                readOnly
                tabIndex={-1}
                className="font-mono bg-muted/50 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Command *
              </label>
              <Input name="command" required defaultValue={agent.command} className="font-mono" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Requirements File *
              </label>
              <div className="relative flex items-center">
                <span className="flex h-8 shrink-0 items-center rounded-l-lg border border-r-0 border-input bg-muted px-2.5 font-mono text-xs text-muted-foreground">
                  {fullPath ? `${fullPath}/` : "agents/.../"}
                </span>
                <Input
                  value={reqFile}
                  onChange={(e) => checkReqFile(e.target.value)}
                  required
                  className="rounded-l-none font-mono pr-8"
                />
                <StatusIndicator status={reqStatus} />
              </div>
              {reqStatus === "invalid" && (
                <p className="mt-1 text-xs text-red-400">
                  File does not exist.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Description
              </label>
              <Textarea name="description" defaultValue={agent.description ?? ""} rows={2} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Environment Variables (JSON)
              </label>
              <Textarea
                name="envVars"
                defaultValue={agent.envVars ?? ""}
                rows={2}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Timeout (ms)
              </label>
              <Input
                name="timeout"
                type="number"
                defaultValue={agent.timeout ?? ""}
                placeholder="60000"
                className="font-mono"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="editBypassTick"
                type="checkbox"
                checked={bypassTick}
                onChange={(e) => setBypassTick(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <label htmlFor="editBypassTick" className="text-xs font-medium text-muted-foreground select-none">
                Bypass Tick — execute tasks immediately instead of waiting for the next tick cycle
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="editRetriggerParent"
                type="checkbox"
                checked={retriggerParent}
                onChange={(e) => setRetriggerParent(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <label htmlFor="editRetriggerParent" className="text-xs font-medium text-muted-foreground select-none">
                Retrigger Parent — when this agent&apos;s task finishes, immediately re-invoke the parent task
              </label>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Max Chain Calls / min
              </label>
              <Input
                type="number"
                min={1}
                value={maxChainCalls}
                onChange={(e) => setMaxChainCalls(e.target.value)}
                placeholder="System default"
                className="font-mono"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>ID: {agent.id}</span>
              <span>{agent.taskCount} tasks</span>
              {agent.totalCost > 0 && (
                <span>Total: {costFormatter.format(agent.totalCost)}</span>
              )}
            </div>

            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}

            <Separator />

            <div className="flex justify-between">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={isPending}
              >
                Delete
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending || pathStatus !== "valid" || reqStatus !== "valid"}
                >
                  {isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusIndicator({ status }: { status: ValidationStatus }) {
  if (status === "checking") {
    return <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">...</span>;
  }
  if (status === "valid") {
    return <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-emerald-500">OK</span>;
  }
  if (status === "invalid") {
    return <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-red-500">Not found</span>;
  }
  return null;
}
