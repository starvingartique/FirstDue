// Headless acceptance tests for the Oct 31 Dispatch Engine v1. Runs the real
// seeded sampler, the validator and generated-call instantiation, no browser,
// no LLM. Exit 0 = pass. Run: npm.cmd run sim:test31 (PowerShell).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadBikeDown,
  loadComorbidities,
  loadComplications,
  loadComplaints,
  loadConditions,
  loadEnvironments,
  loadOct28Conditions
} from "../src/data/loaders";
import { applyConditionRules, sampleSkeleton } from "../src/dispatch/sampler";
import {
  assembleCall,
  findClinicalNumbers,
  validateFleshedCall,
  validateSkeleton,
  type LlmFlesh
} from "../src/dispatch/validate";
import { newGeneratedSim } from "../src/dispatch/instantiate";
import type { CallSkeleton } from "../src/dispatch/types";
import type { Sim } from "../src/sim/engine";

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

function readySet(): Set<string> {
  const ready = new Set<string>();
  for (const c of loadOct28Conditions().conditions) if (c.generatorReady) ready.add(c.id);
  for (const c of loadConditions().conditions) if (c.generatorReady) ready.add(c.id);
  return ready;
}

/** Minimal valid flesh for a skeleton. Mutated per negative test. */
function goodFlesh(s: CallSkeleton): LlmFlesh {
  const meds = s.homeMeds.length === 0 ? "No daily meds that she can name." : `Takes ${s.homeMeds.join(" and ")} every morning.`;
  const condBits: string[] = [];
  if (s.conditionIds.includes("femoral_arterial_bleed")) {
    condBits.push("leg is bleeding heavily from the thigh");
  }
  if (s.conditionIds.includes("road_rash")) {
    condBits.push("scraped raw on the pavement with gravel in it");
  }
  if (s.conditionIds.includes("hypothermia_trauma")) {
    condBits.push("cold and shivering, clothes wet");
  }
  if (s.conditionIds.includes("crash_stress_offset")) {
    condBits.push("in pain and scared");
  }
  const condLine = condBits.length === 0 ? "lying still, hard to rouse" : condBits.join("; ");
  const display: Record<string, string> = {
    fall: "a fall",
    mvc: "a motorcycle crash",
    assault: "an assault",
    stabbing: "a stabbing",
    gunshot: "a gunshot wound",
    chest_pain: "chest pain",
    overdose: "an overdose",
    allergic_reaction: "an allergic reaction"
  };
  const disp = display[s.complaintId] ?? s.complaintId;
  return {
    dispatch: {
      nature: `Test call for ${disp}`,
      address: "Route 9 mile marker 14",
      cadText: `Caller reports ${disp} at this location. Patient ${condLine}.`,
      updates: ["Caller stays on the line."]
    },
    scene: { description: `Test scene for ${s.environmentId}. Hazards as dispatched.` },
    patient: { name: "Test Patient" },
    persona: `A ${s.patient.age}-year-old who is ${condLine}. Speaks in short answers.`,
    historyCard: {
      SAMPLE: {
        signs_symptoms: condLine,
        allergies: "No known drug allergies.",
        medications: meds,
        past_history: s.comorbidityIds.length === 0 ? "No known history." : `Known: ${s.comorbidityIds.join(", ")}.`,
        last_meal: "Ate a few hours ago, cannot recall exactly.",
        events: `What led up matches ${s.mechanismId} ${s.subtypeId}.`
      },
      OPQRST: {
        onset: "Started suddenly at the scene.",
        provokes: "Movement makes it worse.",
        quality: "Sharp and pressing.",
        radiates: "Stays where it started.",
        severity_words: "Worst discomfort of this kind, in plain words, no numbers.",
        time: "Ongoing since the event."
      },
      secrets: [{ fact: "A test secret for the history card.", revealWhen: "Ask about past history twice." }]
    },
    bystander: { label: "Test bystander", lines: ["I called it in. I will stay out of the way."] },
    expectedPathway: `Test pathway for ${s.complaintId}: assess, treat what is found, choose destination, report, hand off.`
  };
}

function scanFor(pred: (s: CallSkeleton) => boolean, level: 1 | 2, maxSeed: number): CallSkeleton | null {
  for (let seed = 1; seed <= maxSeed; seed++) {
    const s = sampleSkeleton(seed, level);
    if (pred(s)) return s;
  }
  return null;
}

// 1. Determinism: same seed and level, same skeleton.
{
  const a = JSON.stringify(sampleSkeleton(4242, 2));
  const b = JSON.stringify(sampleSkeleton(4242, 2));
  const c = JSON.stringify(sampleSkeleton(4242, 1));
  const d = JSON.stringify(sampleSkeleton(4242, 1));
  check("sampler deterministic at L2", a === b, `${a.length} chars`);
  check("sampler deterministic at L1", c === d, `${c.length} chars`);
}

