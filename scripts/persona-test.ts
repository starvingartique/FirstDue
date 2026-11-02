// Headless persona tests for the Nov 1 Josh voice fix. A generated patient
// uses its own generated persona and history: never Josh, never a leg bleed
// unless the generated condition includes one. Bike down keeps the Josh
// voice exactly. Run: npm.cmd run sim:persona (PowerShell).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newBikeDownSim } from "../src/sim/scenario";
import { newGeneratedSim } from "../src/dispatch/instantiate";
import { sampleSkeleton } from "../src/dispatch/sampler";
import { assembleCall } from "../src/dispatch/validate";
import type { FleshedCall, LlmFlesh } from "../src/dispatch/types";
import { cannedReply, patientSnapshot } from "../src/ui/talk";

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

function loadCached(file: string): FleshedCall {
  return JSON.parse(fs.readFileSync(path.join(cacheDir, file), "utf8")) as FleshedCall;
}

const BLEED = /thigh|femoral|arterial|spurting|leg bleed|leg is bleeding|my leg|time band/i;
const JOSH = /josh/i;

const PROBES = [
  "what is your name",
  "what happened",
  "how bad is the pain",
  "can you breathe okay",
  "is that band too tight",
  "hello there"
];

/** Compact valid flesh for one skeleton. Only the voice fields matter here. */
function fleshFor(seed: number, name: string, persona: string): { call: FleshedCall } {
  const skeleton = sampleSkeleton(seed, 2);
  const flesh: LlmFlesh = {
    dispatch: {
      nature: "Test call",
      address: "Route 9 mile marker 14",
      cadText: "Caller reports a person down at this location.",
      updates: []
    },
    scene: { description: "Test scene." },
    patient: { name },
    persona,
    historyCard: {
      SAMPLE: {
        signs_symptoms: persona,
        allergies: "No known drug allergies.",
        medications: "Takes nothing daily.",
        past_history: "No known history.",
        last_meal: "Ate a few hours ago.",
        events: "Test events."
      },
      OPQRST: {
        onset: "Started suddenly.",
        provokes: "Movement makes it worse.",
        quality: "Sharp.",
        radiates: "Stays where it started.",
        severity_words: "Bad, in plain words.",
        time: "Ongoing."
      },
      secrets: []
    },
    bystander: { label: "No bystander on arrival", lines: [] },
    expectedPathway: "Test pathway: assess, treat, transport, report, hand off."
  };
  return { call: assembleCall(skeleton, flesh) };
}

// 1. Seed 143: allergic reaction, no bleed. Mark D., own persona and history.
{
  const call = loadCached("gen_143_L2.json");
  const sim = newGeneratedSim(call);
  sim.setLevel(2);
  check("143 patient is Mark D.", sim.patientName === "Mark D.", sim.patientName);
  check("143 persona set, never Josh", sim.persona !== null && !JOSH.test(sim.persona), `${sim.persona?.length ?? 0} chars`);
  check("143 persona carries the sting history", sim.persona !== null && /sting/i.test(sim.persona), "sting");
  check("143 persona carries the epi secret", sim.persona !== null && /epi pen/i.test(sim.persona), "epi pen");
  const snap = patientSnapshot(sim);
  check("143 snapshot never says Josh", !JOSH.test(snap), snap.slice(0, 60));
  check("143 snapshot never mentions a leg bleed", !BLEED.test(snap), snap.slice(0, 80));
  for (const probe of PROBES) {
    const reply = cannedReply(sim, probe);
    check(`143 canned keeps "${probe}" clean`, !JOSH.test(reply) && !BLEED.test(reply), reply.slice(0, 70));
  }
  check("143 name probe says Mark", /mark/i.test(cannedReply(sim, "what is your name")), "Mark");
}

// 2. Seed 44: overdose, no bleed. Maya Ellis, own persona and history.
{
  const call = loadCached("gen_44_L2.json");
  const sim = newGeneratedSim(call);
  sim.setLevel(2);
  check("44 patient is Maya Ellis", sim.patientName === "Maya Ellis", sim.patientName);
  check("44 persona set, never Josh", sim.persona !== null && !JOSH.test(sim.persona), `${sim.persona?.length ?? 0} chars`);
  check("44 persona carries the pill history", sim.persona !== null && /pill|tablet/i.test(sim.persona), "pills");
  const snap = patientSnapshot(sim);
  check("44 snapshot never says Josh", !JOSH.test(snap), snap.slice(0, 60));
  check("44 snapshot never mentions a leg bleed", !BLEED.test(snap), snap.slice(0, 80));
  for (const probe of PROBES) {
    const reply = cannedReply(sim, probe);
    check(`44 canned keeps "${probe}" clean`, !JOSH.test(reply) && !BLEED.test(reply), reply.slice(0, 70));
  }
  check("44 name probe says Maya", /maya/i.test(cannedReply(sim, "what is your name")), "Maya");
}

// 3. Generated bleed: the unless-clause. A femoral case may mention the thigh.
{
  let seed = -1;
  for (let s = 1; s <= 2000; s++) {
    if (sampleSkeleton(s, 2).conditionIds.includes("femoral_arterial_bleed")) {
      seed = s;
      break;
    }
  }
  check("femoral fixture found", seed > 0, `seed ${seed}`);
  if (seed > 0) {
    const { call } = fleshFor(seed, "Test Bleed", "Scared, leg bleeding heavily from the thigh.");
    const sim = newGeneratedSim(call);
    sim.setLevel(2);
    check("bleed call has a wound to expose", sim.woundPresent, "woundPresent");
    const snap = patientSnapshot(sim);
    check("bleed snapshot never says Josh", !JOSH.test(snap), snap.slice(0, 60));
    check("bleed snapshot names the thigh wound", /thigh wound is bleeding/i.test(snap), "thigh");
    check("bleed name probe uses the call name", /^I'm Test\./.test(cannedReply(sim, "what is your name")), "Test");
  }
}

// 4. Bike down keeps the Josh voice exactly.
{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  check("bike down patient is Josh", sim.patientName === "Josh", sim.patientName);
  check("bike down uses the locked block", sim.persona === null, "null persona");
  const snap = patientSnapshot(sim);
  check("bike down snapshot keeps the thigh wound", /thigh wound is bleeding/i.test(snap), "wound");
  check("bike down name probe says Josh", /^Josh\./.test(cannedReply(sim, "what is your name")), "Josh");
  check("bike down history keeps the truck", /truck/i.test(cannedReply(sim, "what happened")), "truck");
}

if (failures > 0) {
  console.log(`${failures} persona check(s) FAILED.`);
  process.exit(1);
}
console.log("All persona checks passed.");
