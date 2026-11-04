// Headless UI pass tests: MARCH log scan, unprompted speech gate and
// canned lines, chat fade timing, speed debt math, L1 tips gating, and a
// no-em-dash scan over every file this pass touched. DOM classes are not
// constructed here; only their pure helpers are imported, so this runs in
// tsx with no browser. Run: npm.cmd run sim:ui.

import { newBikeDownSim } from "../src/sim/scenario";
import type { Sim } from "../src/sim/engine";
import type { LogEvent } from "../src/sim/types";
import {
  UNPROMPTED_PROMPT,
  cannedUnprompted,
  canSpeakUnprompted
} from "../src/ui/talk";
import { CHAT_FADE_AFTER_MS, UNPROMPTED_GAP_S, micDeniedStatus, partnerChatLine, shouldFade, transcribeStatus } from "../src/ui/chatDock";
import { advanceDebt } from "../src/engine/loop";
import { MARCH_STEPS, marchProgress } from "../src/ui/marchStrip";
import { TIP_SHOW_MS, tipFor } from "../src/ui/tipsBubble";
import type { Tab } from "../src/ui/medicalMenu";
import { REGION_IDS } from "../src/patient/regions";
import { DOLL_SHAPES, dollCovers, markersFor } from "../src/ui/bodyDoll";
import { sayLine, setWording } from "../src/ui/wording";
import type { LineState } from "../src/sim/types";
import {
  bleedLineForTier,
  bleedTierForRate,
  bloodStepColor,
  bloodStepForTier,
  damageStepColor,
  fmtBandTime,
  fmtClockT,
  painWords,
  pulseRateWords
} from "../src/ui/acm/format";
import { ACM_CATEGORIES, TRIAGE_LEVELS, freshRunState } from "../src/ui/acm/types";
import { ndcFromClient } from "../src/engine/raycast";
import { DISCLAIMER_TEXT } from "../src/ui/disclaimer";
import { KEYBINDING_GROUPS } from "../src/ui/settings";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

let failures = 0;

function check(name: string, cond: boolean, detail: string): void {
  if (cond) {
    console.log(`PASS ${name} (${detail})`);
  } else {
    failures += 1;
    console.log(`FAIL ${name} (${detail})`);
  }
}

function fakeSim(over: {
  arrested?: boolean;
  rhythm?: string;
  ett?: null | object;
  gcs?: number;
  rr?: number;
  spo2?: number;
  pain?: number;
  atls?: string;
}): Sim {
  return {
    arrested: over.arrested ?? false,
    vitals: {
      rhythm: over.rhythm ?? "sinus",
      gcs_total: over.gcs ?? 15,
      rr_per_min: over.rr ?? 18,
      spo2_pct: over.spo2 ?? 97,
      pain_0_to_10: over.pain ?? 8,
      atlsClass: over.atls ?? "I"
    },
    airway: { ett: over.ett === undefined ? null : over.ett }
  } as unknown as Sim;
}

function logLine(t_s: number, kind: LogEvent["kind"], text: string): LogEvent {
  return { t_s, kind, text };
}

// 1. MARCH strip: empty log, nothing done, M is next.
{
  const p = marchProgress([]);
  check("march empty lights nothing", p.steps.every((s) => !s.done), "9 undone");
  check("march empty next is M", p.next === "M", String(p.next));
  check("march has 9 steps", MARCH_STEPS.length === 9, MARCH_STEPS.map((s) => s.id).join(""));
}

