import { getCostData, getTasks } from "@/app/actions";
import { getAgents } from "@/app/agent-actions";
import { NavHeader } from "@/components/nav-header";
import { CostDashboard } from "@/components/cost-dashboard";
import { AgentFilter } from "@/components/agent-filter";

export const dynamic = "force-dynamic";

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const { agent: agentId } = await searchParams;
  const [tasks, costData, agents] = await Promise.all([
    getTasks(),
    getCostData(agentId),
    getAgents(),
  ]);

  return (
    <main className="min-h-screen bg-background">
      <NavHeader taskCount={tasks.length} />

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Financial Dashboard
          </h2>
          <AgentFilter agents={agents} />
        </div>
        <CostDashboard
          burnRate={costData.burnRate}
          perAgent={costData.perAgent}
        />
      </div>
    </main>
  );
}