// 2. Variety: 20 L2 seeds cover more than one complaint and environment.
{
  const complaints = new Set<string>();
  const envs = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) {
    const s = sampleSkeleton(seed, 2);
    complaints.add(s.complaintId);
    envs.add(s.environmentId);
  }
  check("20 seeds vary complaints", complaints.size >= 2, [...complaints].join(","));
  check("20 seeds vary environments", envs.size >= 2, [...envs].join(","));
}

// 3. Validity sweep: 40 seeds x L1/L2, every skeleton validates.
{
  const ready = readySet();
  const l1Comorb = new Set(
    loadComorbidities().entries.filter((e) => (e.minLevel ?? 2) <= 1).map((e) => e.id)
  );
  const complaints = new Map(loadComplaints().complaints.map((c) => [c.id, c.minLevel ?? 1]));
  const compData = new Map(loadComplications().complications.map((c) => [c.id, c]));
  let bad = 0;
  let l1Clean = true;
  let readyClean = true;
  for (let seed = 1; seed <= 40; seed++) {
    for (const level of [1, 2] as const) {
      const s = sampleSkeleton(seed, level);
      const v = validateSkeleton(s);
      if (!v.ok) {
        bad += 1;
        console.log(`  seed ${seed} L${level}: ${v.errors.join("; ")}`);
      }
      for (const id of s.conditionIds) if (!ready.has(id)) readyClean = false;
      if (level === 1) {
        if (s.complication !== null) l1Clean = false;
        if ((complaints.get(s.complaintId) ?? 9) > 1) l1Clean = false;
        for (const id of s.comorbidityIds) if (!l1Comorb.has(id)) l1Clean = false;
      }
      if (s.complication !== null) {
        const c = compData.get(s.complication.id);
        const window = c?.onset_s;
        const onsetOk =
          Array.isArray(window) &&
          s.complication.onset_s >= (window[0] as number) &&
          s.complication.onset_s <= (window[1] as number);
        if (!onsetOk) {
          bad += 1;
          console.log(`  seed ${seed} L${level}: complication onset out of window`);
        }
      }
    }
  }
  check("80 skeletons validate", bad === 0, `${bad} bad`);
  check("every drawn condition is generatorReady", readyClean, [...ready].join(","));
  check("L1 stays simple (no complication, L1 pool)", l1Clean, "L1 rule");
}

// 4. Co-occurrence: femoral bleed always brings the stress offset.
{
  let femoral = 0;
  let missingStress = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const s = sampleSkeleton(seed, 2);
    if (s.conditionIds.includes("femoral_arterial_bleed")) {
      femoral += 1;
      if (!s.conditionIds.includes("crash_stress_offset")) missingStress += 1;
    }
  }
  check("femoral cases exist in 2000 seeds", femoral > 0, `${femoral} found`);
  check("femoral co-occurs with stress offset", femoral > 0 && missingStress === 0, `${missingStress} missing`);
}

// 5. Rule engine: co-occurrence and exclusion on synthetic data.
{
  const rules = new Map([
    ["a", { coOccursWith: ["c"], excludes: ["b"] }],
    ["b", { coOccursWith: [], excludes: [] }],
    ["c", { coOccursWith: [], excludes: [] }]
  ]);
  const out = applyConditionRules(["a", "b"], rules);
  check("excludes drops the excluded id", out.includes("a") && !out.includes("b"), out.join(","));
  check("coOccurs adds the partner id", out.includes("c"), out.join(","));
  const kept = applyConditionRules(["b"], rules);
  check("unrelated draw keeps its id", kept.join(",") === "b", kept.join(","));
}

// 6. Clinical-number detector: catches vitals, allows dispatch facts.
{
  const bad = [
    "BP 90/60 and falling",
    "heart rate 130",
    "SpO2 95 percent on air",
    "oxygen saturation 94",
    "GCS 14, opens eyes to voice",
    "gave 10 mg morphine",
    "took 2 tablets",
    "pain 8/10",
    "15 L/min non-rebreather",
    "E4 V5 M6",
    "glucose 60 mg/dL",
    "temp 39.1"
  ];
  const good = [
    "28-year-old male down by the road",
    "Route 9 mile marker 14, northbound shoulder",
    "arrived 3 minutes ago, one patient",
    "Apartment 4B, door open",
    "two bystanders on scene",
    "about 175 pounds, tall",
    "ten minutes ago he was fine",
    "chest pain since morning, worst ever"
  ];
  const missed = bad.filter((t) => findClinicalNumbers(t).length === 0);
  const flagged = good.filter((t) => findClinicalNumbers(t).length > 0);
  check("vitals-like numbers are caught", missed.length === 0, missed.join(" | ") || `${bad.length}/${bad.length} caught`);
  check("dispatch facts pass", flagged.length === 0, flagged.join(" | ") || `${good.length}/${good.length} pass`);
}

