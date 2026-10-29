// Headless acceptance tests for the Oct 28 engine. Runs the real Sim with
// fixed seeds, no browser. Exit 0 = all pass, exit 1 = first failure.
// Run: npm.cmd run sim:test (PowerShell) or npm run sim:test (Mac).

import { newBikeDownSim, newTestSim } from "../src/sim/scenario";
import type { Sim } from "../src/sim/engine";

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
  for (let i = 0; i < n; i++) sim.tick();
}

function finishPending(sim: Sim): void {
  let guard = 1000;
  while (sim.busy && guard > 0) {
    sim.tick();
    guard -= 1;
  }
}

// 1. Untreated curve from 0 mL: II ~1.5 min, III ~3 min, IV ~4 min,
//    arrest window (over 50 percent) ~5-6 min, then PEA.
{
  const sim = newTestSim(1027, 0);
  let tII = -1;
  let tIII = -1;
  let tIV = -1;
  let tWindow = -1;
  for (let t = 0; t < 900 && !sim.arrested; t++) {
    sim.tick();
    const c = sim.vitals.atlsClass;
    if (tII < 0 && (c === "II" || c === "III" || c === "IV")) tII = t;
    if (tIII < 0 && (c === "III" || c === "IV")) tIII = t;
    if (tIV < 0 && c === "IV") tIV = t;
    if (tWindow < 0 && sim.vitals.loss_pct > 50) tWindow = t;
  }
  check("untreated Class II ~1.5 min", tII >= 45 && tII <= 150, `t=${tII}s`);
  check("untreated Class III ~3 min", tIII >= 100 && tIII <= 260, `t=${tIII}s`);
  check("untreated Class IV ~4 min", tIV >= 150 && tIV <= 340, `t=${tIV}s`);
  check("arrest window ~5-6 min", tWindow >= 220 && tWindow <= 420, `t=${tWindow}s`);
  check("untreated ends in PEA", sim.arrested && sim.vitals.rhythm === "pea", `arrested=${sim.arrested}`);
}

// 2. Correct TQ within ~3 min keeps him out of Class IV.
{
  const sim = newTestSim(1027, 0);
  tick(sim, 150);
  const before = sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
  check("TQ starts", before.ok, before.reason ?? "ok");
  finishPending(sim);
  check("TQ occluded", sim.tq.applied && sim.tq.occluded, `residual=${sim.tq.residualFlow_0_to_1}`);
  if (sim.tq.residualFlow_0_to_1 > 0) {
    const second = sim.applySecondTQ({ placement: "proximal", loosenedFirst: false });
    check("second TQ starts", second.ok, second.reason ?? "ok");
    finishPending(sim);
  }
  tick(sim, 300);
  check("TQ within 3 min keeps out of Class IV", sim.vitals.atlsClass !== "IV" && !sim.arrested,
    `class=${sim.vitals.atlsClass} loss=${sim.vitals.loss_mL}mL`);
}

// 3. Venous tourniquet trap: rate x1.3, limb engorged and blue.
{
  const sim = newTestSim(7, 0);
  tick(sim, 5);
  const uncontrolled = sim.bleedRate_mL_per_min();
  sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 1, writeTime: true });
  finishPending(sim);
  const venous = sim.bleedRate_mL_per_min();
  const ratio = venous / uncontrolled;
  check("venous TQ x1.3", sim.tq.placement === "venous_loose" && ratio > 1.2 && ratio < 1.4,
    `ratio=${ratio.toFixed(2)}`);
  check("venous limb congested", sim.legCongested(), "engorged and blue");
}

// 4. Slack strap trap: windlass maxes out, start over.
{
  const sim = newTestSim(7, 0);
  sim.applyTQ({ strapTight: false, placement: "high_thigh", halfTurns: 5, writeTime: true });
  finishPending(sim);
  check("slack strap fails", sim.tq.failedSlack && !sim.tq.applied, "must start over");
  const retry = sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
  finishPending(sim);
  check("retry after slack works", retry.ok && sim.tq.applied, `applied=${sim.tq.applied}`);
}

