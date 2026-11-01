// Oct 31 headless checks: kit refund on refusal, sternal IO, Y tubing with
// saline and warmer reused across units up to the cap, reusable drip sets,
// truck boxes (narc box gate, blood cooler, blood kit).

import { newBikeDownSim, newTestSim } from "../src/sim/scenario";
import { BLOOD_SET_MAX_UNITS } from "../src/sim/lines";
import type { Sim } from "../src/sim/engine";

let failed = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (${detail})`);
  if (!ok) failed += 1;
}
function run(sim: Sim, seconds: number): void {
  for (let i = 0; i < seconds; i++) sim.tick();
}
function finish(sim: Sim): void {
  let guard = 0;
  while (sim.pending !== null && guard++ < 400) sim.tick();
}

// 1. Refund: a refused action keeps the kit it grabbed.
{
  const s = newTestSim();
  const before = s.atPatient("io_needle_45mm");
  const res = s.startIo("tibial", 45, true);
  check("wrong IO needle refused", !res.ok, res.reason ?? "");
  check("wrong IO needle refunded", s.atPatient("io_needle_45mm") === before, `${before} -> ${s.atPatient("io_needle_45mm")}`);
  s.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
  const pads = s.atPatient("pressure_bandage_6in");
  const busy = s.applyDressing("correct");
  check("busy refusal refunds the dressing", !busy.ok && s.atPatient("pressure_bandage_6in") === pads, `${busy.reason ?? ""} have=${s.atPatient("pressure_bandage_6in")}`);
}

// 2. Sternal IO: FAST1, no drill needle, one attempt.
{
  const s = newTestSim(7);
  const res = s.startIo("sternal", 0, true);
  check("sternal IO starts", res.ok, res.reason ?? "ok");
  finish(s);
  const line = s.fluids.lines.find((l) => l.site === "sternal");
  check("sternal line placed or missed once", s.sternalTried, line ? "in" : "missed");
  const again = s.startIo("sternal", 0, true);
  check("second sternal attempt refused", !again.ok, again.reason ?? "");
}

// 3. Y set: prime once, run units on the same set, saline flush per unit, cap.
{
  const s = newTestSim(3);
  s.startIo("humeral", 45, true);
  finish(s);
  const line = s.fluids.lines[0];
  check("line for blood", line !== undefined, String(line?.id));
  if (line !== undefined) {
    s.stock("whole_blood_unit", 0, 6, 0);
    const noSet = s.hangFluids(line.id, "blood", "y_set");
    check("blood without Y set refused", !noSet.ok, noSet.reason ?? "");
    const ySets = s.atPatient("y_tubing_blood");
    const setup = s.setupBloodLine(line.id);
    check("Y set primes", setup.ok, setup.reason ?? "ok");
    finish(s);
    check("Y set + warmer on line", line.ySet !== null && line.warmer, `saline=${line.ySet?.salineLeft_mL}`);
    check("one Y set used", s.atPatient("y_tubing_blood") === ySets - 1, `${ySets} -> ${s.atPatient("y_tubing_blood")}`);
    const saline0 = line.ySet?.salineLeft_mL ?? 0;
    s.hangFluids(line.id, "blood", "y_set", 2);
    finish(s);
    check("2 units on the set", line.ySet?.units === 2 && line.bag?.volumeTotal_mL === 1000, `units=${line.ySet?.units}`);
    check("10 mL flush per unit", (line.ySet?.salineLeft_mL ?? 0) === saline0 - 20, `${saline0} -> ${line.ySet?.salineLeft_mL}`);
    const lr = s.hangFluids(line.id, "lr", "macro15");
    check("no LR through blood tubing", !lr.ok, lr.reason ?? "");
    if (line.bag !== null) line.bag.volumeLeft_mL = 0.0001;
    run(s, 2);
    s.hangFluids(line.id, "blood", "y_set", 2);
    finish(s);
    check("set reaches the cap", line.ySet?.units === BLOOD_SET_MAX_UNITS, `units=${line.ySet?.units}`);
    if (line.bag !== null) line.bag.volumeLeft_mL = 0.0001;
    run(s, 2);
    const over = s.hangFluids(line.id, "blood", "y_set");
    check("unit past the cap refused", !over.ok, over.reason ?? "");
    const blood = s.atPatient("whole_blood_unit");
    check("refused unit refunded", blood === 2, `have=${blood}`);
    const replace = s.setupBloodLine(line.id);
    finish(s);
    check("spent set replaced", replace.ok && line.ySet?.units === 0, replace.reason ?? "ok");
  }
}

// 4. Drip sets are reusable per line.
{
  const s = newTestSim(5);
  s.startIo("humeral", 45, true);
  finish(s);
  const line = s.fluids.lines[0];
  if (line !== undefined) {
    const sets = s.atPatient("macro_drip_set");
    s.hangFluids(line.id, "ns", "macro15");
    finish(s);
    line.bag = null;
    s.hangFluids(line.id, "ns", "macro15");
    finish(s);
    check("second bag reuses the drip set", s.atPatient("macro_drip_set") === sets - 1, `${sets} -> ${s.atPatient("macro_drip_set")}`);
  }
}

// 5. Truck boxes: narc box gates controlled drugs; cooler and kit land whole.
{
  const s = newBikeDownSim();
  check("fentanyl locked in the narc box", !s.drugReachable("narcotics_safe").ok, "not staged");
  check("ondansetron in the drug box", s.drugReachable("drug_box").ok, "at patient");
  s.stageBox("narc_box", "partner");
  s.stageBox("blood_cooler", "partner");
  s.stageBox("blood_kit", "partner");
  run(s, 120);
  check("narc box staged", s.staged.has("narc_box") && s.drugReachable("narcotics_safe").ok, [...s.staged].join(","));
  check("both blood units at patient", s.atPatient("whole_blood_unit") === 2, `have=${s.atPatient("whole_blood_unit")}`);
  check("warmer and Y sets at patient", s.atPatient("fluid_warmer") === 1 && s.atPatient("y_tubing_blood") === 4, `warmer=${s.atPatient("fluid_warmer")} y=${s.atPatient("y_tubing_blood")}`);
}

// 6. Partner fetch lands at the patient (the vanishing-item report).
{
  const s = newBikeDownSim();
  s.fetchFromTruck("whole_blood_unit", "partner");
  run(s, 60);
  check("fetched blood is at the patient", s.atPatient("whole_blood_unit") === 1 && s.cabinetLeft("whole_blood_unit") === 1, `here=${s.atPatient("whole_blood_unit")} truck=${s.cabinetLeft("whole_blood_unit")}`);
}

if (failed > 0) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("All Oct 31 checks passed.");
