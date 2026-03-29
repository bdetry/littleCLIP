"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function ErrorFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = searchParams.get("errors") === "1";

  function toggle() {
    const params = new URLSearchParams(searchParams.toString());
    if (active) {
      params.delete("errors");
    } else {
      params.set("errors", "1");
    }
    router.push(`?${params.toString()}`);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-red-500/50 bg-red-500/10 text-red-400"
          : "border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {active ? "Showing errors only" : "Errors only"}
    </button>
  );
}
