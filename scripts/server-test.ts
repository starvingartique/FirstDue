// Acceptance probe: hits the local server /api/test route and prints the live
// Muse Spark reply, then the /api/patient route as Josh. Start the server
// first (`npm run dev:server`). Exits 1 on any failure so CI and checklists
// get a clear signal.

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

  const patient = await fetch(`${BASE}/api/patient`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "What happened, and how bad is the pain?",
      state: "Pain: severe pain (8/10 if he names it). No tourniquet is on. His thigh wound is bleeding. He breathes fast but can still talk. He is scared and shaky but answers clearly.",
      history: []
    })
  });
  const pdata = (await patient.json()) as TestWire;
  if (!patient.ok) {
    console.error(`patient ${patient.status}: ${String(pdata.error ?? "unknown error")}`);
    process.exit(1);
  }
  const ptext = String(pdata.text ?? "");
  console.log(`patient model: ${String(pdata.model ?? "unknown")}`);
  console.log(`patient text: ${ptext}`);
  if (ptext.includes("\u2014") || ptext.includes("\u2013")) {
    console.error("patient reply contains an em/en-dash");
    process.exit(1);
  }
} catch (error) {
  console.error(`server-test failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Is the server running? Start it with: npm run dev:server`);
  process.exit(1);
}