// 2. MARCH strip: one done action per step lights that step.
{
  const log = [
    logLine(30, "action", "Start: Tourniquet (CAT) (45s)."),
    logLine(60, "airway", "NPA 30 seated past the tongue: airway patent."),
    logLine(90, "airway", "BVM mask large: seals."),
    logLine(120, "fluid", "IV 18g forearm in, flash confirmed. Gravity 60 mL/min."),
    logLine(150, "action", "Patient wrapped. Hypothermia slide cut."),
    logLine(180, "action", "Fentanyl 100 mcg slow IV pushed."),
    logLine(210, "action", "Ceftriaxone 2 g IV for the open wound."),
    logLine(240, "movement", "Log roll with partner, check the back."),
    logLine(270, "action", "Splint applied to the forearm, PMS intact after.")
  ];
  const p = marchProgress(log);
  check("march full run lights all", p.steps.every((s) => s.done), "9 done");
  check("march full run has no next", p.next === null, "null");
  const mOnly = marchProgress([log[0] as LogEvent]);
  check("march TQ lights M only", mOnly.steps.filter((s) => s.done).map((s) => s.id).join("") === "M", "M");
  check("march M done next is A", mOnly.next === "A", String(mOnly.next));
  const takeover = marchProgress([logLine(30, "bleed", "Bystander lets go. The wound spurts.")]);
  check(
    "march take-over lights M not W",
    takeover.steps.find((s) => s.id === "M")?.done === true &&
      takeover.steps.find((s) => s.id === "W")?.done !== true,
    "M done, W undone"
  );
  const sweepNoWound = marchProgress([
    logLine(30, "exam", "Blood sweep: No wounds found. No active bleeding. Tenderness: left thigh. A full region-by-region exam is still needed for the rest.")
  ]);
  check("march sweep finding lights nothing", sweepNoWound.steps.every((s) => !s.done), "exam only");
}

// 3. MARCH strip: talk lines and automatic lines never count.
{
  const log = [
    logLine(40, "talk", 'You: "can you breathe with that tube in?"'),
    logLine(41, "talk", 'Josh: "I can breathe okay. It is my leg."'),
    logLine(50, "airway", "O2 tank at reserve (200 psi): flows room air now. Swap cylinders."),
    logLine(60, "fluid", "Line iv1: LR bag empty (1000 mL in)."),
    logLine(70, "vitals", "Shock index 1.1 (shock)."),
    logLine(0, "info", "Call start. Seed 1027. Blood loss at contact 250 mL."),
    logLine(0, "bleed", "Bystander holds a balled-up shirt on the wound (direct pressure, about 50 percent).")
  ];
  const p = marchProgress(log);
  check("march ignores talk and auto lines", p.steps.every((s) => !s.done), "none done");
  check("march ignores keep M next", p.next === "M", String(p.next));
  const refused = marchProgress([
    logLine(30, "info", "Cannot: Place IO - 15 mm is the wrong needle for tibial (Josh needs 25 mm)."),
    logLine(31, "info", "Cannot: Prep and push (45s) - Fentanyl is in the Narc box: stage it first.")
  ]);
  check("march ignores Cannot refusals", refused.steps.every((s) => !s.done), "refusals are not done");
}

// 4. Unprompted gate: real bike sim speaks, bad states stay silent.
{
  const bike = newBikeDownSim();
  bike.setLevel(1);
  check("bike down can speak unprompted", canSpeakUnprompted(bike), "gate open");
  check("arrest silences unprompted", !canSpeakUnprompted(fakeSim({ arrested: true })), "arrested");
  check("pea silences unprompted", !canSpeakUnprompted(fakeSim({ rhythm: "pea" })), "pea");
  check("tube silences unprompted", !canSpeakUnprompted(fakeSim({ ett: {} })), "ett");
  check("gcs 8 silences unprompted", !canSpeakUnprompted(fakeSim({ gcs: 8 })), "gcs8");
  check("gcs 9 keeps unprompted", canSpeakUnprompted(fakeSim({ gcs: 9 })), "gcs9");
  check("pain alone keeps unprompted", canSpeakUnprompted(fakeSim({ pain: 10 })), "pain10");
}

// 5. Canned unprompted lines: short, neutral, state-aware.
{
  const calm = cannedUnprompted(fakeSim({ pain: 2, rr: 18, spo2: 97, atls: "I" }));
  const hurt = cannedUnprompted(fakeSim({ pain: 9 }));
  const air = cannedUnprompted(fakeSim({ rr: 34 }));
  const shock = cannedUnprompted(fakeSim({ atls: "III", gcs: 13, pain: 3, rr: 18, spo2: 97 }));
  for (const [name, line] of [["calm", calm], ["hurt", hurt], ["air", air], ["shock", shock]] as const) {
    check(`canned unprompted ${name} is short`, line.length < 160, `${line.length} chars`);
    check(`canned unprompted ${name} neutral`, !/josh|leg|bleed|tourniquet/i.test(line), "no identity");
  }
  check("canned hurt names pain", /hurt/i.test(hurt), hurt.slice(0, 40));
  check("canned air names breathing", /air|breathe/i.test(air), air.slice(0, 40));
  check("canned shock is confused", /sorry|what/i.test(shock), shock.slice(0, 40));
  check("unprompted prompt fits the route cap", UNPROMPTED_PROMPT.length <= 300, `${UNPROMPTED_PROMPT.length} chars`);
  check("unprompted prompt bans unasked history", /unless this conversation already covered it/i.test(UNPROMPTED_PROMPT), "ban line");
}

