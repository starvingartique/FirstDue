// Headless acceptance tests for the Oct 29 kit depth build. Runs the real
// Sim with fixed seeds, no browser. Exit 0 = all pass, exit 1 = failure.
// Run: npm.cmd run sim:test29 (PowerShell) or npm run sim:test29 (Mac).

import { newTestSim } from "../src/sim/scenario";
import type { Sim } from "../src/sim/engine";
import { Rng } from "../src/sim/rng";
import { drugCatalog, formatDose } from "../src/sim/drugs";
import { tankMinutesLeft } from "../src/sim/airway";
import { bpAuscultatedRead, capRefillRead, glucoseRead } from "../src/sim/exams";

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
  let guard = 2000;
  while (sim.busy && guard > 0) {
    sim.tick();
    guard -= 1;
  }
}

function calmAirway(sim: Sim): void {
  // Josh has an intact gag, so OPA sizing needs an unconscious stand-in.
  sim.airway.gagIntact = false;
}

// 1. Airway sizing: every wrong size produces its listed failure.
{
  const a = newTestSim(21, 0);
  calmAirway(a);
  a.insertOpa(80);
  finishPending(a);
  check("OPA 80 too small: patency -0.4", Math.abs(a.airway.patency_0_to_1 - 0.6) < 0.01, `patency=${a.airway.patency_0_to_1}`);

  const b = newTestSim(22, 0);
  calmAirway(b);
  b.insertOpa(100);
  finishPending(b);
  check("OPA 100 correct: patent", b.airway.patency_0_to_1 === 1, `patency=${b.airway.patency_0_to_1}`);

  const c = newTestSim(23, 0);
  c.insertOpa(100);
  finishPending(c);
  check("OPA with intact gag: vomits + aspirates", c.airway.vomited && c.airway.aspirated, "contraindication");

  const d = newTestSim(24, 0);
  d.insertNpa(26);
  finishPending(d);
  check("NPA 26 too small: no benefit", d.airway.patency_0_to_1 === 1 && !d.airway.epistaxis, "patency unchanged");

  const e = newTestSim(25, 0);
  e.insertNpa(34);
  finishPending(e);
  check("NPA 34 too big: epistaxis + gastric air", e.airway.epistaxis && e.airway.gastricAir, "listed failure");

  const f = newTestSim(26, 0);
  f.insertNpa(30);
  finishPending(f);
  check("NPA 30 correct: patent", f.airway.patency_0_to_1 === 1, "seated");

  const g = newTestSim(27, 0);
  g.placeSupraglottic("igel", 3);
  finishPending(g);
  check("i-gel #3: leak fit", g.airway.adjunct?.fit === "small", `fit=${g.airway.adjunct?.fit}`);

  const h = newTestSim(28, 0);
  h.placeSupraglottic("igel", 4);
  finishPending(h);
  check("i-gel #4 correct", h.airway.adjunct?.fit === "correct", "seated");

  const k = newTestSim(29, 0);
  k.placeSupraglottic("kinglt", 5);
  finishPending(k);
  check("King #5: will not seat", k.airway.adjunct?.fit === "big", `fit=${k.airway.adjunct?.fit}`);
}

// 2. ETT: sizing, depth, esophageal vs waveform confirmation.
{
  const a = newTestSim(31, 500);
  a.attachEtco2();
  a.intubate(7.5, 22, false, 25);
  finishPending(a);
  tick(a, 2);
  check("ETT 7.5 at 22 tracheal", a.airway.ett?.placement === "tracheal", `${a.airway.ett?.placement}`);
  check("correct ETT: waveform EtCO2", a.vitals.etco2Waveform === true, `waveform=${a.vitals.etco2Waveform}`);

  const b = newTestSim(32, 500);
  b.attachEtco2();
  b.intubate(7.5, 25, false, 25);
  finishPending(b);
  tick(b, 2);
  check("ETT at 25 cm: mainstem", b.airway.ett?.placement === "mainstem", `${b.airway.ett?.placement}`);
  b.checkLungs();
  finishPending(b);
  check("mainstem: left sounds absent", (b.observed.lungs?.value ?? "").includes("LEFT ABSENT"), `${b.observed.lungs?.value}`);

  const c = newTestSim(33, 500);
  c.attachEtco2();
  c.intubate(8.0, 23, true, 25);
  finishPending(c);
  const spo2atPlacement = c.vitals.spo2_pct;
  tick(c, 30);
  check("blind ETT: esophageal, no waveform", c.airway.ett?.placement === "esophageal" && !c.vitals.etco2Waveform, `etco2=${c.vitals.etco2_mmhg}`);
  check("esophageal: SpO2 falls ~2 per 10s", spo2atPlacement - c.vitals.spo2_pct >= 5, `${spo2atPlacement} -> ${c.vitals.spo2_pct}`);

  const d = newTestSim(34, 500);
  d.intubate(8.5, 23, false, 25);
  finishPending(d);
  check("ETT 8.5 too big: will not pass", d.airway.ett === null, "no tube placed");

  const e = newTestSim(35, 500);
  e.intubate(7.0, 22, false, 25);
  finishPending(e);
  check("ETT 7.0 too small: cuff leak", e.airway.ett?.cuffLeak === true, "resistance + leak");

  const f = newTestSim(36, 500);
  f.intubate(7.5, 22, false, 25);
  finishPending(f);
  f.movePatient("log_roll");
  check("unsecured ETT dislodges on move", f.airway.ett === null && f.airway.dislodged, "dislodged");

  const g = newTestSim(37, 500);
  g.intubate(7.5, 22, false, 25);
  finishPending(g);
  g.secureTube();
  finishPending(g);
  g.movePatient("log_roll");
  check("secured ETT holds on move", g.airway.ett !== null, "still in");
}