// 7. Validator negatives plus one assembled positive.
{
  const base = sampleSkeleton(4242, 2);
  const badCond = { ...base, conditionIds: ["no_such_condition"] };
  check("unknown condition fails", !validateSkeleton(badCond).ok, "unknown id");
  const unready = { ...base, conditionIds: ["tension_pneumothorax"] };
  check("unready condition fails", !validateSkeleton(unready).ok, "not generatorReady");
  const l1bad = { ...sampleSkeleton(7, 1), complaintId: "overdose" };
  check("L1 with L2 complaint fails", !validateSkeleton(l1bad).ok, "minLevel rule");
  const badLevel = { ...base, level: 5 };
  check("bad level fails", !validateSkeleton(badLevel).ok, "level rule");

  const call = assembleCall(base, goodFlesh(base));
  const v = validateFleshedCall(call);
  check("assembled call validates", v.ok, v.errors.join("; ") || "clean");
  const wrongAge = assembleCall(base, goodFlesh(base));
  wrongAge.patient.age = base.patient.age + 1;
  check("wrong age echo fails", !validateFleshedCall(wrongAge).ok, "age echo");
  if (base.homeMeds.length > 0) {
    const droppedMed = assembleCall(base, goodFlesh(base));
    droppedMed.historyCard.SAMPLE.medications = "No daily meds.";
    check("dropped home med fails", !validateFleshedCall(droppedMed).ok, "med echo");
  } else {
    check("dropped home med fails", true, "seed 4242 has no meds, skipped");
  }
  const numbered = assembleCall(base, goodFlesh(base));
  numbered.dispatch.cadText += " BP 90/60.";
  check("clinical number in CAD fails", !validateFleshedCall(numbered).ok, "numbers rule");
  const noPath = assembleCall(base, goodFlesh(base));
  noPath.expectedPathway = "";
  check("empty pathway fails", !validateFleshedCall(noPath).ok, "pathway rule");

  const femoral = scanFor((s) => s.conditionIds.includes("femoral_arterial_bleed"), 2, 2000);
  if (femoral === null) {
    check("femoral fixture found", false, "no femoral case in 2000 seeds");
  } else {
    const fcall = assembleCall(femoral, goodFlesh(femoral));
    check("femoral call validates", validateFleshedCall(fcall).ok, `seed ${femoral.seed}`);
    const scrubbed = assembleCall(femoral, goodFlesh(femoral));
    scrubbed.dispatch.cadText = "Caller reports a person down.";
    scrubbed.persona = "A quiet patient.";
    scrubbed.historyCard.SAMPLE.signs_symptoms = "Rests quietly.";
    check("missing bleed story fails", !validateFleshedCall(scrubbed).ok, "keyword rule");
  }
  const medical = scanFor((s) => s.complaintId === "overdose", 2, 2000);
  if (medical === null) {
    check("overdose fixture found", false, "no overdose case in 2000 seeds");
  } else {
    const mcall = assembleCall(medical, goodFlesh(medical));
    check("overdose call validates", validateFleshedCall(mcall).ok, `seed ${medical.seed}`);
  }
}