// 6. Chat fade and unprompted cadence constants.
{
  check("fade delay is 8s", CHAT_FADE_AFTER_MS === 8000, `${CHAT_FADE_AFTER_MS}ms`);
  check("no fade just before 8s", !shouldFade(0, 7999), "7999ms");
  check("fade at 8s", shouldFade(0, 8000), "8000ms");
  check("unprompted gap is 45 sim-s", UNPROMPTED_GAP_S === 45, `${UNPROMPTED_GAP_S}s`);
}

// 7. Speed debt math: rate scales pace, never tick size.
{
  check("half speed halves debt", advanceDebt(0, 1, 0.5) === 0.5, "0.5");
  check("normal speed keeps debt", advanceDebt(0, 1, 1) === 1, "1");
  check("double speed doubles debt", advanceDebt(0, 1, 2) === 2, "2");
  check("debt accumulates", advanceDebt(0.7, 0.5, 1) === 1.2, "1.2");
  check("bad rate falls back to 1x", advanceDebt(0, 1, Number.NaN) === 1, "nan->1");
}

// 8. L1 tips: one line per tab, L2 gets none, no right-option language.
{
  const tabs: Tab[] = ["examine", "airway", "breathing", "circulation", "meds", "lines", "monitor"];
  check("tips bubble shows 6s", TIP_SHOW_MS === 6000, `${TIP_SHOW_MS}ms`);
  for (const tab of tabs) {
    const tip = tipFor(tab, 1);
    check(`L1 tip for ${tab}`, tip !== null && tip.length < 160, `${tip?.length ?? 0} chars`);
    check(`L2 no tip for ${tab}`, tipFor(tab, 2) === null, "null");
  }
  const all = tabs.map((t) => tipFor(t, 1) ?? "").join(" ");
  check("tips never name the right option", !/right option|pick the|choose the|correct choice/i.test(all), "why-only");
  check("tips keep traps shut", !/trap/i.test(all), "no trap word");
}

// 9. Paper doll: every region covered, markers from engine state only.
{
  const uncovered = REGION_IDS.filter((r) => !dollCovers(r));
  check("doll covers all regions", uncovered.length === 0, `${REGION_IDS.length - uncovered.length}/${REGION_IDS.length}`);
  check("doll has 14 front shapes", Object.keys(DOLL_SHAPES).length === 14, "back is a button");
  const fresh = newBikeDownSim();
  check("fresh sim has no markers", markersFor(fresh).length === 0, "none");
  fresh.tq.applied = true;
  const tq = markersFor(fresh);
  check("TQ marks the thigh", tq.length === 1 && tq[0]?.kind === "tq", tq[0]?.label ?? "none");
  // Nov 3 flip: patient left sits on the viewer left (x < 60), matching
  // the default 3D view. Bounds mirror the old viewer-right ones.
  check(
    "TQ sits inside the left leg shape",
    (tq[0]?.x ?? 0) >= 40 && (tq[0]?.x ?? 0) <= 58 && (tq[0]?.y ?? 0) >= 125 && (tq[0]?.y ?? 0) <= 180,
    `${tq[0]?.x},${tq[0]?.y}`
  );
  fresh.tq.secondApplied = true;
  check("2nd TQ adds a ring", markersFor(fresh).filter((m) => m.kind === "tq").length === 2, "2 rings");
  fresh.packing.stage = "set";
  fresh.dressing.applied = true;
  const wound = markersFor(fresh);
  check("packing marks the thigh", wound.some((m) => m.kind === "packing"), "packing");
  check("dressing marks the thigh", wound.some((m) => m.kind === "dressing"), "dressing");
  const line = (over: Partial<LineState> & { id: number; site: string }): LineState => ({
    kind: "iv",
    patent: true,
    infiltrated: false,
    placedAt_s: 0,
    pressureBag: false,
    flow_mL_per_min: 60,
    bag: null,
    infused_mL: 0,
    ioLidoGiven: false,
    ySet: null,
    warmerOn: false,
    dripSetOn: false,
    ...over
  });
  fresh.fluids.lines.push(line({ id: 1, site: "ac" }));
  fresh.fluids.lines.push(
    line({ id: 2, kind: "io", site: "tibial", ySet: { primedAt_s: 0, unitsHung: 2, nsLeft_mL: 200 }, warmerOn: true })
  );
  fresh.fluids.lines.push(line({ id: 3, kind: "io", site: "sternal" }));
  const marks = markersFor(fresh);
  const iv = marks.find((m) => m.label === "Line 1: iv ac");
  const tib = marks.find((m) => m.label === "Line 2: io tibial");
  const stern = marks.find((m) => m.label === "Line 3: io sternal");
  check("IV line dots the arm", iv?.kind === "iv" && (iv?.x ?? 0) > 60, `${iv?.x},${iv?.y}`);
  check("tibial IO flags Y set and warmer", tib?.kind === "io" && tib.ySet && tib.warmer, "y+heat");
  check("sternal IO sits on the chest center", stern?.x === 60 && stern?.y === 48, "60,48");
}

