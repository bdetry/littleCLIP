#!/usr/bin/env node
// Env-driven fake agent for runner tests.
//
// Reads the AgentInput JSON from stdin, then:
//   FIXTURE_DELAY_MS  - sleep before responding (default 0)
//   FIXTURE_STDERR    - text written to stderr (optional)
//   FIXTURE_STDOUT    - raw text printed to stdout. Default: a valid AgentOutput
//                       whose `output` is the stringified input received, and
//                       `cost` is 1, so tests can inspect what the runner sent.
//   FIXTURE_EXIT_CODE - process exit code (default 0)

const chunks = [];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", async () => {
  const raw = chunks.join("");
  let input = null;
  try {
    input = JSON.parse(raw);
  } catch {
    input = { parse_error: true, raw };
  }

  const delay = Number(process.env.FIXTURE_DELAY_MS || 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));

  if (process.env.FIXTURE_STDERR) {
    process.stderr.write(process.env.FIXTURE_STDERR);
  }

  // Noise before the JSON to exercise last-JSON extraction.
  process.stdout.write("[fixture] starting\n");

  // Echo TASK_ID plus every FIXTURE_* variable so tests can assert env delivery.
  const env = { TASK_ID: process.env.TASK_ID };
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("FIXTURE_")) env[k] = v;
  }

  const stdout =
    process.env.FIXTURE_STDOUT !== undefined
      ? process.env.FIXTURE_STDOUT
      : JSON.stringify({ output: JSON.stringify({ input, env }), cost: 1 });

  process.stdout.write(stdout + "\n");

  const code = Number(process.env.FIXTURE_EXIT_CODE || 0);
  process.exitCode = code;
});