// 5. Packing traps: early release can rebleed, peeking restarts at full rate.
{
  let sawRebleed = false;
  for (let seed = 1; seed <= 30 && !sawRebleed; seed++) {
    const sim = newTestSim(seed, 0);
    sim.exposeWound();
    finishPending(sim);
    sim.packWound({ technique: "packed", gauze: "hemostatic" });
    finishPending(sim);
    sim.holdPacking("partner");
    tick(sim, 60);
    sim.releasePackingEarly();
    if (sim.packing.stage === "failed") sawRebleed = true;
  }
  check("early release can rebleed (60% roll)", sawRebleed, "found a failing seed in 1..30");

  const sim = newTestSim(11, 0);
  sim.exposeWound();
  finishPending(sim);
  sim.packWound({ technique: "packed", gauze: "hemostatic" });
  finishPending(sim);
  sim.holdPacking("partner");
  tick(sim, 185);
  check("3 min hold sets packing", sim.packing.stage === "set", sim.packing.stage);
  const setRate = sim.bleedRate_mL_per_min();
  sim.peekPacking();
  const peekRate = sim.bleedRate_mL_per_min();
  check("peeking restarts full bleed", sim.packing.stage === "none" && peekRate > setRate * 3,
    `set=${Math.round(setRate)} peek=${Math.round(peekRate)}`);
}

// 6. Movement loosens, reassessment restores. Pressure is lost on a move.
{
  const sim = newTestSim(7, 0);
  sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
  finishPending(sim);
  sim.startPressure({ quality: "firm", holder: "partner" });
  const controlled = sim.bleedRate_mL_per_min();
  sim.movePatient("log_roll");
  check("TQ loosened by log roll", sim.tq.loosened, "reassessment required");
  check("pressure lost on move", !sim.pressure.active, "must re-establish");
  check("bleed worse while loosened", sim.bleedRate_mL_per_min() > controlled, "flow resumes");
  sim.reassessBleeding();
  finishPending(sim);
  check("reassess restores control", !sim.tq.loosened, "control restored");
}

// 7. Cabinet fetch costs 45-60 s, jump bag items are immediate.
{
  const sim = newBikeDownSim();
  check("jump CAT immediate", sim.atPatient("cat_tourniquet") === 3, `have=${sim.atPatient("cat_tourniquet")}`);
  check("SAM JT not at patient", sim.atPatient("junctional_tourniquet_samjt") === 0, "cabinet only");
  const fetch = sim.fetchFromTruck("junctional_tourniquet_samjt", "partner");
  const job = sim.fetches[0];
  check("fetch starts", fetch.ok && job !== undefined, fetch.reason ?? "ok");
  check("fetch costs 45-60 s", job !== undefined && job.total_s >= 45 && job.total_s <= 60,
    `total=${job?.total_s ?? -1}s`);
  tick(sim, 50);
  check("fetch delivers", sim.atPatient("junctional_tourniquet_samjt") === 1, "brought to patient");
}

// 8. Bike down scene start: 1,100 mL, shirt at 50 percent, belt x1.3, spurt.
{
  const sim = newBikeDownSim();
  check("contact loss 1,100 mL", Math.round(sim.loss_mL) === 1100, `${Math.round(sim.loss_mL)}mL`);
  check("bystander shirt on", sim.pressure.bystanderShirt, "about 50 percent");
  check("belt trap on", sim.beltTrap, "x1.3");
  check("stress offset on", sim.stressActive, "HR+15 RR+4 SBP+10 pain 7-8");
  const withShirt = sim.bleedRate_mL_per_min();
  sim.takeOverFromBystander();
  const spurt = sim.bleedRate_mL_per_min();
  check("takeover spurts", !sim.pressure.bystanderShirt && spurt > withShirt * 1.5,
    `${Math.round(withShirt)} -> ${Math.round(spurt)} mL/min`);
  check("no arrest at contact", !sim.arrested && sim.vitals.atlsClass === "II", `class=${sim.vitals.atlsClass}`);
}

if (failures > 0) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All sim checks passed.");