// 10. Wording: plain translations and single-application safety.
{
  setWording("medical");
  check("medical mode is verbatim", sayLine("Abdomen RUQ, Y set on") === "Abdomen RUQ, Y set on", "verbatim");
  setWording("plain");
  const pairs: Array<[string, string]> = [
    ["Abdomen RUQ", "Belly Upper right"],
    ["Abdomen LLQ", "Belly Lower left"],
    ["Pelvis", "Hips"],
    ["Y set 2/4 units, NS 200 mL", "Blood Y tube 2/4 units, Saline 200 mL"],
    ["Sternal (FAST1)", "Breastbone (Bone-infusion chest kit)"],
    ["Circulation", "Blood flow"],
    ["Meds", "Medicines"],
    ["Lines", "Drip tubes"],
    ["Examine", "Check over"],
    ["Airway", "Breathing path"],
    ["(in Narc box)", "(in Locked medicine box)"],
    ["Critical care box", "ICU medicine box"],
    ["Start IO tibial (25 mm)", "Start Bone drip shin (25 mm)"],
    ["Line 1: iv ac", "Line 1: vein drip elbow crease"],
    ["Prime Y tubing + warmer", "Prime Blood Y tube + blood heater"],
    ["Fluid warmer 38 C on line 1", "Blood heater 38 C on line 1"],
    ["Blood sweep (12s)", "Bleed check (12s)"],
    ["Run report", "Run summary"],
    ["CBRN kit", "Hazmat kit"],
    ["RSI kit", "Crash breathing kit"],
    ["Pelvic binder", "Hip belt"],
    ["Needle decompression kit", "Chest needle kit"],
    ["Cap refill", "Nail-bed refill"],
    ["ETT 7.5 at 21 cm", "Breathing tube 7.5 at 21 cm"]
  ];
  for (const [medical, plain] of pairs) {
    check(`plain: ${medical}`, sayLine(medical) === plain, sayLine(medical).slice(0, 48));
  }
  const idempotent = pairs.every(([, plain]) => sayLine(plain) === plain);
  check("plain output survives a second sweep", idempotent, "no key in any plain");
  setWording("medical");
}

