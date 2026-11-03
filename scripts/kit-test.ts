// Headless kit/blood/IO pass tests, implemented from the Nov 2 notes.
// Phase 1: failed kit actions refund; blood here/truck counts; sternal IO.
// Phase 2: Y tubing prime/units/flush/cap/replace; LR refused on blood
// lines; reusable drip sets. Phase 3: truck boxes, drug gates, stock
// table. Run: npm.cmd run sim:kit.

import { Sim, type SimConfig } from "../src/sim/engine";
import { newBikeDownSim, newTestSim } from "../src/sim/scenario";
import { drugCatalog, presentationMath } from "../src/sim/drugs";

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

/** Force the busy state with a sweep; returns false if the sweep failed. */
function makeBusy(sim: Sim): boolean {
  return sim.bloodSweep().ok;
}

/** Start an IV, retrying other gauges on a miss. Returns the line id or -1. */
function ensureLine(sim: Sim): number {
  for (const gauge of [18, 20, 22]) {
    if (sim.startIv("ac", gauge).ok) {
      tick(sim, 75);
      const line = sim.fluids.lines[sim.fluids.lines.length - 1];
      if (line !== undefined && line.kind === "iv") return line.id;
    }
  }
  return -1;
}

/** Fetch one unit to the patient via the partner. Returns false on failure. */
function fetchOne(sim: Sim, itemId: string): boolean {
  if (!sim.fetchFromTruck(itemId, "partner").ok) return false;
  tick(sim, 50);
  return sim.atPatient(itemId) > 0;
}

// - Phase 1: refund on failed actions -

// 1. CAT busy refund.
{
  const sim = kitSim();
  const before = sim.atPatient("cat_tourniquet");
  check("busy can be forced", makeBusy(sim), "sweep");
  const res = sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 4, writeTime: true });
  check("CAT fails while busy", !res.ok, res.reason ?? "ok");
  check("CAT refunded on busy fail", sim.atPatient("cat_tourniquet") === before, `${before}->${sim.atPatient("cat_tourniquet")}`);
}

// 2. 2nd CAT busy refund.
{
  const sim = kitSim();
  const first = sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 4, writeTime: true });
  check("first CAT applies", first.ok, first.reason ?? "ok");
  tick(sim, 30);
  const before = sim.atPatient("cat_tourniquet");
  makeBusy(sim);
  const res = sim.applySecondTQ({ placement: "proximal", loosenedFirst: false });
  check("2nd CAT fails while busy", !res.ok, res.reason ?? "ok");
  check("2nd CAT refunded on busy fail", sim.atPatient("cat_tourniquet") === before, `${before}->${sim.atPatient("cat_tourniquet")}`);
}

// 3. Packing busy refund.
{
  const sim = kitSim();
  sim.exposeWound();
  tick(sim, 10);
  const before = sim.atPatient("hemostatic_gauze_zfold");
  makeBusy(sim);
  const res = sim.packWound({ technique: "packed", gauze: "hemostatic" });
  check("packing fails while busy", !res.ok, res.reason ?? "ok");
  check("gauze refunded on busy fail", sim.atPatient("hemostatic_gauze_zfold") === before, `${before}->${sim.atPatient("hemostatic_gauze_zfold")}`);
}

// 4. Dressing busy refund.
{
  const sim = kitSim();
  sim.exposeWound();
  tick(sim, 10);
  const before = sim.atPatient("pressure_bandage_6in");
  makeBusy(sim);
  const res = sim.applyDressing("correct");
  check("dressing fails while busy", !res.ok, res.reason ?? "ok");
  check("bandage refunded on busy fail", sim.atPatient("pressure_bandage_6in") === before, `${before}->${sim.atPatient("pressure_bandage_6in")}`);
}

// 5. Wrap busy refund.
{
  const sim = kitSim();
  sim.wrapped = false;
  const before = sim.atPatient("hypothermia_wrap_blanket");
  makeBusy(sim);
  const res = sim.applyWrap();
  check("wrap fails while busy", !res.ok, res.reason ?? "ok");
  check("blanket refunded on busy fail", sim.atPatient("hypothermia_wrap_blanket") === before, `${before}->${sim.atPatient("hypothermia_wrap_blanket")}`);
}

// 6. Supraglottic busy refund.
{
  const sim = kitSim();
  const before = sim.atPatient("igel_set");
  makeBusy(sim);
  const res = sim.placeSupraglottic("igel", 4);
  check("SGA fails while busy", !res.ok, res.reason ?? "ok");
  check("SGA refunded on busy fail", sim.atPatient("igel_set") === before, `${before}->${sim.atPatient("igel_set")}`);
}

// 7. ETT busy refund.
{
  const sim = kitSim();
  const before = sim.atPatient("ett_set");
  makeBusy(sim);
  const res = sim.intubate(7.5, 22, false, 25);
  check("ETT fails while busy", !res.ok, res.reason ?? "ok");
  check("ETT refunded on busy fail", sim.atPatient("ett_set") === before, `${before}->${sim.atPatient("ett_set")}`);
}

