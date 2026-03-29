"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface BurnRateEntry {
  date: string;
  cost: number;
  cumulative: number;
  task: string;
}

interface AgentCostEntry {
  agent: string;
  cost: number;
}

export function CostDashboard({
  burnRate,
  perAgent,
}: {
  burnRate: BurnRateEntry[];
  perAgent: AgentCostEntry[];
}) {
  const totalCost = burnRate.length > 0
    ? burnRate[burnRate.length - 1].cumulative
    : 0;

  if (burnRate.length === 0 && perAgent.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No cost data yet. Run some agents to see the burn rate.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <span className="text-sm font-medium">Financial Dashboard</span>
        <span className="font-mono text-sm text-muted-foreground">
          Total: ${totalCost.toFixed(4)}
        </span>
      </div>
      <Tabs defaultValue="burn" className="p-4">
        <TabsList className="mb-4">
          <TabsTrigger value="burn">Burn Rate</TabsTrigger>
          <TabsTrigger value="agents">Per Agent</TabsTrigger>
        </TabsList>
        <TabsContent value="burn">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={burnRate}>
              <defs>
                <linearGradient id="burnFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.985 0 0 / 0.1)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "oklch(0.985 0 0 / 0.6)" }}
                axisLine={{ stroke: "oklch(0.985 0 0 / 0.15)" }}
                tickLine={{ stroke: "oklch(0.985 0 0 / 0.15)" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "oklch(0.985 0 0 / 0.6)" }}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                axisLine={{ stroke: "oklch(0.985 0 0 / 0.15)" }}
                tickLine={{ stroke: "oklch(0.985 0 0 / 0.15)" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "oklch(0.205 0 0)",
                  border: "1px solid oklch(0.985 0 0 / 0.15)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "oklch(0.985 0 0)",
                }}
                formatter={(value) => [`$${Number(value).toFixed(4)}`, "Cumulative"]}
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke="var(--chart-1)"
                fill="url(#burnFill)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </TabsContent>
        <TabsContent value="agents">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={perAgent} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.985 0 0 / 0.1)" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "oklch(0.985 0 0 / 0.6)" }}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                axisLine={{ stroke: "oklch(0.985 0 0 / 0.15)" }}
                tickLine={{ stroke: "oklch(0.985 0 0 / 0.15)" }}
              />
              <YAxis
                type="category"
                dataKey="agent"
                width={180}
                tick={{ fontSize: 10, fill: "oklch(0.985 0 0 / 0.6)" }}
                axisLine={{ stroke: "oklch(0.985 0 0 / 0.15)" }}
                tickLine={{ stroke: "oklch(0.985 0 0 / 0.15)" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "oklch(0.205 0 0)",
                  border: "1px solid oklch(0.985 0 0 / 0.15)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "oklch(0.985 0 0)",
                }}
                formatter={(value) => [`$${Number(value).toFixed(4)}`, "Cost"]}
              />
              <Bar
                dataKey="cost"
                fill="var(--chart-2)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </TabsContent>
      </Tabs>
    </div>
  );
}