// 11. No em-dashes or en-dashes in touched files.
{
  const touched = [
    "src/ui/talk.ts",
    "src/ui/chatDock.ts",
    "src/ui/speedBar.ts",
    "src/ui/marchStrip.ts",
    "src/ui/tipsBubble.ts",
    "src/ui/sceneLog.ts",
    "src/ui/medicalMenu.ts",
    "src/ui/flow.ts",
    "src/ui/hud.ts",
    "src/ui/debrief.ts",
    "src/ui/bodyDoll.ts",
    "src/ui/wording.ts",
    "src/ui/monitorWords.ts",
    "src/ui/dollPanel.ts",
    "src/ui/progressBar.ts",
    "src/ui/heldItem.ts",
    "src/ui/settings.ts",
    "src/ui/sound.ts",
    "src/sim/physiology.ts",
    "src/ui/kitLabels.ts",
    "src/engine/camera.ts",
    "src/engine/input.ts",
    "src/engine/scene.ts",
    "server/routes/patient.ts",
    "server/prompts/patient.txt",
    "schemas/drugs.schema.json",
    "scripts/nov03-test.ts",
    "src/engine/loop.ts",
    "src/engine/raycast.ts",
    "src/main.ts",
    "src/style.css",
    "src/flow.css",
    "index.html",
    "scripts/ui-test.ts",
    "scripts/kit-test.ts",
    "scripts/sim-test.ts",
    "scripts/oct29-test.ts",
    "scripts/validate-data.ts",
    "src/sim/engine.ts",
    "src/sim/types.ts",
    "src/sim/scenario.ts",
    "src/sim/drugs.ts",
    "src/data/loaders.ts",
    "data/medical/equipment.json",
    "package.json",
    "src/acm.css",
    "src/ui/acm/types.ts",
    "src/ui/acm/format.ts",
    "src/ui/acm/rows.ts",
    "src/ui/acm/body.ts",
    "src/ui/acm/actions.ts",
    "src/ui/acm/actions2.ts",
    "src/ui/acm/cards.ts",
    "src/ui/acm/overview.ts",
    "src/ui/acm/bottom.ts",
    "src/ui/acm/monitor.ts",
    "src/ui/acm/shell.ts",
    "src/ui/title.ts",
    "src/ui/disclaimer.ts",
    "src/title.css"
  ];
  const banned = /[\u2014\u2013]/;
  let clean = 0;
  for (const file of touched) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (!banned.test(text)) clean += 1;
    else console.log(`DASH ${file}`);
  }
  check("no em or en dashes in touched files", clean === touched.length, `${clean}/${touched.length} clean`);
}

// 12. ACM overlay pure helpers: tiers, clocks, colors, words, run state.
{
  check("tier cut at 30", bleedTierForRate(29) === "none" && bleedTierForRate(30) === "slow", "visible cut");
  check(
    "tier buckets",
    bleedTierForRate(0) === "none" &&
      bleedTierForRate(149) === "slow" &&
      bleedTierForRate(150) === "moderate" &&
      bleedTierForRate(399) === "moderate" &&
      bleedTierForRate(400) === "severe" &&
      bleedTierForRate(699) === "severe" &&
      bleedTierForRate(700) === "massive",
    "slow/moderate/severe/massive"
  );
  check(
    "tier steps",
    bloodStepForTier("none") === 0 &&
      bloodStepForTier("slow") === 3 &&
      bloodStepForTier("moderate") === 5 &&
      bloodStepForTier("severe") === 8 &&
      bloodStepForTier("massive") === 10,
    "0/3/5/8/10"
  );
  check("tier line words", bleedLineForTier("massive").text === "Massive bleeding", "words only");
  check("band clock", fmtBandTime(51) === "0:51", "m:ss");
  check("overlay clock", fmtClockT(51) === "T+00:51" && fmtClockT(125) === "T+02:05", "T+mm:ss");
  check("blood scale ends", bloodStepColor(0) === "#232c3d" && bloodStepColor(10) === "#ff0000", "base to red");
  check("damage scale ends", damageStepColor(0) === "#232c3d" && damageStepColor(10) === "#0000ff", "base to blue");
  check(
    "pain words",
    painWords(0) === "no pain" && painWords(3) === "mild pain" && painWords(6) === "moderate pain" && painWords(8) === "severe pain" && painWords(10) === "worst pain",
    "0-10 buckets"
  );
  check(
    "pulse words",
    pulseRateWords(0) === "no pulse" && pulseRateWords(55) === "slow" && pulseRateWords(80) === "steady" && pulseRateWords(120) === "fast" && pulseRateWords(150) === "very fast",
    "rate buckets"
  );
  check("eight categories", ACM_CATEGORIES.length === 8 && ACM_CATEGORIES[0]?.key === "1", "keys 1-8");
  check("five triage levels", TRIAGE_LEVELS.length === 5 && TRIAGE_LEVELS[3]?.id === "immediate", "none to deceased");
  const fresh = freshRunState();
  check("fresh run state", fresh.category === "examine" && fresh.triage === "none" && fresh.drugId === "fentanyl", "examine/none/fentanyl");
  setWording("plain");
  check("plain: Triage card", sayLine("Triage card") === "Injury sort card", "injury sort");
  check("plain: NIBP auto cycle", sayLine("NIBP auto cycle (40s)") === "Pressure cuff auto cycle (40s)", "pressure cuff");
  check("plain: distal pulse", sayLine("No distal pulse palpable.") === "No far pulse can be felt.", "far/can be felt");
  check("plain: venous congestion", sayLine("No venous congestion.") === "No vein blood backup.", "vein/blood backup");
  check("plain: waveform EtCO2", sayLine("Attach waveform EtCO2") === "Attach wave trace Exhaled CO2", "wave trace");
  check("plain: TOXIC", sayLine("TOXIC") === "Poisonous", "poisonous");
  check("plain: CPAP", sayLine("CPAP (cabinet)") === "Pressure mask (cabinet)", "pressure mask");
  check("plain: radial/carotid", sayLine("Pulse: radial/carotid") === "Pulse: wrist/neck", "wrist/neck");
  setWording("medical");
}

