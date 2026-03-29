"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { GraphNode, GraphEdge } from "@/app/graph-actions";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const NODE_RADIUS = 24;
const MAX_STROKE = 4;

interface SimNode extends SimulationNodeDatum {
  id: string;
  name: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  weight: number;
}

interface TooltipState {
  x: number;
  y: number;
  text: string;
}

function hasBidirectional(edges: GraphEdge[], source: string, target: string) {
  return edges.some((e) => e.source === target && e.target === source);
}

function buildCurvedPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  curvature: number
): string {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const cx = mx - dy * curvature;
  const cy = my + dx * curvature;
  return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
}

function buildSelfLoopPath(cx: number, cy: number, r: number): string {
  const loopR = r * 2.2;
  const startX = cx - r * 0.55;
  const startY = cy - r * 0.85;
  const endX = cx + r * 0.55;
  const endY = cy - r * 0.85;
  const cp1x = cx - loopR;
  const cp1y = cy - loopR * 1.6;
  const cp2x = cx + loopR;
  const cp2y = cy - loopR * 1.6;
  return `M ${startX} ${startY} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${endX} ${endY}`;
}

export function AgentGraph({
  nodes: rawNodes,
  edges: rawEdges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [simLinks, setSimLinks] = useState<SimLink[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (rawNodes.length === 0) return;

    const nodeMap = new Map<string, SimNode>();
    const nodes: SimNode[] = rawNodes.map((n) => {
      const node: SimNode = { id: n.id, name: n.name };
      nodeMap.set(n.id, node);
      return node;
    });

    const allLinks: SimLink[] = rawEdges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
      }));

    const forceLinks = allLinks.filter(
      (l) => (l.source as string) !== (l.target as string)
    );
    const selfLinks = allLinks.filter(
      (l) => (l.source as string) === (l.target as string)
    );

    const maxWeight = Math.max(1, ...allLinks.map((l) => l.weight));

    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(forceLinks)
          .id((d) => d.id)
          .distance((d) => 200 - (d.weight / maxWeight) * 60)
      )
      .force("charge", forceManyBody().strength(-500))
      .force(
        "center",
        forceCenter(dimensions.width / 2, dimensions.height / 2)
      )
      .force("collide", forceCollide(NODE_RADIUS * 2.5));

    sim.on("tick", () => {
      setSimNodes(nodes.map((n) => ({ ...n })));

      const resolvedForceLinks = forceLinks.map((l) => ({
        ...l,
        source: l.source as SimNode,
        target: l.target as SimNode,
        weight: l.weight,
      }));

      const resolvedSelfLinks = selfLinks.map((l) => {
        const node = nodeMap.get(l.source as string)!;
        return {
          ...l,
          source: node,
          target: node,
          weight: l.weight,
        };
      });

      setSimLinks([...resolvedForceLinks, ...resolvedSelfLinks]);
    });

    return () => {
      sim.stop();
    };
  }, [rawNodes, rawEdges, dimensions.width, dimensions.height]);

  const nodeColorMap = useCallback(
    (id: string) => {
      const idx = rawNodes.findIndex((n) => n.id === id);
      return CHART_COLORS[idx % CHART_COLORS.length];
    },
    [rawNodes]
  );

  const maxWeight = Math.max(1, ...rawEdges.map((e) => e.weight));

  function getSourceNode(link: SimLink): SimNode {
    return link.source as SimNode;
  }
  function getTargetNode(link: SimLink): SimNode {
    return link.target as SimNode;
  }

  function strokeWidth(weight: number): number {
    return Math.min(MAX_STROKE, 0.75 + (weight / maxWeight) * (MAX_STROKE - 0.75));
  }

  function strokeOpacity(weight: number): number {
    return 0.25 + (weight / maxWeight) * 0.45;
  }

  return (
    <div ref={containerRef} className="relative h-full w-full min-h-[400px]">
      <svg width={dimensions.width} height={dimensions.height}>
        <defs>
          <marker
            id="dot"
            viewBox="0 0 6 6"
            refX={3}
            refY={3}
            markerWidth={4}
            markerHeight={4}
            orient="auto"
          >
            <circle cx={3} cy={3} r={2.5} fill="oklch(0.985 0 0 / 0.5)" />
          </marker>
        </defs>

        {simLinks.map((link, i) => {
          const s = getSourceNode(link);
          const t = getTargetNode(link);
          if (s.x == null || s.y == null || t.x == null || t.y == null)
            return null;

          const isSelfLoop = s.id === t.id;

          let d: string;
          if (isSelfLoop) {
            d = buildSelfLoopPath(s.x, s.y, NODE_RADIUS);
          } else {
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;

            const sx = s.x + ux * NODE_RADIUS;
            const sy = s.y + uy * NODE_RADIUS;
            const tx = t.x - ux * NODE_RADIUS;
            const ty = t.y - uy * NODE_RADIUS;

            const isBidir = hasBidirectional(rawEdges, s.id, t.id);
            const curvature = isBidir ? 0.15 : 0;
            d = curvature
              ? buildCurvedPath(sx, sy, tx, ty, curvature)
              : `M ${sx} ${sy} L ${tx} ${ty}`;
          }

          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={`oklch(0.985 0 0 / ${strokeOpacity(link.weight)})`}
              strokeWidth={strokeWidth(link.weight)}
              strokeLinecap="round"
              markerEnd="url(#dot)"
              onMouseEnter={(e) => {
                const sourceName =
                  rawNodes.find((n) => n.id === s.id)?.name ?? s.id;
                const targetName =
                  rawNodes.find((n) => n.id === t.id)?.name ?? t.id;
                const label = isSelfLoop
                  ? `${sourceName} → self: ${link.weight} task${link.weight !== 1 ? "s" : ""}`
                  : `${sourceName} → ${targetName}: ${link.weight} task${link.weight !== 1 ? "s" : ""}`;
                setTooltip({
                  x: e.clientX,
                  y: e.clientY,
                  text: label,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
              className="cursor-pointer"
            />
          );
        })}

        {simNodes.map((node) => {
          if (node.x == null || node.y == null) return null;
          const color = nodeColorMap(node.id);
          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_RADIUS}
                fill={color}
                fillOpacity={0.15}
                stroke={color}
                strokeWidth={1.5}
              />
              <text
                x={node.x}
                y={node.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="oklch(0.985 0 0 / 0.85)"
                fontSize={10}
                fontFamily="var(--font-geist-mono), monospace"
              >
                {node.name.length > 8
                  ? node.name.slice(0, 7) + "…"
                  : node.name}
              </text>
            </g>
          );
        })}
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-border/50 bg-popover px-3 py-1.5 font-mono text-xs text-popover-foreground shadow-md"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
