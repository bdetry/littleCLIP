"use client";

import { useEffect, useRef, useState } from "react";

interface LogLine {
  stream: "stdout" | "stderr";
  data: string;
  timestamp: number;
}

export function LogViewer({ taskId }: { taskId: string; }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "done" | "error">(
    "connecting"
  );
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/stream/${taskId}`);

    es.addEventListener("connected", () => setStatus("live"));

    es.addEventListener("log", (e) => {
      const data = JSON.parse(e.data) as LogLine;
      setLines((prev) => [...prev, data]);
    });

    es.addEventListener("done", (e) => {
      const data = JSON.parse(e.data) as { status: string };
      setStatus(data.status === "error" ? "error" : "done");
      es.close();
    });

    es.onerror = () => {
      setStatus("error");
      es.close();
    };

    return () => es.close();
  }, [taskId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="rounded border border-border/50 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5">
        <div
          className={`h-2 w-2 rounded-full ${
            status === "live"
              ? "animate-pulse bg-emerald-500"
              : status === "done"
                ? "bg-emerald-500"
                : status === "error"
                  ? "bg-red-500"
                  : "bg-zinc-500"
          }`}
        />
        <span className="font-mono text-xs text-zinc-400">
          {status === "connecting" && "Connecting..."}
          {status === "live" && "Live"}
          {status === "done" && "Completed"}
          {status === "error" && "Error"}
        </span>
      </div>
      <pre
        ref={scrollRef}
        className="max-h-60 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 && status === "live" && (
          <span className="text-zinc-600">Waiting for output...</span>
        )}
        {lines.map((line, i) => (
          <span
            key={i}
            className={
              line.stream === "stderr" ? "text-red-400" : "text-zinc-300"
            }
          >
            {line.data}
          </span>
        ))}
      </pre>
    </div>
  );
}