// 8. Suction catheter busy refund.
{
  const sim = kitSim();
  sim.intubate(7.5, 22, false, 25);
  tick(sim, 60);
  check("tube in for suction test", sim.airway.ett !== null, "ett placed");
  const before = sim.atPatient("suction_catheter_14fr");
  makeBusy(sim);
  const res = sim.suctionAirway("ett", 12);
  check("suction fails while busy", !res.ok, res.reason ?? "ok");
  check("catheter refunded on busy fail", sim.atPatient("suction_catheter_14fr") === before, `${before}->${sim.atPatient("suction_catheter_14fr")}`);
}

// 9. O2 device refund when the tank check fails (missing second item).
{
  const sim = kitSim();
  sim.o2.tankPsi = 0;
  sim.stock("o2_tank_d", 0, 0, 0);
  sim.stock("o2_tank_m", 0, 0, 0);
  const before = sim.atPatient("nasal_cannula");
  const res = sim.applyO2("nasal_cannula", 4, false, 0, 0);
  check("O2 fails with no tank", !res.ok, res.reason ?? "ok");
  check("cannula refunded on tank fail", sim.atPatient("nasal_cannula") === before, `${before}->${sim.atPatient("nasal_cannula")}`);
}

// 10. O2 busy refund.
{
  const sim = kitSim();
  const before = sim.atPatient("nasal_cannula");
  makeBusy(sim);
  const res = sim.applyO2("nasal_cannula", 4, false, 0, 0);
  check("O2 fails while busy", !res.ok, res.reason ?? "ok");
  check("cannula refunded on busy fail", sim.atPatient("nasal_cannula") === before, `${before}->${sim.atPatient("nasal_cannula")}`);
}

// 11. Tank swap busy refund.
{
  const sim = kitSim();
  check("M cylinder fetched", fetchOne(sim, "o2_tank_m"), "fetched");
  const before = sim.atPatient("o2_tank_m");
  makeBusy(sim);
  const res = sim.swapTank();
  check("tank swap fails while busy", !res.ok, res.reason ?? "ok");
  check("M cylinder refunded on busy fail", sim.atPatient("o2_tank_m") === before, `${before}->${sim.atPatient("o2_tank_m")}`);
}

// 12. IV busy refund.
{
  const sim = kitSim();
  const before = sim.atPatient("iv_cath_18g");
  makeBusy(sim);
  const res = sim.startIv("ac", 18);
  check("IV fails while busy", !res.ok, res.reason ?? "ok");
  check("cath refunded on busy fail", sim.atPatient("iv_cath_18g") === before, `${before}->${sim.atPatient("iv_cath_18g")}`);
}

// 13. IO wrong needle refund.
{
  const sim = kitSim();
  const before = sim.atPatient("io_needle_45mm");
  const res = sim.startIo("tibial", 45, false);
  check("IO fails on wrong needle", !res.ok, res.reason ?? "ok");
  check("needle refunded on wrong-needle fail", sim.atPatient("io_needle_45mm") === before, `${before}->${sim.atPatient("io_needle_45mm")}`);
}

// 14. IO busy refund.
{
  const sim = kitSim();
  const before = sim.atPatient("io_needle_25mm");
  makeBusy(sim);
  const res = sim.startIo("tibial", 25, false);
  check("IO fails while busy", !res.ok, res.reason ?? "ok");
  check("needle refunded on busy fail", sim.atPatient("io_needle_25mm") === before, `${before}->${sim.atPatient("io_needle_25mm")}`);
}

// 15. Prime with no NS refunds the Y set.
{
  const sim = kitSim();
  const lineId = ensureLine(sim);
  check("line in for prime test", lineId > 0, `line ${lineId}`);
  check("Y set fetched", fetchOne(sim, "y_tubing_blood"), "fetched");
  sim.stock("ns_250ml", 0, 0, 0);
  sim.stock("ns_1000ml", 0, 0, 0);
  const before = sim.atPatient("y_tubing_blood");
  const res = sim.primeYSet(lineId);
  check("prime fails with no NS", !res.ok, res.reason ?? "ok");
  check("Y set refunded on NS fail", sim.atPatient("y_tubing_blood") === before, `${before}->${sim.atPatient("y_tubing_blood")}`);
}

// 16. Prime with no warmer refunds Y set and NS.
{
  const sim = kitSim();
  const lineId = ensureLine(sim);
  check("Y set fetched", fetchOne(sim, "y_tubing_blood"), "fetched");
  const setBefore = sim.atPatient("y_tubing_blood");
  const nsBefore = sim.atPatient("ns_250ml");
  const res = sim.primeYSet(lineId);
  check("prime fails with no warmer", !res.ok, res.reason ?? "ok");
  check("Y set refunded on warmer fail", sim.atPatient("y_tubing_blood") === setBefore, `${setBefore}->${sim.atPatient("y_tubing_blood")}`);
  check("NS refunded on warmer fail", sim.atPatient("ns_250ml") === nsBefore, `${nsBefore}->${sim.atPatient("ns_250ml")}`);
}

