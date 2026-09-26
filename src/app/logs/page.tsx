import { getTasksWithLogsPaginated } from "@/app/actions";
import { getAgents } from "@/app/agent-actions";
import { NavHeader } from "@/components/nav-header";
import { LogsList } from "@/components/logs-list";
import { AgentFilter } from "@/components/agent-filter";
import { ErrorFilter } from "@/components/error-filter";

export const dynamic = "force-dynamic";

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; errors?: string }>;
}) {
  const { agent: agentId, errors } = await searchParams;
  const errorsOnly = errors === "1";

  const [page, agents] = await Promise.all([
    getTasksWithLogsPaginated(0, 100, agentId, errorsOnly),
    getAgents(),
  ]);

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  return (
    <main className="min-h-screen bg-background">
      <NavHeader />

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Execution Logs
          </h2>
          <div className="flex items-center gap-2">
            <ErrorFilter />
            <AgentFilter agents={agents} />
          </div>
        </div>

        <LogsList
          key={`${agentId ?? "__all"}_${errorsOnly}`}
          initialTasks={page.tasks}
          initialHasMore={page.hasMore}
          agentMap={agentMap}
          agentId={agentId}
          errorsOnly={errorsOnly}
        />
      </div>
    </main>
  );
}
