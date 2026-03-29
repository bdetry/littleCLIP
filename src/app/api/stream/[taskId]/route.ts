import { NextRequest } from "next/server";
import { taskEventBus, type TaskLogEvent } from "@/lib/event-bus";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      sendEvent("connected", { taskId, timestamp: Date.now() });

      const unsubLog = taskEventBus.onLog(taskId, (event: TaskLogEvent) => {
        sendEvent("log", event);
      });

      const unsubDone = taskEventBus.onDone(taskId, (event) => {
        sendEvent("done", event);
        setTimeout(() => {
          unsubLog();
          try {
            controller.close();
          } catch {
            // stream already closed
          }
        }, 100);
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
        unsubLog();
        unsubDone();
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