// 17. Hang crystalloid busy refund.
{
  const sim = kitSim();
  const lineId = ensureLine(sim);
  const bagBefore = sim.atPatient("ns_1000ml");
  const setBefore = sim.atPatient("macro_drip_set");
  makeBusy(sim);
  const res = sim.hangFluids(lineId, "ns", "macro15");
  check("hang fails while busy", !res.ok, res.reason ?? "ok");
  check("NS bag refunded on busy fail", sim.atPatient("ns_1000ml") === bagBefore, `${bagBefore}->${sim.atPatient("ns_1000ml")}`);
  check("drip set refunded on busy fail", sim.atPatient("macro_drip_set") === setBefore, `${setBefore}->${sim.atPatient("macro_drip_set")}`);
}

/** First usable IV/IO drug with a computable 1x amount, for push tests. */
function ivDrug(): { id: string; presIndex: number; amount: number } | null {
  const catalog = drugCatalog();
  for (const entry of catalog.usable) {
    if (!entry.standard.route.toUpperCase().startsWith("IV") && !entry.standard.route.toUpperCase().startsWith("IO")) continue;
    const pres = entry.presentations[0];
    if (pres === undefined) continue;
    const drugPres = entry.drug.presentations[pres.index];
    if (drugPres === undefined) continue;
    const math = presentationMath(drugPres);
    if (math === null || math.mcgPer <= 0) continue;
    return { id: entry.drug.id, presIndex: pres.index, amount: entry.standard.mcg / math.mcgPer };
  }
  return null;
}

// 18. Drug push with no line refunds the syringe.
{
  const sim = kitSim();
  const drug = ivDrug();
  check("IV test drug found", drug !== null, drug?.id ?? "none");
  if (drug !== null) {
    const before = sim.atPatient("syringe_10ml");
    const res = sim.prepPush(drug.id, drug.presIndex, drug.amount, "syringe_10ml", 1);
    check("push fails with no line", !res.ok, res.reason ?? "ok");
    check("syringe refunded on no-line fail", sim.atPatient("syringe_10ml") === before, `${before}->${sim.atPatient("syringe_10ml")}`);
  }
}

// 19. Drug push busy refund.
{
  const sim = kitSim();
  const drug = ivDrug();
  const lineId = ensureLine(sim);
  if (drug !== null && lineId > 0) {
    const before = sim.atPatient("syringe_10ml");
    makeBusy(sim);
    const res = sim.prepPush(drug.id, drug.presIndex, drug.amount, "syringe_10ml", lineId);
    check("push fails while busy", !res.ok, res.reason ?? "ok");
    check("syringe refunded on busy fail", sim.atPatient("syringe_10ml") === before, `${before}->${sim.atPatient("syringe_10ml")}`);
  } else {
    check("push busy setup", false, "no drug or line");
  }
}

// 20. Presence-only actions consume nothing on failure.
{
  const sim = kitSim();
  makeBusy(sim);
  const expose = sim.exposeWound();
  check("expose fails while busy", !expose.ok, expose.reason ?? "ok");
  check("shears untouched", sim.atPatient("trauma_shears") === 2, `${sim.atPatient("trauma_shears")} here`);
  const opa = sim.insertOpa(100);
  check("OPA fails while busy", !opa.ok, opa.reason ?? "ok");
  check("OPA set untouched", sim.atPatient("opa_set") === 1, `${sim.atPatient("opa_set")} here`);
}

// - Phase 1: sternal IO -

/** First seed whose sternal attempt succeeds (fresh sim, first roll). */
function sternalHitSeed(): number {
  for (let seed = 1; seed <= 200; seed++) {
    const sim = newTestSim(seed);
    sim.startSternalIo(true);
    tick(sim, 30);
    if (sim.fluids.lines.some((l) => l.kind === "io" && l.site === "sternal")) return seed;
  }
  return -1;
}

/** First seed whose sternal attempt misses. */
function sternalMissSeed(): number {
  for (let seed = 1; seed <= 500; seed++) {
    const sim = newTestSim(seed);
    sim.startSternalIo(true);
    tick(sim, 30);
    if (!sim.fluids.lines.some((l) => l.kind === "io" && l.site === "sternal")) return seed;
  }
  return -1;
}