// 3. BVM: correct ventilates, overventilation drops SBP + gastric climb.
{
  const a = newTestSim(41, 1500);
  a.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
  finishPending(a);
  if (a.tq.residualFlow_0_to_1 > 0) {
    a.applySecondTQ({ placement: "proximal", loosenedFirst: false });
    finishPending(a);
  }
  const sbpBefore = a.vitals.sbp_mmhg;
  for (let i = 0; i < 6; i++) {
    a.squeezeBvm(550);
    tick(a, 6);
  }
  check("correct BVM: no gastric climb", a.bvm.gastric_0_to_10 === 0, `gastric=${a.bvm.gastric_0_to_10}`);
  check("correct BVM: SBP holds", a.vitals.sbp_mmhg >= sbpBefore - 2, `${sbpBefore} -> ${a.vitals.sbp_mmhg}`);

  const b = newTestSim(42, 1500);
  b.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
  finishPending(b);
  if (b.tq.residualFlow_0_to_1 > 0) {
    b.applySecondTQ({ placement: "proximal", loosenedFirst: false });
    finishPending(b);
  }
  const sbpCalm = b.vitals.sbp_mmhg;
  for (let i = 0; i < 16; i++) {
    b.squeezeBvm(800);
    tick(b, 2);
  }
  check("overvent: gastric climbs", b.bvm.gastric_0_to_10 > 0, `gastric=${b.bvm.gastric_0_to_10}`);
  check("overvent: SBP drops", b.vitals.sbp_mmhg < sbpCalm - 3, `${sbpCalm} -> ${b.vitals.sbp_mmhg}`);

  const c = newTestSim(43, 0);
  c.setBvmMask("small");
  c.squeezeBvm(550);
  check("small BVM mask: leak logged", c.log.some((e) => e.text.includes("x0.5")), "tidal volume x0.5");
}

// 4. O2: devices, NRB trap, tank math.
{
  check("tank math: full D at 15 L is ~19 min", Math.abs(tankMinutesLeft(2000, 0.16, 15) - 19.2) < 0.1, `${tankMinutesLeft(2000, 0.16, 15).toFixed(1)} min`);

  const a = newTestSim(51, 0);
  a.applyO2("non_rebreather", 15, false, 0, 0);
  finishPending(a);
  tick(a, 2);
  check("NRB deflated: rebreathes at 0.21", Math.abs(a.fio2Current() - 0.21) < 0.001, `fio2=${a.fio2Current()}`);
  a.preinflateReservoir();
  tick(a, 2);
  check("NRB inflated: 0.9 at 15 L", Math.abs(a.fio2Current() - 0.9) < 0.01, `fio2=${a.fio2Current()}`);

  const b = newTestSim(52, 0);
  b.applyO2("nasal_cannula", 4, false, 0, 0);
  finishPending(b);
  check("NC 4 L: 36 percent", Math.abs(b.fio2Current() - 0.36) < 0.01, `fio2=${b.fio2Current()}`);

  const c = newTestSim(53, 0);
  c.applyO2("non_rebreather", 15, true, 0, 0);
  finishPending(c);
  // Full D at 15 L/min: 19.2 min to reserve. Run 20 min.
  tick(c, 1200);
  check("tank runs out", c.o2.tankPsi <= 200.5 && Math.abs(c.fio2Current() - 0.21) < 0.001, `psi=${Math.round(c.o2.tankPsi)} fio2=${c.fio2Current()}`);
  check("tank empty logged once", c.log.filter((e) => e.text.includes("reserve")).length === 1, "warned");
}

