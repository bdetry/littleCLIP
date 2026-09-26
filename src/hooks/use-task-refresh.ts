"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function useTaskRefresh() {
  const router = useRouter();

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.addEventListener("task-changed", () => {
      router.refresh();
    });

    es.onerror = () => {
      es.close();
      setTimeout(() => {
        // EventSource auto-reconnects, but if it fully errors we reopen
      }, 3_000);
    };

    return () => es.close();
  }, [router]);
}
