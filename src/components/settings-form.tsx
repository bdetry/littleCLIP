"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateSetting } from "@/app/settings-actions";

export function SettingsForm({
  initialValues,
}: {
  initialValues: Record<string, string>;
}) {
  const [maxChain, setMaxChain] = useState(
    initialValues.max_chain_calls_per_minute ?? "10"
  );
  const [tickInterval, setTickInterval] = useState(
    initialValues.tick_interval_seconds ?? "10"
  );
  const [systemPrompt, setSystemPrompt] = useState(
    initialValues.system_prompt ?? ""
  );
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(false);
    startTransition(async () => {
      await updateSetting("tick_interval_seconds", tickInterval);
      await updateSetting("max_chain_calls_per_minute", maxChain);
      await updateSetting("system_prompt", systemPrompt);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border/50 bg-muted/30 p-6">
        <h3 className="mb-1 text-sm font-medium text-foreground">
          System Prompt
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Shared system prompt prepended to every agent execution. Defines the
          JSON output contract, status lifecycle, and schema rules for all
          agents.
        </p>

        <Textarea
          id="system-prompt"
          className="min-h-[200px] font-mono text-xs"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="System prompt for all agents..."
        />
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/30 p-6">
        <h3 className="mb-1 text-sm font-medium text-foreground">
          Tick Engine
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          The scheduler polls every N seconds for tasks in &quot;todo&quot; status
          with an assigned agent. A task executes only when all its sub-tasks
          are done.
        </p>

        <div className="flex items-center gap-3">
          <label
            htmlFor="tick-interval"
            className="shrink-0 text-sm text-muted-foreground"
          >
            Tick interval (seconds)
          </label>
          <Input
            id="tick-interval"
            type="number"
            min={1}
            max={3600}
            className="w-24 font-mono"
            value={tickInterval}
            onChange={(e) => setTickInterval(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/30 p-6">
        <h3 className="mb-1 text-sm font-medium text-foreground">
          Loop Protection
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Limit how many times an agent can be chained within a 60-second
          window. Prevents infinite loops between agents that call each other.
        </p>

        <div className="flex items-center gap-3">
          <label
            htmlFor="max-chain"
            className="shrink-0 text-sm text-muted-foreground"
          >
            Max chain calls per minute
          </label>
          <Input
            id="max-chain"
            type="number"
            min={1}
            max={1000}
            className="w-24 font-mono"
            value={maxChain}
            onChange={(e) => setMaxChain(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending} size="sm">
          {isPending ? "Saving..." : "Save Settings"}
        </Button>
        {saved && (
          <span className="text-xs text-emerald-500">Settings saved</span>
        )}
      </div>
    </div>
  );
}
