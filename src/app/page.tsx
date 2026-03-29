import { getTasksPaginated, getCostData, getMonitoringStats } from "./actions";
import { getAgents } from "./agent-actions";
import { KanbanBoard } from "@/components/kanban/board";
import { CostDashboard } from "@/components/cost-dashboard";
import { MonitoringStrip } from "@/components/monitoring-strip";
import { CreateTaskDialog } from "@/components/create-task-dialog";
import { NavHeader } from "@/components/nav-header";
import { Separator } from "@/components/ui/separator";
import { getTickRunning } from "./settings-actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [taskPage, costData, agents, stats] = await Promise.all([
    getTasksPaginated(0, 100),
    getCostData(),
    getAgents(),
    getMonitoringStats(),
  ]);

  const tickRunning = await getTickRunning();

  return (
    <main className="min-h-screen bg-background">
      <NavHeader taskCount={taskPage.total} />

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Task Board
          </h2>
          <CreateTaskDialog agents={agents} tickRunning={tickRunning} />
        </div>

        <section className="max-h-[50vh]">
          <KanbanBoard
            initialTasks={taskPage.tasks}
            agents={agents}
            initialHasMore={taskPage.hasMore}
            maxHeight="calc(50vh - 3rem)"
          />
        </section>

        <Separator className="my-6" />

        <section className="mb-6">
          <MonitoringStrip stats={stats} />
        </section>

        <Separator className="mb-6" />

        <section className="max-h-[50vh] overflow-auto">
          <CostDashboard
            burnRate={costData.burnRate}
            perAgent={costData.perAgent}
          />
        </section>
      </div>
    </main>
  );
}