// 5. IV/IO: modifiers, needle rule, lido rule, infiltration on move.
{
  // Shock (loss 15+ pct) in daylight, no small-vein penalty: 75-30 = 45 pct.
  let made = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = newTestSim(seed, 900);
    s.startIv("ac", 18);
    finishPending(s);
    if (s.fluids.lines.length === 1) made += 1;
  }
  check("IV in shock hits ~45 pct over 40 seeds", made >= 10 && made <= 26, `${made}/40 in`);

  const a = newTestSim(61, 0);
  const badNeedle = a.startIo("tibial", 45, true);
  check("wrong IO needle refused", !badNeedle.ok, `${badNeedle.reason}`);

  const b = newTestSim(62, 0);
  b.startIo("tibial", 25, true);
  finishPending(b);
  const ioLine = b.fluids.lines[0];
  check("IO tibial 25 mm in", ioLine?.kind === "io" && ioLine.ioLidoGiven, `flow=${ioLine?.flow_mL_per_min}`);

  const c = newTestSim(63, 0);
  c.startIo("humeral", 45, false);
  finishPending(c);
  check("IO no-lido conscious: pain 10", c.pain_0_to_10 === 10, `pain=${c.pain_0_to_10}`);

  let infiltrated = false;
  for (let seed = 1; seed <= 60 && !infiltrated; seed++) {
    const s = newTestSim(1000 + seed, 0);
    s.startIo("tibial", 25, true);
    finishPending(s);
    if (s.fluids.lines.length === 0) continue;
    s.movePatient("log_roll");
    if (s.fluids.lines[0]?.infiltrated === true) infiltrated = true;
  }
  check("move can infiltrate a line (5 pct roll)", infiltrated, "found a failing seed");
}

// 6. Fluids: explicit volumes, not tokens.
{
  const a = newTestSim(71, 2000);
  a.startIo("humeral", 45, true);
  finishPending(a);
  const lineId = a.fluids.lines[0]?.id ?? -1;
  a.applyPressureBag(lineId);
  a.hangFluids(lineId, "ns", "macro15");
  finishPending(a);
  const flow = a.fluids.lines[0]?.flow_mL_per_min ?? 0;
  check("IO humeral + pressure bag flows 80-150", flow >= 80 && flow <= 150, `${Math.round(flow)} mL/min`);
  const effBefore = a.effectiveLoss_mL();
  const lossBefore = a.loss_mL;
  const infusedBefore = a.fluids.lines[0]?.infused_mL ?? 0;
  tick(a, 60);
  const infusedDelta = (a.fluids.lines[0]?.infused_mL ?? 0) - infusedBefore;
  const lossGrew = a.loss_mL - lossBefore;
  const expected = effBefore + lossGrew - infusedDelta;
  check("fluid running: effective loss falls mL for mL", Math.abs(a.effectiveLoss_mL() - expected) < 0.5, `infused=${Math.round(infusedDelta)} bled=${Math.round(lossGrew)}`);
  // Finish the bag, then check the decay: ~250 retained at 60 min.
  let guard = 3000;
  while (a.fluids.lines[0]?.bag !== null && guard-- > 0) a.tick();
  check("1 L bag completes", a.fluids.crystalloidBags.length === 1, "bag logged");
  tick(a, 3600);
  const retained = a.retainedFluids_mL();
  check("crystalloid decays to ~250 at 60 min", retained > 200 && retained < 320, `${Math.round(retained)} mL`);
}

