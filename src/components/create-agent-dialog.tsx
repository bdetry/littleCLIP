"use client";

import { useTransition, useState, useCallback } from "react";
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
import { createAgent, validateAgentPath, validateFilePath } from "@/app/agent-actions";

const AGENTS_PREFIX = "agents/";

type ValidationStatus = "idle" | "checking" | "valid" | "invalid";

export function CreateAgentDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [folderName, setFolderName] = useState("");
  const [pathStatus, setPathStatus] = useState<ValidationStatus>("idle");

  const [reqFile, setReqFile] = useState("");
  const [reqStatus, setReqStatus] = useState<ValidationStatus>("idle");

  const [bypassTick, setBypassTick] = useState(false);
  const [retriggerParent, setRetriggerParent] = useState(false);
  const [maxChainCalls, setMaxChainCalls] = useState("");
  const [error, setError] = useState("");

  const fullPath = folderName ? `${AGENTS_PREFIX}${folderName}` : "";
  const agentName = folderName;
  const fullReqPath = reqFile && folderName ? `${AGENTS_PREFIX}${folderName}/${reqFile}` : "";

  const checkFolder = useCallback((value: string) => {
    const clean = value.replace(/[/\\]/g, "");
    setFolderName(clean);
    setError("");
    setReqFile("");
    setReqStatus("idle");

    if (!clean) {
      setPathStatus("idle");
      return;
    }

    setPathStatus("checking");
    startTransition(async () => {
      const result = await validateAgentPath(`${AGENTS_PREFIX}${clean}`);
      setPathStatus(result.valid ? "valid" : "invalid");
      if (result.hasRequirements) {
        setReqFile("requirements.md");
        setReqStatus("valid");
      }
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

  const canSubmit = pathStatus === "valid" && reqStatus === "valid" && !isPending;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
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
        await createAgent({
          name: agentName,
          path: fullPath,
          command: form.get("command") as string,
          requirementsPath: fullReqPath,
          description: (form.get("description") as string) || undefined,
          envVars: (form.get("envVars") as string) || undefined,
          timeout: timeoutRaw ? parseInt(timeoutRaw, 10) : undefined,
          bypassTick,
          retriggerParent,
          maxChainCallsPerMinute: maxChainCalls ? parseInt(maxChainCalls, 10) : null,
        });
        setOpen(false);
        setFolderName("");
        setPathStatus("idle");
        setReqFile("");
        setReqStatus("idle");
        setBypassTick(false);
        setRetriggerParent(false);
        setMaxChainCalls("");
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to register agent.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="default" />}>
        Register Agent
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Register Agent</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="sample1"
                autoFocus
                className="rounded-l-none font-mono pr-8"
              />
              <StatusIndicator status={pathStatus} />
            </div>
            {pathStatus === "valid" && fullPath && (
              <p className="mt-1 font-mono text-xs text-muted-foreground">{fullPath}</p>
            )}
            {pathStatus === "invalid" && (
              <p className="mt-1 text-xs text-red-400">
                Folder does not exist. Create <code className="font-mono">{fullPath}</code> first.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Agent Name (from folder)
            </label>
            <Input
              value={agentName}
              readOnly
              tabIndex={-1}
              className="font-mono bg-muted/50 cursor-not-allowed"
              placeholder="—"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Command *
            </label>
            <Input
              name="command"
              required
              placeholder={`node ${fullPath || "agents/..."}/run.js`}
              className="font-mono"
            />
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
                placeholder="requirements.md"
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
              Description for humans and LLMs *
            </label>
            <Textarea
              name="description"
              placeholder="What does this agent do?"
              rows={2}
              required={true}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Environment Variables (JSON)
            </label>
            <Textarea
              name="envVars"
              placeholder='{"API_KEY": "sk-...", "MODEL": "gpt-4o"}'
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
              placeholder="60000"
              className="font-mono"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="bypassTick"
              type="checkbox"
              checked={bypassTick}
              onChange={(e) => setBypassTick(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <label htmlFor="bypassTick" className="text-xs font-medium text-muted-foreground select-none">
              Bypass Tick — execute tasks immediately instead of waiting for the next tick cycle
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="retriggerParent"
              type="checkbox"
              checked={retriggerParent}
              onChange={(e) => setRetriggerParent(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <label htmlFor="retriggerParent" className="text-xs font-medium text-muted-foreground select-none">
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

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {isPending ? "Registering..." : "Register"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
