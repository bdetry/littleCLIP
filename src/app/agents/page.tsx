import { getAgentStats } from "@/app/agent-actions";
import { NavHeader } from "@/components/nav-header";
import { CreateAgentDialog } from "@/components/create-agent-dialog";
import { AgentCard } from "@/components/agent-card";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await getAgentStats();

  return (
    <main className="min-h-screen bg-background">
      <NavHeader />

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Registered Agents ({agents.length})
          </h2>
          <CreateAgentDialog />
        </div>

        {agents.length === 0 ? (
          <div className="rounded-lg border border-border/50 bg-muted/30 p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No agents registered yet. Click &quot;Register Agent&quot; to add one.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