// 13. Zoom-proof picking: the same visible pixel maps to the same NDC
// at every text size. Medium 1.0 matches the old window-fraction math
// exactly; small 0.9, large 1.15, and xl 1.3 scale the canvas box.
{
  const W = 1280;
  const H = 720;
  const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  const box = (zoom: number): { left: number; top: number; width: number; height: number } => ({
    left: 0,
    top: 0,
    width: W * zoom,
    height: H * zoom
  });
  // Medium: corners and center, exact against the old formula.
  const center = ndcFromClient(W / 2, H / 2, box(1));
  const oldCenter = { x: (W / 2 / W) * 2 - 1, y: -((H / 2 / H) * 2 - 1) };
  check("zoom medium center exact", close(center.x, oldCenter.x) && close(center.y, oldCenter.y), "(0,0)");
  const corner = ndcFromClient(0, 0, box(1));
  check("zoom medium corner exact", close(corner.x, -1) && close(corner.y, 1), "(-1,1)");
  const edge = ndcFromClient(W, H, box(1));
  check("zoom medium edge exact", close(edge.x, 1) && close(edge.y, -1), "(1,-1)");
  // Other sizes: the zoomed client point lands on the same NDC.
  for (const zoom of [0.9, 1.15, 1.3]) {
    const px = 431;
    const py = 287;
    const want = ndcFromClient(px, py, box(1));
    const got = ndcFromClient(px * zoom, py * zoom, box(zoom));
    check(`zoom ${zoom} same pixel`, close(got.x, want.x) && close(got.y, want.y), "pick invariant");
  }
  // Offset box (letterboxed canvas) still works.
  const off = ndcFromClient(140, 90, { left: 100, top: 50, width: 200, height: 100 });
  check("zoom offset box", close(off.x, -0.6) && close(off.y, 0.2), "rect origin honored");
}

// 14. Mic live-path diagnostics: every failure step names its step, and
// the no-key line never carries the key.
{
  check("mic denied", micDeniedStatus("NotAllowedError") === "Mic blocked - allow the mic or type instead.", "blocked");
  check("mic missing", micDeniedStatus("NotFoundError") === "No mic found - type instead.", "missing");
  check("mic unknown", micDeniedStatus("") === "Mic blocked or missing - type instead.", "fallback");
  const noKey = transcribeStatus(500, "MODEL_API_KEY is missing in server/.env");
  check("transcribe no key", noKey === "Voice key not set on the server - type instead.", "setup step named");
  check("transcribe no key leaks nothing", !noKey.includes("MODEL_API_KEY") && !noKey.includes(".env"), "no key material");
  check("transcribe 500", transcribeStatus(500, "internal server error") === "Mic transcript failed (server error) - type instead.", "server error");
  check("transcribe 502", transcribeStatus(502, "Meta call failed") === "Voice service failed - type instead.", "upstream fail");
  check("transcribe 400", transcribeStatus(400, "audio must be 1 byte to 5 MB") === "Mic clip rejected by the server - type instead.", "validation");
  check("transcribe other", transcribeStatus(503, "") === "Mic transcript failed (server 503) - type instead.", "status fallback");
}

