import type { MonitoringStats } from "@/app/actions";

const STATS_CONFIG: {
  key: keyof MonitoringStats;
  label: string;
  color: string;
  format: (v: number) => string;
}[] = [
  {
    key: "done24h",
    label: "Done (24h)",
    color: "bg-emerald-500",
    format: (v) => String(v),
  },
  {
    key: "errors24h",
    label: "Errors (24h)",
    color: "bg-red-500",
    format: (v) => String(v),
  },
  {
    key: "running",
    label: "Running",
    color: "bg-amber-500",
    format: (v) => String(v),
  },
  {
    key: "cost24h",
    label: "Cost (24h)",
    color: "bg-blue-500",
    format: (v) => `$${v.toFixed(4)}`,
  },
  {
    key: "activeAgents24h",
    label: "Active Agents",
    color: "bg-violet-500",
    format: (v) => String(v),
  },
  {
    key: "avgExecMs",
    label: "Avg Exec Time",
    color: "bg-cyan-500",
    format: (v) =>
      v === 0 ? "--" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`,
  },
];

export function MonitoringStrip({ stats }: { stats: MonitoringStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {STATS_CONFIG.map((cfg) => (
        <div
          key={cfg.key}
          className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3"
        >
          <div className="mb-1 flex items-center gap-2">
            <div className={`h-1.5 w-1.5 rounded-full ${cfg.color}`} />
            <span className="text-xs text-muted-foreground">{cfg.label}</span>
          </div>
          <span className="font-mono text-lg font-medium text-foreground">
            {cfg.format(stats[cfg.key])}
          </span>
        </div>
      ))}
    </div>
  );
}
