import { NextRequest } from "next/server";
import { taskEventBus, type TaskChangedEvent } from "@/lib/event-bus";
import { tickEngine } from "@/lib/ticker";

export const dynamic = "force-dynamic";

tickEngine.start();

export async function GET(_req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      send("connected", { timestamp: Date.now() });

      const unsub = taskEventBus.onTaskChanged((event: TaskChangedEvent) => {
        send("task-changed", event);
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      _req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
