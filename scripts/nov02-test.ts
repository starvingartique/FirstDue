// Headless Nov 2 pass tests: blood sweep cost and honesty, defib pads flag,
// and the code-built FTO fallback debrief. Run: npm.cmd run sim:nov02.

import { newBikeDownSim } from "../src/sim/scenario";
import { newGeneratedSim } from "../src/dispatch/instantiate";
import type { FleshedCall } from "../src/dispatch/types";
import { evaluateHandoff } from "../src/ui/flow";
import {
  BIKE_DOWN_PATHWAY,
  FTO_FRAMING,
  buildFallbackDebrief,
  collectDebrief,
  factsToText
} from "../src/ui/debrief";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(here, "..", "data", "calls", "cache");

let failures = 0;

function check(name: string, cond: boolean, detail: string): void {
  if (cond) {
    console.log(`PASS ${name} (${detail})`);
  } else {
    failures += 1;
    console.log(`FAIL ${name} (${detail})`);
  }
}

function tick(sim: { tick: () => void }, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

// 1. Sweep costs 12 sim-seconds and changes nothing clinical.
{
  const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, "gen_143_L2.json"), "utf8")) as FleshedCall;
  const sim = newGeneratedSim(raw);
  sim.setLevel(2);
  const before = JSON.stringify({ loss: sim.loss_mL, vitals: sim.vitals, rate: sim.bleedRate_mL_per_min() });
  const started = sim.bloodSweep();
  check("sweep starts", started.ok, "ok");
  check("sweep pending runs 12s", sim.pending !== null && sim.pending.total_s === 12, `${sim.pending?.total_s}s`);
  const t0 = sim.t_s;
  tick(sim, 12);
  check("sweep takes 12 sim-seconds", sim.t_s === t0 + 12 && sim.pending === null, `t+${sim.t_s - t0}s`);
  const after = JSON.stringify({ loss: sim.loss_mL, vitals: sim.vitals, rate: sim.bleedRate_mL_per_min() });
  check("sweep changes no clinical state", before === after, "loss/vitals/rate equal");
  check("sweep writes the log", sim.log.some((e) => e.text.startsWith("Blood sweep:")), "exam line");
  check("sweep stores the report", sim.sweepReport !== null && sim.sweepReport.startsWith("Blood sweep:"), "stored");
  check(
    "sweep says a full exam is still needed",
    sim.sweepReport !== null && /full region-by-region exam is still needed/.test(sim.sweepReport),
    "still-needed line"
  );
  check(
    "medical sweep finds no wounds",
    sim.sweepReport !== null && /No wounds found/.test(sim.sweepReport) && /No active bleeding/.test(sim.sweepReport),
    "clean sweep"
  );
}

// 2. Sweep on a bleed names the wound from engine state.
{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  sim.takeOverFromBystander();
  sim.bloodSweep();
  tick(sim, 12);
  check(
    "bleed sweep names the femoral wound",
    sim.sweepReport !== null && /femoral bleed/.test(sim.sweepReport) && /Active bleeding/.test(sim.sweepReport),
    "femoral"
  );
}

// 3. Defib pads: display flag only, no physiological effect.
{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  const before = JSON.stringify(sim.vitals);
  const first = sim.attachDefibPads();
  check("pads attach", first.ok && sim.defibPadsOn, "on");
  check("pads change no vitals", JSON.stringify(sim.vitals) === before, "equal");
  check("pads log the exam line", sim.log.some((e) => /Defib pads on the chest/.test(e.text)), "logged");
  const again = sim.attachDefibPads();
  check("pads refuse a second pair", !again.ok, again.reason ?? "refused");
  const spo2 = sim.attachSpo2();
  check("spo2 probe still attaches (pill trigger)", spo2.ok && sim.monitor.spo2Attached, "on");
}

// 4. Fallback debrief on a well-played WIN run.
function finishPending(sim: { tick: () => void; busy: boolean; arrested: boolean }): void {
  let guard = 1000;
  while (sim.busy && guard > 0 && !sim.arrested) {
    sim.tick();
    guard -= 1;
  }
}

function wellPlayedWin(): string {
  const sim = newBikeDownSim();
  sim.setLevel(2);
  sim.addLog("info", "Level chosen: L2 EMT.");
  const steps: Array<() => { ok: boolean; reason?: string }> = [
    () => sim.takeOverFromBystander(),
    () => sim.exposeWound(),
    () => sim.removeBelt(),
    () => sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true })
  ];
  for (const step of steps) {
    const r = step();
    if (!r.ok) throw new Error(`setup step failed: ${r.reason ?? "unknown"}`);
    finishPending(sim);
  }
  if (sim.bleedRate_mL_per_min() >= 30) {
    sim.applySecondTQ({ placement: "proximal", loosenedFirst: false });
    finishPending(sim);
  }
  sim.bloodSweep();
  finishPending(sim);
  const { win, checks } = evaluateHandoff(sim);
  const facts = collectDebrief(sim, {
    levelLabel: "L2 test",
    destination: "Trauma center",
    sizeupCount: 5,
    radioComplete: true,
    checks,
    win,
    pathway: BIKE_DOWN_PATHWAY
  });
  return buildFallbackDebrief(facts);
}

{
  const text = wellPlayedWin();
  for (const section of [
    "Timeline of key moments",
    "What went right",
    "Misses",
    "Time to critical intervention",
    "Traps triggered",
    "Reassessment notes",
    "Destination (as logged)",
    "Radio (as logged)"
  ]) {
    check(`fallback has ${section}`, text.includes(section), "present");
  }
  check("fallback carries the sim framing", text.includes(FTO_FRAMING), "framing");
  check("fallback stamps first hands", /first hands on the bleed at T\+\d\d:\d\d/.test(text), "timestamp");
  check("fallback leaves destination ungraded", /not graded - no medic rule/.test(text), "open");
  check("fallback keeps the four questions open", /not settled here/.test(text), "open");
  check("fallback names the sweep", /Blood sweep/.test(text), "sweep");
  check("fallback wins the run", /HANDOFF, PATIENT ALIVE/.test(text), "win");
  check("fallback has no em-dashes", !/[\u2014\u2013]/.test(text), "clean");
  const facts = factsToText(
    collectDebrief(newBikeDownSim(), {
      levelLabel: "L2 test",
      destination: "Trauma center",
      sizeupCount: 5,
      radioComplete: false,
      checks: [],
      win: false,
      pathway: BIKE_DOWN_PATHWAY
    })
  );
  check("facts text carries the log and pathway", /Event log:/.test(facts) && facts.includes(BIKE_DOWN_PATHWAY), "facts");
}

// 5. Fallback debrief on an untreated LOSE run.
{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  tick(sim, 400);
  const { win, checks } = evaluateHandoff(sim);
  const text = buildFallbackDebrief(
    collectDebrief(sim, {
      levelLabel: "L2 test",
      destination: "Trauma center",
      sizeupCount: 0,
      radioComplete: false,
      checks,
      win,
      pathway: BIKE_DOWN_PATHWAY
    })
  );
  check("fallback loses the untreated run", !win && /RUN LOST/.test(text), "lose");
  check("fallback lists real misses", /No oxygen applied/.test(text) && /Wound never exposed/.test(text), "misses");
}

if (failures > 0) {
  console.log(`${failures} Nov 2 check(s) FAILED.`);
  process.exit(1);
}
console.log("All Nov 2 checks passed.");
