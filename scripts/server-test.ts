// Acceptance probe: hits the local server /api/test route and prints the live
// Muse Spark reply. Start the server first (`npm run dev:server`). Exits 1 on
// any failure so CI and checklists get a clear signal.

export {};

const BASE = process.env["SERVER_URL"] ?? "http://localhost:8787";

interface TestWire {
  text?: unknown;
  model?: unknown;
  error?: unknown;
}

try {
  const response = await fetch(`${BASE}/api/test`);
  const data = (await response.json()) as TestWire;
  if (!response.ok) {
    console.error(`server ${response.status}: ${String(data.error ?? "unknown error")}`);
    process.exit(1);
  }
  console.log(`model: ${String(data.model ?? "unknown")}`);
  console.log(`text: ${String(data.text ?? "")}`);
} catch (error) {
  console.error(`server-test failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Is the server running? Start it with: npm run dev:server`);
  process.exit(1);
}