// 21. Sternal places an IO line with FAST1 log lines.
{
  const seed = sternalHitSeed();
  check("sternal hit seed exists", seed > 0, `seed ${seed}`);
  const sim = newTestSim(seed);
  const res = sim.startSternalIo(true);
  check("sternal starts", res.ok, res.reason ?? "ok");
  check("sternal runs 30s", sim.pending !== null && sim.pending.total_s === 30, `${sim.pending?.total_s}s`);
  tick(sim, 30);
  const line = sim.fluids.lines.find((l) => l.site === "sternal");
  check("sternal line placed", line !== undefined && line.kind === "io" && line.patent, `line ${line?.id}`);
  check("sternal logs FAST1", sim.log.some((e) => e.text.includes("IO sternal in (FAST1")), "fluid line");
  check("sternal logs lido", sim.log.some((e) => e.text.includes("Lidocaine 40 mg IO before the flush")), "lido line");
}

// 22. One attempt per patient, hit or miss.
{
  const hitSeed = sternalHitSeed();
  const sim = newTestSim(hitSeed);
  sim.startSternalIo(true);
  tick(sim, 30);
  const again = sim.startSternalIo(true);
  check("no second sternal after hit", !again.ok, again.reason ?? "ok");
  const missSeed = sternalMissSeed();
  check("sternal miss seed exists", missSeed > 0, `seed ${missSeed}`);
  const sim2 = newTestSim(missSeed);
  sim2.startSternalIo(true);
  tick(sim2, 30);
  check("miss logs no-retry", sim2.log.some((e) => e.text.includes("No second sternal attempt")), "miss line");
  const retry = sim2.startSternalIo(true);
  check("no second sternal after miss", !retry.ok, retry.reason ?? "ok");
}

// 23. Sternal needs no drill.
{
  const config: SimConfig = {
    seed: sternalHitSeed(),
    startLoss_mL: 0,
    bystanderShirt: false,
    beltTrap: false,
    stressActive: false,
    betaBlocked: false,
    wetClothing: false,
    wrapped: true,
    startTemp_C: 36.8,
    startPain_0_to_10: 0,
    fetch_s: 50,
    darkScene: false,
    roadside: false
  };
  const sim = new Sim(config);
  sim.stock("io_fast1", 0, 1, 0);
  check("no drill stocked", sim.atPatient("io_drill_ezio") === 0, "drill absent");
  const res = sim.startSternalIo(true);
  check("sternal starts with no drill", res.ok, res.reason ?? "ok");
}

// 24. Skipped lido on a conscious patient means pain 10/10.
{
  const sim = newTestSim(sternalHitSeed());
  sim.startSternalIo(false);
  tick(sim, 30);
  check("sternal no-lido pain trap", sim.log.some((e) => e.text.includes("no lidocaine 40 mg first: pain 10/10")), "trap line");
}

// 25. Sternal pressure-bag flow is the humeral range (TUNE).
{
  const sim = newTestSim(sternalHitSeed());
  sim.startSternalIo(true);
  tick(sim, 30);
  const line = sim.fluids.lines.find((l) => l.site === "sternal");
  check("sternal gravity poor", line?.flow_mL_per_min === 10, `${line?.flow_mL_per_min} mL/min`);
  if (line !== undefined) {
    sim.applyPressureBag(line.id);
    const flow = line.flow_mL_per_min;
    check("sternal pressure flow humeral-range", flow >= 80 && flow <= 150, `${Math.round(flow)} mL/min`);
  }
}

// 26. Sternal busy refund, attempt not consumed.
{
  const sim = kitSim();
  const before = sim.atPatient("io_fast1");
  makeBusy(sim);
  const res = sim.startSternalIo(true);
  check("sternal fails while busy", !res.ok, res.reason ?? "ok");
  check("FAST1 refunded on busy fail", sim.atPatient("io_fast1") === before, `${before}->${sim.atPatient("io_fast1")}`);
  check("busy fail keeps the attempt", !sim.sternalAttempted, "attempt kept");
}

// 27. FAST1 stock: jump 1, truck 2.
{
  const sim = newBikeDownSim();
  check("FAST1 1 at patient", sim.atPatient("io_fast1") === 1, `${sim.atPatient("io_fast1")} here`);
  check("FAST1 2 on truck", sim.cabinetLeft("io_fast1") === 2, `${sim.cabinetLeft("io_fast1")} truck`);
}

// - Phase 2: Y tubing, warmer, reusable drip sets -

/** Bleed-free test sim: long kit sequences must not arrest mid-test. */
function kitSim(): Sim {
  return newTestSim(1027, 0, { femoralBleed: false, roadRash: false });
}

/** Prime-ready sim: line in, Y set + warmer fetched. Returns line id or -1. */
function primeReady(sim: Sim): number {
  const lineId = ensureLine(sim);
  if (lineId <= 0) return -1;
  if (!fetchOne(sim, "y_tubing_blood")) return -1;
  if (!fetchOne(sim, "fluid_warmer")) return -1;
  return lineId;
}

