import { NavHeader } from "@/components/nav-header";
import { AgentGraph } from "@/components/agent-graph";
import { getAgentGraph } from "@/app/graph-actions";

export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const { nodes, edges } = await getAgentGraph();

  const hasInteractions = edges.length > 0;

  return (
    <main className="min-h-screen bg-background">
      <NavHeader />

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Agent Interactions
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            {nodes.length} agent{nodes.length !== 1 ? "s" : ""} · {edges.length}{" "}
            link{edges.length !== 1 ? "s" : ""}
          </span>
        </div>

        {!hasInteractions && nodes.length === 0 ? (
          <div className="rounded-lg border border-border/50 bg-muted/30 p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No agents registered yet. Register agents and run tasks to see
              their interactions.
            </p>
          </div>
        ) : !hasInteractions ? (
          <div className="rounded-lg border border-border/50 bg-muted/30 p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No interactions yet. Run tasks with chained agents to see the
              graph.
            </p>
          </div>
        ) : (
          <div className="h-[calc(100vh-10rem)] rounded-lg border border-border/50 bg-muted/30">
            <AgentGraph nodes={nodes} edges={edges} />
          </div>
        )}
      </div>
    </main>
  );
}