// 7. Drug prep: standard dose tokens at peak, toxicity above 2x, rejects.
{
  const catalog = drugCatalog();
  check("26 usable drugs", catalog.usable.length === 26, `${catalog.usable.length} usable`);
  check("78 unusable listed, not guessed", catalog.noDose.length + catalog.noMapping.length === 78, `${catalog.noDose.length} no-dose + ${catalog.noMapping.length} no-map`);
  check("morphine unusable (range dose)", catalog.noDose.includes("morphine"), "no-dose list");
  check("adenosine unusable (no token map)", catalog.noMapping.includes("adenosine"), "no-map list");
  const fent = catalog.usable.find((u) => u.drug.id === "fentanyl");
  check("fentanyl standard is 80 mcg", fent?.standard.mcg === 80, `${formatDose(fent?.standard.mcg ?? 0)}`);

  const a = newTestSim(81, 1100);
  a.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
  finishPending(a);
  if (a.tq.residualFlow_0_to_1 > 0) {
    a.applySecondTQ({ placement: "proximal", loosenedFirst: false });
    finishPending(a);
  }
  a.startIo("tibial", 25, true);
  finishPending(a);
  // TQ pain (+3) is real: reset to a clean 8 before the analgesia check.
  a.pain_0_to_10 = 8;
  const lineId = a.fluids.lines[0]?.id ?? -1;
  // Fentanyl vial is 50 mcg/mL: 1.6 mL = 80 mcg = 1x.
  a.prepPush("fentanyl", 0, 1.6, "syringe_3ml", lineId);
  finishPending(a);
  check("fentanyl push accepted", a.drugs.active.length === 1, `ratio=${a.drugs.active[0]?.ratio_to_standard}`);
  tick(a, 300);
  check("fentanyl 1x at peak: pain -6", a.vitals.pain_0_to_10 === 2, `pain=${a.vitals.pain_0_to_10}`);
  check("analgesia eases stress", !a.stressActive, "offset faded");

  const b = newTestSim(82, 1100);
  b.startIo("tibial", 25, true);
  finishPending(b);
  const line2 = b.fluids.lines[0]?.id ?? -1;
  b.prepPush("fentanyl", 0, 4.8, "syringe_3ml", line2);
  finishPending(b);
  check("3x dose flags toxicity", b.drugs.active[0]?.toxic === true && b.drugs.flags.length > 0, b.drugs.flags[0] ?? "none");

  const c = newTestSim(83, 0);
  const rejected = c.prepPush("morphine", 0, 2, "syringe_3ml", null);
  check("morphine push refused with reason", !rejected.ok && (rejected.reason ?? "").includes("TODO_CLINICAL"), `${rejected.reason}`);

  const d = newTestSim(84, 0);
  const noLine = d.prepPush("fentanyl", 0, 1.6, "syringe_3ml", null);
  check("IV push needs a patent line", !noLine.ok, `${noLine.reason}`);
}