/** Empty the hanging bag fast, then let the tick clear it. */
function drainBag(sim: Sim, lineId: number): void {
  const line = sim.fluids.lines.find((l) => l.id === lineId);
  if (line?.bag !== null && line?.bag !== undefined) line.bag.volumeLeft_mL = 1;
  tick(sim, 5);
}

// 28. Prime consumes Y + NS250, sets 210 mL, warmer on, 45 s.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  check("prime setup", lineId > 0, `line ${lineId}`);
  const res = sim.primeYSet(lineId);
  check("prime starts", res.ok, res.reason ?? "ok");
  check("prime runs 45s", sim.pending !== null && sim.pending.total_s === 45, `${sim.pending?.total_s}s`);
  tick(sim, 45);
  const line = sim.fluids.lines.find((l) => l.id === lineId);
  check("Y set primed", line?.ySet !== null && line?.ySet !== undefined, "yset");
  check("prime leaves 210 NS", line?.ySet?.nsLeft_mL === 210, `${line?.ySet?.nsLeft_mL} mL`);
  check("prime warms the line", line?.warmerOn === true, "warmer on");
  check("prime uses NS250", sim.atPatient("ns_250ml") === 1, `${sim.atPatient("ns_250ml")} left`);
  check("prime logs spikes", sim.log.some((e) => e.text.includes("Blood on one spike, NS on the other")), "spike line");
}

// 29. Prime falls back to NS 1 L when NS250 is gone.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  sim.stock("ns_250ml", 0, 0, 0);
  const res = sim.primeYSet(lineId);
  check("prime falls back", res.ok, res.reason ?? "ok");
  tick(sim, 45);
  const line = sim.fluids.lines.find((l) => l.id === lineId);
  check("fallback leaves 960 NS", line?.ySet?.nsLeft_mL === 960, `${line?.ySet?.nsLeft_mL} mL`);
}

// 30. Hang 1 unit: 500 mL, unit count, 10 mL flush, blood retains.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  sim.primeYSet(lineId);
  tick(sim, 45);
  check("blood fetched", fetchOne(sim, "whole_blood_unit"), "fetched");
  const res = sim.hangBloodUnits(lineId, 1);
  check("1 unit hangs", res.ok, res.reason ?? "ok");
  tick(sim, 30);
  const line = sim.fluids.lines.find((l) => l.id === lineId);
  check("bag is 500 blood", line?.bag?.fluid === "blood" && line.bag.volumeTotal_mL === 500, `${line?.bag?.volumeTotal_mL} mL`);
  check("unit counted", line?.ySet?.unitsHung === 1, "1/4");
  check("flush 10 NS", line?.ySet?.nsLeft_mL === 200, `${line?.ySet?.nsLeft_mL} mL`);
  tick(sim, 400);
  check("bag runs dry", sim.fluids.lines.find((l) => l.id === lineId)?.bag === null, "empty");
  check("blood retains 90 percent", sim.fluids.bloodRetained_mL > 400, `${Math.round(sim.fluids.bloodRetained_mL)} mL`);
}

// 31. Hang 2 units back to back: 1,000 mL.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  sim.primeYSet(lineId);
  tick(sim, 45);
  fetchOne(sim, "whole_blood_unit");
  check("2 units here", fetchOne(sim, "whole_blood_unit") && sim.atPatient("whole_blood_unit") === 2, "2 here");
  const res = sim.hangBloodUnits(lineId, 2);
  check("2 units hang", res.ok, res.reason ?? "ok");
  tick(sim, 30);
  const line = sim.fluids.lines.find((l) => l.id === lineId);
  check("bag is 1000 blood", line?.bag?.volumeTotal_mL === 1000, `${line?.bag?.volumeTotal_mL} mL`);
  check("units counted", line?.ySet?.unitsHung === 2, "2/4");
  check("flush 20 NS", line?.ySet?.nsLeft_mL === 190, `${line?.ySet?.nsLeft_mL} mL`);
}

// 32. 4-unit cap, then replace-the-set refusal.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  sim.primeYSet(lineId);
  tick(sim, 45);
  sim.stock("whole_blood_unit", 0, 5, 0);
  sim.hangBloodUnits(lineId, 2);
  tick(sim, 30);
  drainBag(sim, lineId);
  sim.hangBloodUnits(lineId, 2);
  tick(sim, 30);
  drainBag(sim, lineId);
  const line = sim.fluids.lines.find((l) => l.id === lineId);
  check("4 units hung", line?.ySet?.unitsHung === 4, "4/4");
  const fifth = sim.hangBloodUnits(lineId, 1);
  check("5th unit refused", !fifth.ok && fifth.reason !== undefined && fifth.reason.includes("Replace the Y set"), fifth.reason ?? "ok");
}