// 8. Instantiation smoke: bleed call, medical call, both complications.
{
  const femoral = scanFor((s) => s.conditionIds.includes("femoral_arterial_bleed"), 2, 2000);
  if (femoral === null) {
    check("bleed sim builds", false, "no fixture");
  } else {
    const sim = newGeneratedSim(assembleCall(femoral, goodFlesh(femoral)));
    sim.setLevel(2);
    const start = sim.loss_mL;
    tick(sim, 60);
    check(
      "bleed sim loses blood and stays sane",
      sim.loss_mL > start && sim.vitals.hr_bpm > 40 && sim.vitals.hr_bpm < 200 && !sim.arrested,
      `loss=${Math.round(sim.loss_mL)}mL hr=${sim.vitals.hr_bpm}`
    );
    check("bleed sim bleeds", sim.bleedRate_mL_per_min() > 30, `${Math.round(sim.bleedRate_mL_per_min())}/min`);
  }
  const medical = scanFor((s) => s.complaintId === "overdose", 2, 2000);
  if (medical === null) {
    check("medical sim builds", false, "no fixture");
  } else {
    const sim = newGeneratedSim(assembleCall(medical, goodFlesh(medical)));
    sim.setLevel(2);
    tick(sim, 60);
    check(
      "medical sim is stable with no bleed",
      sim.loss_mL === 0 && sim.bleedRate_mL_per_min() === 0 && !sim.arrested,
      `hr=${sim.vitals.hr_bpm} spo2=${sim.vitals.spo2_pct}`
    );
    check("medical sim has no wound to expose", !sim.woundPresent, "hint gate");
  }
  const vom: CallSkeleton = { ...sampleSkeleton(99, 2), complication: { id: "vomiting", onset_s: 5 } };
  const vsim = newGeneratedSim(assembleCall(vom, goodFlesh(vom)));
  vsim.setLevel(2);
  tick(vsim, 10);
  check("vomiting fires on schedule", vsim.airway.soiled && vsim.airway.vomited, "soiled");
  const cleared = vsim.suctionAirway("mouth", 10);
  if (cleared.ok) finishPending(vsim);
  check("suction clears vomit", cleared.ok && !vsim.airway.soiled, "fix path");

  const rebFemoral = scanFor((s) => s.conditionIds.includes("femoral_arterial_bleed"), 2, 2000);
  if (rebFemoral === null) {
    check("re-bleed sim builds", false, "no fixture");
  } else {
    const reb: CallSkeleton = { ...rebFemoral, complication: { id: "re_bleed", onset_s: 200 } };
    const rsim = newGeneratedSim(assembleCall(reb, goodFlesh(reb)));
    rsim.setLevel(2);
    if (rsim.pressure.bystanderShirt) rsim.takeOverFromBystander();
    const ex = rsim.exposeWound();
    finishPending(rsim);
    const tq = rsim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 3, writeTime: true });
    finishPending(rsim);
    const occluded = rsim.tq.applied && rsim.tq.occluded;
    tick(rsim, 220);
    check(
      "re-bleed loosens the TQ",
      ex.ok && tq.ok && occluded && rsim.tq.loosened,
      `residual=${rsim.tq.residualFlow_0_to_1}`
    );
    check(
      "re-bleed is logged",
      rsim.log.some((e) => /re-bleed/i.test(e.text)),
      "log line"
    );
  }
}

// 9. Cache: at least 3 valid generated calls, each playable headless.
{
  let files: string[] = [];
  try {
    files = fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  check("at least 3 cached calls ship", files.length >= 3, files.join(", ") || "empty");
  let bad = 0;
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf8")) as unknown;
      const v = validateFleshedCall(raw);
      if (!v.ok) {
        bad += 1;
        console.log(`  ${f}: ${v.errors.join("; ")}`);
        continue;
      }
      const sim = newGeneratedSim(
        raw as Parameters<typeof newGeneratedSim>[0]
      );
      sim.setLevel(2);
      tick(sim, 60);
      if (sim.arrested || sim.vitals.hr_bpm <= 0) {
        bad += 1;
        console.log(`  ${f}: sim insane after 60 ticks`);
      }
    } catch (error) {
      bad += 1;
      console.log(`  ${f}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  check("every cached call validates and ticks", files.length >= 3 && bad === 0, `${bad} bad`);
}

// 10. Bike down fixed seed untouched.
{
  const bike = loadBikeDown();
  check("bike_down id and seed untouched", bike.id === "bike_down" && bike.seed === 1027, `seed ${bike.seed}`);
  const envs = new Set(loadEnvironments().environments.map((e) => e.id));
  check("demo envs exist", envs.has("bathroom_home") && envs.has("restaurant") && envs.has("park_picnic"), "bathroom/restaurant/picnic");
  const demo44 = sampleSkeleton(44, 2);
  const demo22 = sampleSkeleton(22, 2);
  const demo143 = sampleSkeleton(143, 2);
  check(
    "demo seed 44 is overdose in a bathroom",
    demo44.complaintId === "overdose" && demo44.environmentId === "bathroom_home",
    `${demo44.complaintId}+${demo44.environmentId}`
  );
  check(
    "demo seed 22 is chest pain at a restaurant",
    demo22.complaintId === "chest_pain" && demo22.environmentId === "restaurant",
    `${demo22.complaintId}+${demo22.environmentId}`
  );
  check(
    "demo seed 143 is allergy at a picnic",
    demo143.complaintId === "allergic_reaction" && demo143.environmentId === "park_picnic",
    `${demo143.complaintId}+${demo143.environmentId}`
  );
}

if (failures > 0) {
  console.log(`${failures} Oct 31 check(s) FAILED.`);
  process.exit(1);
}
console.log("All Oct 31 checks passed.");
