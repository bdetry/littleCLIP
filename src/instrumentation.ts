export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  const { tickEngine } = await import("@/lib/ticker");
  await tickEngine.start();
}