// 33. 4-hour age cap refuses with replace-the-set.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  sim.primeYSet(lineId);
  tick(sim, 45);
  const line = sim.fluids.lines.find((l) => l.id === lineId);
  if (line?.ySet !== null && line?.ySet !== undefined) line.ySet.primedAt_s -= 4 * 3600 + 1;
  fetchOne(sim, "whole_blood_unit");
  const res = sim.hangBloodUnits(lineId, 1);
  check("old set refused", !res.ok && res.reason !== undefined && res.reason.includes("Replace the Y set"), res.reason ?? "ok");
}

// 34. LR and NS 1 L refused on a Y line, fine on a plain line.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  sim.primeYSet(lineId);
  tick(sim, 45);
  const lr = sim.hangFluids(lineId, "lr", "macro15");
  check("LR refused on Y line", !lr.ok, lr.reason ?? "ok");
  const ns = sim.hangFluids(lineId, "ns", "macro15");
  check("NS 1 L refused on Y line", !ns.ok, ns.reason ?? "ok");
  const sim2 = kitSim();
  const plain = ensureLine(sim2);
  const okNs = sim2.hangFluids(plain, "ns", "macro15");
  check("NS hangs on plain line", okNs.ok, okNs.reason ?? "ok");
}

// 35. Replace resets the clock, NS carries over.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  sim.primeYSet(lineId);
  tick(sim, 45);
  fetchOne(sim, "whole_blood_unit");
  sim.hangBloodUnits(lineId, 1);
  tick(sim, 30);
  drainBag(sim, lineId);
  sim.stock("y_tubing_blood", 0, 1, 0);
  const before = sim.fluids.lines.find((l) => l.id === lineId)?.ySet?.nsLeft_mL ?? -1;
  const res = sim.replaceYSet(lineId);
  check("replace starts", res.ok, res.reason ?? "ok");
  tick(sim, 45);
  const ySet = sim.fluids.lines.find((l) => l.id === lineId)?.ySet;
  check("units reset", ySet?.unitsHung === 0, "0/4");
  check("NS carries over", ySet?.nsLeft_mL === before, `${ySet?.nsLeft_mL} mL`);
  check("warmer stays on", sim.fluids.lines.find((l) => l.id === lineId)?.warmerOn === true, "warmer on");
}

// 36. Drip set reuse: first hang 30 s uses one, second hang 20 s reuses.
{
  const sim = kitSim();
  const lineId = ensureLine(sim);
  const setBefore = sim.atPatient("macro_drip_set");
  const first = sim.hangFluids(lineId, "ns", "macro15");
  check("first hang 30s", first.ok && sim.pending !== null && sim.pending.total_s === 30, `${sim.pending?.total_s}s`);
  tick(sim, 30);
  check("first hang uses a set", sim.atPatient("macro_drip_set") === setBefore - 1, `${setBefore}->${sim.atPatient("macro_drip_set")}`);
  drainBag(sim, lineId);
  const mid = sim.atPatient("macro_drip_set");
  const second = sim.hangFluids(lineId, "ns", "macro15");
  check("second hang 20s", second.ok && sim.pending !== null && sim.pending.total_s === 20, `${sim.pending?.total_s}s`);
  tick(sim, 30);
  check("second hang reuses the set", sim.atPatient("macro_drip_set") === mid, `${mid}->${sim.atPatient("macro_drip_set")}`);
}

// 37. Warmer moves to the newly primed line.
{
  const sim = kitSim();
  const a = ensureLine(sim);
  fetchOne(sim, "y_tubing_blood");
  fetchOne(sim, "fluid_warmer");
  sim.primeYSet(a);
  tick(sim, 45);
  sim.stock("y_tubing_blood", 0, 1, 0);
  const b = ensureLine(sim);
  check("two lines", a > 0 && b > 0 && a !== b, `lines ${a},${b}`);
  if (b > 0) {
    sim.primeYSet(b);
    tick(sim, 45);
    const lineA = sim.fluids.lines.find((l) => l.id === a);
    const lineB = sim.fluids.lines.find((l) => l.id === b);
    check("warmer leaves line A", lineA?.warmerOn === false, "A off");
    check("warmer moves to line B", lineB?.warmerOn === true, "B on");
    check("move logged", sim.log.some((e) => e.text.includes("Warmer moved")), "move line");
  }
}

// 38. Pulling a Y line disposes the set and frees the warmer.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  sim.primeYSet(lineId);
  tick(sim, 45);
  sim.pullLine(lineId);
  check("set disposal logged", sim.log.some((e) => e.text.includes("Y set on line") && e.text.includes("disposed")), "disposed");
  check("warmer freed logged", sim.log.some((e) => e.text.includes("warmer 38 C off the line")), "freed");
  check("warmer still in hand", sim.atPatient("fluid_warmer") === 1, `${sim.atPatient("fluid_warmer")} here`);
}