// 15. Disclaimer exactness and keybindings display data.
{
  setWording("medical");
  check("disclaimer medical exact", sayLine(DISCLAIMER_TEXT) === DISCLAIMER_TEXT, "byte for byte");
  setWording("plain");
  check("disclaimer plain exact", sayLine(DISCLAIMER_TEXT) === DISCLAIMER_TEXT, "no table word inside");
  check("disclaimer three paragraphs", DISCLAIMER_TEXT.split("\n\n").length === 3, "split on blank lines");
  check("keys eight groups", KEYBINDING_GROUPS.length === 8, "menu/categories/parts/camera/talk/debug/chat/doll");
  const rows = KEYBINDING_GROUPS.flatMap((g) => g.rows);
  check("keys every group has rows", KEYBINDING_GROUPS.every((g) => g.rows.length > 0), `${rows.length} rows`);
  const notes = KEYBINDING_GROUPS.map((g) => g.note ?? "").join(" ");
  check("keys orientation note", notes.includes("screen-left") && notes.includes("swaps them"), "both orientations");
  check("keys ctrl note", notes.includes("Ctrl+H") && notes.includes("may not work in all browsers"), "browser risk");
  const blob = JSON.stringify(KEYBINDING_GROUPS).toLowerCase();
  check("keys no remap controls", !blob.includes("remap") && !blob.includes("capture") && !blob.includes("reset"), "display only");
  const keysLiteral = rows.every((r) => sayLine(r.key) === r.key);
  check("keys render literally in plain", keysLiteral, "chips never reworded");
  const catRow = KEYBINDING_GROUPS.find((g) => g.group.startsWith("Categories"))?.rows[0]?.does ?? "";
  check("keys descriptions switch", sayLine(catRow).includes("Injury sort"), "Triage rewords in plain");
  setWording("medical");
}

// 16. Partner hints live only in chat, worded at post time like the old
// top bar showed them. No top-bar or bubble code path remains.
{
  const hint = "Partner: crank the tourniquet until the bleeding stops.";
  setWording("medical");
  const med = partnerChatLine(hint);
  check("partner chat medical", med.speaker === "partner" && med.kind === "hint" && med.text === hint, "identical");
  setWording("plain");
  const plain = partnerChatLine(hint);
  check("partner chat plain worded", plain.text.includes("leg band"), "tourniquet rewords");
  check("partner chat keeps speaker", plain.speaker === "partner" && plain.kind === "hint", "avatar + quiet line");
  setWording("medical");
  const source = fs.readFileSync(path.join(root, "src/ui/flow.ts"), "utf8");
  check("no top hint bar code", !source.includes("hintBar") && !source.includes("updateHint"), "flow.ts clean");
  const tips = fs.readFileSync(path.join(root, "src/ui/tipsBubble.ts"), "utf8");
  check("no bubble code", !tips.includes("tips-bubble") && !tips.includes("setTimeout"), "tipsBubble.ts clean");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  check("no top hint divs", !html.includes("partner-hint") && !html.includes("tips-bubble"), "index.html clean");
}

// 17. Title overlay carries no duplicate words; buttons group bottom.
{
  const title = fs.readFileSync(path.join(root, "src/ui/title.ts"), "utf8");
  check("title no overlay h1", !title.includes("title-h1") && !title.includes("title-framing"), "words live in the video");
  check("title button group", title.includes("title-btn-group"), "bottom third group");
  const css = fs.readFileSync(path.join(root, "src/title.css"), "utf8");
  check("title bottom third css", css.includes("flex-end") && css.includes("title-btn-group"), "flex-end + group");
  check("title no full dim", !css.includes("title-ui") || !/\.title-ui \{[^}]*background:/s.test(css), "wordmark stays bright");
  check("title logo wired", title.includes("First_Due__Paramedic_Simulator.png"), "real asset path");
  check("title logo card + poster", title.includes("title-card-img") && title.includes("video.poster"), "fallback + poster");
}

if (failures > 0) {
  console.log(`${failures} UI check(s) failed.`);
  process.exit(1);
} else {
  console.log("All UI checks passed.");
}
