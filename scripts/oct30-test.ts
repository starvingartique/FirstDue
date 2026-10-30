// Headless acceptance tests for the Oct 30 end-to-end run. Runs the real Sim
// with fixed seeds plus the pure flow helpers, no browser. Exit 0 = pass.
// Run: npm.cmd run sim:test30 (PowerShell) or npm run sim:test30 (Mac).

import { newBikeDownSim } from "../src/sim/scenario";
import type { Sim } from "../src/sim/engine";
import {
  CONTROL_RATE_ML_PER_MIN,
  TRANSPORT_SKIP_S,
  evaluateHandoff,
  hintFor,
  missingMist,
  radioTruth
} from "../src/ui/flow";

let failures = 0;

function check(name: string, cond: boolean, detail: string): void {
  if (cond) {
    console.log(`PASS ${name} (${detail})`);
  } else {
    failures += 1;
    console.log(`FAIL ${name} (${detail})`);
  }
}

function tick(sim: Sim, n: number): void {
  for (let i = 0; i < n && !sim.arrested; i++) sim.tick();
}

function finishPending(sim: Sim): void {
  let guard = 1000;
  while (sim.busy && guard > 0 && !sim.arrested) {
    sim.tick();
    guard -= 1;
  }
}

function doAll(sim: Sim, steps: Array<() => { ok: boolean; reason?: string }>): boolean {
  for (const step of steps) {
    const r = step();
    if (!r.ok) return false;
    finishPending(sim);
  }
  return true;
}

// 1. Well-played L2 run: expose, belt off, TQ (+ second if residual), then
//    the 300 s transport skip. Must end alive with a WIN handoff.
{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  sim.addLog("info", "Level chosen: L2 EMT.");
  const ok = doAll(sim, [
    () => sim.takeOverFromBystander(),
    () => sim.exposeWound(),
    () => sim.removeBelt(),
    () => sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true })
  ]);
  check("well-played TQ sequence starts", ok, `t=${sim.t_s}s`);
  check("TQ occluded", sim.tq.applied && sim.tq.occluded, `residual=${sim.tq.residualFlow_0_to_1}`);
  if (sim.tq.residualFlow_0_to_1 > 0) {
    const second = sim.applySecondTQ({ placement: "proximal", loosenedFirst: false });
    check("second TQ starts", second.ok, second.reason ?? "ok");
    finishPending(sim);
  }
  check(
    "bleed controlled before transport",
    sim.bleedRate_mL_per_min() < CONTROL_RATE_ML_PER_MIN,
    `rate=${Math.round(sim.bleedRate_mL_per_min())}`
  );
  tick(sim, TRANSPORT_SKIP_S);
  check("survives the transport skip", !sim.arrested, `loss=${Math.round(sim.loss_mL)}mL class=${sim.vitals.atlsClass}`);
  const end = evaluateHandoff(sim);
  check(
    "well-played run WINS at handoff",
    end.win,
    end.checks.map((c) => `${c.pass ? "pass" : "FAIL"}:${c.label}`).join(" | ")
  );
}

// 2. Untreated L2 run: no care at all. Must arrest (lose reachable).
{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  tick(sim, 1500);
  check("untreated run arrests", sim.arrested, `t=${sim.t_s}s loss=${Math.round(sim.loss_mL)}mL`);
  const end = evaluateHandoff(sim);
  check("untreated run LOSES at handoff", !end.win, end.checks.map((c) => `${c.pass ? "pass" : "FAIL"}`).join(","));
}

// 3. Lose during transport: brief delay, then load-and-go with the bleed
//    still open. Must arrest inside the skip.
{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  sim.takeOverFromBystander();
  tick(sim, 60);
  const rate = sim.bleedRate_mL_per_min();
  tick(sim, TRANSPORT_SKIP_S);
  check(
    "open bleed arrests inside the transport skip",
    sim.arrested,
    `rate was ${Math.round(rate)}/min, t=${sim.t_s}s`
  );
}

// 4. L1 slow deterioration: same seed, 60 s, no care. L1 accrues about half.
{
  const l1 = newBikeDownSim();
  l1.setLevel(1);
  const l2 = newBikeDownSim();
  l2.setLevel(2);
  tick(l1, 60);
  tick(l2, 60);
  const gain1 = l1.loss_mL - 1100;
  const gain2 = l2.loss_mL - 1100;
  const ratio = gain1 / gain2;
  check("L1 accrues about half the loss of L2", ratio > 0.4 && ratio < 0.6, `ratio=${ratio.toFixed(2)}`);
  check("L2 scale stays exactly 1.0", l2.deteriorationScale === 1, `scale=${l2.deteriorationScale}`);
}

// 5. Pure flow helpers: hints, MIST gaps, nurse truth.
{
  const sim = newBikeDownSim();
  sim.setLevel(1);
  const hint = hintFor(sim);
  check("L1 opening hint is the bleed check", hint !== null && /check for bleeding/.test(hint), hint ?? "null");
  const full = "28M bike vs guardrail. Left thigh femoral bleed. HR 130, BP 90 palp, RR 24, SpO2 95, alert. CAT on with time, O2 on, IV fluids.";
  check("full MIST text has no gaps", missingMist(full).length === 0, missingMist(full).join(",") || "none");
  check("empty text misses all four", missingMist("").length === 4, missingMist("").join(","));
  const truth = radioTruth(sim);
  check(
    "nurse truth covers mechanism, injury, signs, treatment",
    /Mechanism/.test(truth) && /Injuries/.test(truth) && /Signs now/.test(truth) && /Treatment/.test(truth),
    `${truth.length} chars`
  );
}

if (failures > 0) {
  console.log(`${failures} Oct 30 check(s) FAILED.`);
  process.exit(1);
}
console.log("All Oct 30 checks passed.");