// 39. Fetched blood lands at the patient: here rises, truck falls.
{
  const sim = newBikeDownSim();
  const hereBefore = sim.atPatient("whole_blood_unit");
  const truckBefore = sim.cabinetLeft("whole_blood_unit");
  check("blood starts on truck", hereBefore === 0 && truckBefore === 2, `here ${hereBefore} truck ${truckBefore}`);
  fetchOne(sim, "whole_blood_unit");
  check("fetched unit lands here", sim.atPatient("whole_blood_unit") === 1 && sim.cabinetLeft("whole_blood_unit") === 1, `here ${sim.atPatient("whole_blood_unit")} truck ${sim.cabinetLeft("whole_blood_unit")}`);
}

// 40. Short blood stock refunds the grabbed unit.
{
  const sim = kitSim();
  const lineId = primeReady(sim);
  sim.primeYSet(lineId);
  tick(sim, 45);
  fetchOne(sim, "whole_blood_unit");
  const res = sim.hangBloodUnits(lineId, 2);
  check("2-unit hang fails on 1 here", !res.ok, res.reason ?? "ok");
  check("grabbed unit refunded", sim.atPatient("whole_blood_unit") === 1, `${sim.atPatient("whole_blood_unit")} here`);
}

// - Phase 3: truck boxes, drug gates, stock table -

/** 1x push params for a usable drug id, or null when unusable. */
function pushParams(id: string): { presIndex: number; amount: number } | null {
  const entry = drugCatalog().usable.find((u) => u.drug.id === id);
  const pres = entry?.presentations[0];
  const drugPres = pres !== undefined ? entry?.drug.presentations[pres.index] : undefined;
  if (entry === undefined || pres === undefined || drugPres === undefined) return null;
  const math = presentationMath(drugPres);
  if (math === null || math.mcgPer <= 0) return null;
  return { presIndex: pres.index, amount: entry.standard.mcg / math.mcgPer };
}

// 41. One partner trip stages a box in 50 s.
{
  const sim = kitSim();
  const res = sim.stageBox("box_narc");
  check("narc stage starts", res.ok, res.reason ?? "ok");
  check("trip runs 50s", sim.boxTrips.length === 1 && sim.boxTrips[0]?.total_s === 50, `${sim.boxTrips[0]?.total_s}s`);
  tick(sim, 50);
  check("narc staged", sim.stagedBoxes.has("box_narc"), "staged");
  check("stage logged", sim.log.some((e) => e.text.includes("Narc box staged at the patient")), "log line");
}

// 42. A second box joins the trip in progress.
{
  const sim = kitSim();
  sim.stageBox("box_narc");
  const join = sim.stageBox("box_rsi");
  check("rsi joins trip", join.ok, join.reason ?? "ok");
  check("one trip, two boxes", sim.boxTrips.length === 1 && sim.boxTrips[0]?.boxes.length === 2, "joined");
  check("join logged", sim.log.some((e) => e.text.includes("joins the partner trip")), "log line");
  tick(sim, 50);
  check("both staged", sim.stagedBoxes.has("box_narc") && sim.stagedBoxes.has("box_rsi"), "2 staged");
}

// 43. Stage refusals change nothing.
{
  const sim = kitSim();
  check("unknown box refused", !sim.stageBox("box_nope").ok, "unknown");
  sim.stageBox("box_narc");
  check("double stage refused", !sim.stageBox("box_narc").ok, "on the way");
  tick(sim, 50);
  check("restage refused", !sim.stageBox("box_narc").ok, "already staged");
  check("one box staged", sim.stagedBoxes.size === 1, "size 1");
}

// 44. Narc gate: fentanyl locked until the Narc box stages.
{
  const sim = kitSim();
  const lineId = ensureLine(sim);
  const params = pushParams("fentanyl");
  check("fentanyl pushable", params !== null && lineId > 0, "setup");
  if (params !== null && lineId > 0) {
    const locked = sim.prepPush("fentanyl", params.presIndex, params.amount, "syringe_3ml", lineId);
    check("fentanyl locked pre-stage", !locked.ok && (locked.reason ?? "").includes("in the Narc box"), locked.reason ?? "ok");
    sim.stageBox("box_narc");
    tick(sim, 50);
    const open = sim.prepPush("fentanyl", params.presIndex, params.amount, "syringe_3ml", lineId);
    check("fentanyl pushes post-stage", open.ok, open.reason ?? "ok");
  }
}

// 45. RSI gate: etomidate locked until the RSI kit stages.
{
  const sim = kitSim();
  const lineId = ensureLine(sim);
  const params = pushParams("etomidate");
  check("etomidate pushable", params !== null && lineId > 0, "setup");
  if (params !== null && lineId > 0) {
    const locked = sim.prepPush("etomidate", params.presIndex, params.amount, "syringe_10ml", lineId);
    check("etomidate locked pre-stage", !locked.ok && (locked.reason ?? "").includes("in the RSI kit"), locked.reason ?? "ok");
    sim.stageBox("box_rsi");
    tick(sim, 50);
    const open = sim.prepPush("etomidate", params.presIndex, params.amount, "syringe_10ml", lineId);
    check("etomidate pushes post-stage", open.ok, open.reason ?? "ok");
  }
}

