"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { Agent } from "@/db/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AgentFilter({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentAgentId = searchParams.get("agent") ?? "";

  const handleChange = (value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("agent", value);
    } else {
      params.delete("agent");
    }
    router.push(`?${params.toString()}`);
    router.refresh();
  };

  return (
    <Select value={currentAgentId} onValueChange={handleChange}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="All Agents" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">All Agents</SelectItem>
        {agents.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