// 8. Manual vitals: listed times, listed errors, debug stays separate.
{
  const a = newTestSim(91, 1100);
  check("gameplay vitals start unmeasured", Object.keys(a.observed).length === 0, "F1 only");
  a.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
  finishPending(a);
  if (a.tq.residualFlow_0_to_1 > 0) {
    a.applySecondTQ({ placement: "proximal", loosenedFirst: false });
    finishPending(a);
  }
  a.checkPulse();
  check("pulse takes 20 s", a.pending?.total_s === 20, `${a.pending?.total_s}s`);
  finishPending(a);
  const hrRead = Number(a.observed.hr?.value ?? "x");
  check("pulse reads even (30s x 2)", Number.isFinite(hrRead) && hrRead % 2 === 0, `read=${a.observed.hr?.value}`);

  a.checkRR();
  check("RR takes 30 s", a.pending?.total_s === 30, `${a.pending?.total_s}s`);
  finishPending(a);
  const rrCalm = Number(a.observed.rr?.value ?? "x");
  a.recordTalk();
  a.checkRR();
  finishPending(a);
  const rrAware = Number(a.observed.rr?.value ?? "x");
  check("RR reads +4 after talking", rrAware - rrCalm === 4, `${rrCalm} -> ${rrAware}`);

  a.checkBpPalp();
  check("palpated BP takes 30 s", a.pending?.total_s === 30, `${a.pending?.total_s}s`);
  finishPending(a);
  check("palpated reads ~10 low", Number(a.observed.sbp?.value ?? "x") === a.vitals.sbp_mmhg - 10, `read=${a.observed.sbp?.value} true=${a.vitals.sbp_mmhg}`);

  // Test sim is not roadside, so auscultated errors are reachable here.
  const rng = new Rng(7);
  const small = bpAuscultatedRead(rng, 120, 80, "small", false, false);
  check("small cuff reads HIGH +10-30", !("inaudible" in small) && small.sbp >= 130 && small.sbp <= 150, JSON.stringify(small));
  const big = bpAuscultatedRead(rng, 120, 80, "big", false, false);
  check("big cuff reads LOW -5-10", !("inaudible" in big) && big.sbp >= 110 && big.sbp <= 115, JSON.stringify(big));
  const road = bpAuscultatedRead(rng, 120, 80, "correct", false, true);
  check("roadside auscultation inaudible", "inaudible" in road, "fall back to palpated");

  a.runNibp();
  check("NIBP takes 40 s", a.pending?.total_s === 40, `${a.pending?.total_s}s`);
  finishPending(a);
  check("NIBP reads both pressures", a.observed.sbp?.value !== "---" && a.observed.dbp !== undefined, `${a.observed.sbp?.value}/${a.observed.dbp?.value}`);

  a.attachSpo2();
  a.readSpo2();
  check("SpO2 read takes 15 s", a.pending?.total_s === 15, `${a.pending?.total_s}s`);
  finishPending(a);
  check("SpO2 observed with lag note", (a.observed.spo2?.method ?? "").includes("lag"), `${a.observed.spo2?.value}`);

  a.checkCapRefill();
  finishPending(a);
  a.checkGlucose();
  check("glucose takes 12 s", a.pending?.total_s === 12, `${a.pending?.total_s}s`);
  finishPending(a);
  const glu = Number(a.observed.glucose?.value ?? "x");
  check("glucose within +/-15 pct", Math.abs(glu - a.vitals.glucose_mg_per_dL) / a.vitals.glucose_mg_per_dL <= 0.15, `read=${glu}`);

  a.checkTemp("temporal");
  finishPending(a);
  check("temporal temp reads low", Number((a.observed.temp?.value ?? "x").split(" ")[0]) < a.vitals.temp_C, `read=${a.observed.temp?.value} true=${a.vitals.temp_C}`);

  a.checkSkin();
  finishPending(a);
  a.checkGcs();
  check("GCS takes 20 s", a.pending?.total_s === 20, `${a.pending?.total_s}s`);
  finishPending(a);
  a.checkLungs();
  check("lung sounds take 25 s", a.pending?.total_s === 25, `${a.pending?.total_s}s`);
  finishPending(a);
  a.checkPupils();
  check("pupils take 10 s", a.pending?.total_s === 10, `${a.pending?.total_s}s`);
  finishPending(a);
  check("all 13 manual procedures observed", Object.keys(a.observed).length >= 11, `${Object.keys(a.observed).length} slots`);

  const cr = capRefillRead(new Rng(3), 1.5, true);
  check("cold cap refill +1-2 s", cr >= 2.5 && cr <= 4.5, `${cr}s`);
  const gl = glucoseRead(new Rng(9), 100, true);
  check("shock glucose flagged unreliable", gl.note.includes("unreliable"), gl.note);
}

// 9. Oct 28 fix-ups: blanket tracked, second TQ already player-triggered.
{
  const a = newTestSim(101, 0);
  a.wrapped = false;
  a.applyWrap();
  finishPending(a);
  check("wrap consumes the tracked blanket", a.wrapped && a.atPatient("hypothermia_wrap_blanket") === 0, "jump 1 -> 0");

  const b = newTestSim(102, 0);
  b.wrapped = false;
  b.applyWrap();
  finishPending(b);
  const again = b.applyWrap();
  check("no double wrap", !again.ok, `${again.reason}`);

  const c = newTestSim(103, 0);
  c.wrapped = false;
  c.applyWrap();
  finishPending(c);
  // Jump blanket spent (cabinet holds 2, but those need a fetch): unwrap and
  // prove the tracked item gates the action.
  c.wrapped = false;
  const noBlanket = c.applyWrap();
  check("wrap without blanket refused", !noBlanket.ok && (noBlanket.reason ?? "").includes("truck"), `${noBlanket.reason}`);

  // Find a 25 pct residual seed: the second TQ must NOT auto-apply.
  let residualSeed = -1;
  for (let seed = 1; seed <= 60; seed++) {
    const s = newTestSim(seed, 0);
    s.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
    finishPending(s);
    if (s.tq.residualFlow_0_to_1 > 0 && !s.tq.secondApplied) {
      residualSeed = seed;
      break;
    }
  }
  check("25 pct residual never auto-applies TQ2", residualSeed > 0, `seed=${residualSeed}`);
  if (residualSeed > 0) {
    const s = newTestSim(residualSeed, 0);
    s.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
    finishPending(s);
    const second = s.applySecondTQ({ placement: "proximal", loosenedFirst: false });
    finishPending(s);
    check("player-triggered TQ2 clears residual", second.ok && s.bleedRate_mL_per_min() < 5, "player choice");
  }
}

if (failures > 0) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All Oct 29 checks passed.");