// 46. CC gate: vecuronium locked until the Critical care box stages.
{
  const sim = kitSim();
  const lineId = ensureLine(sim);
  const params = pushParams("vecuronium");
  check("vecuronium pushable", params !== null && lineId > 0, "setup");
  if (params !== null && lineId > 0) {
    const locked = sim.prepPush("vecuronium", params.presIndex, params.amount, "syringe_10ml", lineId);
    check("vecuronium locked pre-stage", !locked.ok && (locked.reason ?? "").includes("in the Critical care box"), locked.reason ?? "ok");
    sim.stageBox("box_cc");
    tick(sim, 50);
    const open = sim.prepPush("vecuronium", params.presIndex, params.amount, "syringe_10ml", lineId);
    check("vecuronium pushes post-stage", open.ok, open.reason ?? "ok");
  }
}

// 47. Drug box drugs push with no staging.
{
  const sim = kitSim();
  const lineId = ensureLine(sim);
  const entry = drugCatalog().usable.find((u) => {
    const head = u.drug.location.split(" ")[0];
    return (head === "drug_box" || head === "jump_bag") && u.standard.route.toUpperCase().startsWith("IV");
  });
  check("at-hand IV drug exists", entry !== undefined, entry?.drug.id ?? "none");
  if (entry !== undefined && lineId > 0) {
    const params = pushParams(entry.drug.id);
    if (params !== null) {
      const res = sim.prepPush(entry.drug.id, params.presIndex, params.amount, "syringe_10ml", lineId);
      check("at-hand drug pushes unstaged", res.ok, res.reason ?? "ok");
    }
  }
}

// 48. Blood kit staging lands its contents at the patient.
{
  const sim = newBikeDownSim();
  sim.stageBox("box_blood_kit");
  tick(sim, 50);
  check("kit staged", sim.stagedBoxes.has("box_blood_kit"), "staged");
  check("kit lands 2 Y sets", sim.atPatient("y_tubing_blood") === 2, `${sim.atPatient("y_tubing_blood")} here`);
  check("kit lands 2 NS250", sim.atPatient("ns_250ml") === 2, `${sim.atPatient("ns_250ml")} here`);
  check("kit lands warmer", sim.atPatient("fluid_warmer") === 1, `${sim.atPatient("fluid_warmer")} here`);
  check("kit lands pressure bag", sim.atPatient("pressure_bag_300") === 2 && sim.cabinetLeft("pressure_bag_300") === 0, `jump 1 + kit 1 here`);
}

// 49. Cooler stages but moves nothing on its own.
{
  const sim = newBikeDownSim();
  sim.stageBox("box_blood_cooler");
  tick(sim, 50);
  check("cooler staged", sim.stagedBoxes.has("box_blood_cooler"), "staged");
  check("blood stays on truck", sim.atPatient("whole_blood_unit") === 0 && sim.cabinetLeft("whole_blood_unit") === 2, "fetch it");
}

// 50. Stock table: CAT 5 at patient, belt 1, new counts.
{
  const sim = newBikeDownSim();
  check("CAT 5 at patient", sim.atPatient("cat_tourniquet") === 5, `${sim.atPatient("cat_tourniquet")} here`);
  check("CAT belt 1", sim.stashes.get("cat_tourniquet")?.belt === 1, "belt 1");
  check("z-fold 4/6", sim.atPatient("hemostatic_gauze_zfold") === 4 && sim.cabinetLeft("hemostatic_gauze_zfold") === 6, "4 here 6 truck");
  check("NS 1L 2/6", sim.atPatient("ns_1000ml") === 2 && sim.cabinetLeft("ns_1000ml") === 6, "2 here 6 truck");
  check("Y sets truck 4", sim.cabinetLeft("y_tubing_blood") === 4, "4 truck");
  check("NS250 truck 4", sim.cabinetLeft("ns_250ml") === 4, "4 truck");
}

// 51. New no-action items are stocked, with no engine action.
{
  const sim = newBikeDownSim();
  for (const id of ["pelvic_binder", "needle_decompression_kit", "cric_kit", "lifeflow"]) {
    const total = sim.atPatient(id) + sim.cabinetLeft(id);
    check(`${id} stocked`, total > 0, `total ${total}`);
  }
  const anySim = sim as unknown as Record<string, unknown>;
  check("no binder action", typeof anySim["applyPelvicBinder"] !== "function", "none");
  check("no needle-D action", typeof anySim["needleDecompress"] !== "function", "none");
  check("no cric action", typeof anySim["cric"] !== "function", "none");
  check("no lifeflow action", typeof anySim["lifeflow"] !== "function", "none");
}

if (failures > 0) {
  console.log(`${failures} kit check(s) failed.`);
  process.exit(1);
} else {
  console.log("All kit checks passed.");
}
