// FTO debrief: facts collector, code-built fallback, and Spark fetch.
// Built from the event log and final engine state only, plus the expected
// care pathway. No new clinical grading rules: the fallback reports facts
// (done / not done / timestamps) and leaves destination correctness plus
// the four open clinical questions explicitly open, never graded.

import type { Sim } from "../sim/engine";
import type { LogEvent } from "../sim/types";

export const FTO_FRAMING =
  "Simulation and education only - not medical advice, not for real patient care.";

/**
 * Bike down pathway, mirroring the shipped Oct 30 well-played sequence.
 * Used only when the call carries no expectedPathway of its own: the fixed
 * seed has none, and the seed itself stays untouched.
 */
export const BIKE_DOWN_PATHWAY =
  "Take over from the bystander, expose the thigh, remove the belt, apply " +
  "the CAT high and tight with the time written, package, choose a " +
  "destination, transport, radio MIST report, hand off.";

export interface DebriefCheck {
  label: string;
  pass: boolean;
}

export interface DebriefFinal {
  t_s: number;
  loss_mL: number;
  rate: number;
  atlsClass: string;
  arrested: boolean;
  controlled: boolean;
  patency: number;
  ettIn: boolean;
  o2device: string;
  wrapped: boolean;
  lineCount: number;
  drugCount: number;
  tqApplied: boolean;
  timeWritten: boolean;
  beltLeft: boolean;
  exposed: boolean;
  woundPresent: boolean;
  sweepDone: boolean;
  sizeupCount: number;
}

export interface DebriefFacts {
  levelLabel: string;
  destination: string;
  win: boolean;
  checks: DebriefCheck[];
  log: LogEvent[];
  final: DebriefFinal;
  pathway: string;
  radioComplete: boolean;
  radioLines: number;
}

export function collectDebrief(
  sim: Sim,
  opts: {
    levelLabel: string;
    destination: string;
    sizeupCount: number;
    radioComplete: boolean;
    checks: DebriefCheck[];
    win: boolean;
    pathway: string;
  }
): DebriefFacts {
  const rate = sim.bleedRate_mL_per_min();
  return {
    levelLabel: opts.levelLabel,
    destination: opts.destination,
    win: opts.win,
    checks: opts.checks,
    log: sim.log.slice(-120),
    final: {
      t_s: sim.t_s,
      loss_mL: Math.round(sim.loss_mL),
      rate: Math.round(rate),
      atlsClass: sim.arrested ? "arrested" : sim.vitals.atlsClass,
      arrested: sim.arrested,
      controlled: rate < 30,
      patency: Math.round(sim.airway.patency_0_to_1 * 100) / 100,
      ettIn: sim.airway.ett !== null,
      o2device: sim.o2.device,
      wrapped: sim.wrapped,
      lineCount: sim.fluids.lines.length,
      drugCount: sim.drugs.active.length,
      tqApplied: sim.tq.applied && sim.tq.occluded,
      timeWritten: sim.tq.timeWritten,
      beltLeft: sim.beltTrap,
      exposed: sim.exposed,
      woundPresent: sim.woundPresent,
      sweepDone: sim.sweepReport !== null,
      sizeupCount: opts.sizeupCount
    },
    pathway: opts.pathway,
    radioComplete: opts.radioComplete,
    radioLines: sim.log.filter((e) => e.text.startsWith("Radio:")).length
  };
}

function fmtClock(t_s: number): string {
  const m = Math.floor(t_s / 60);
  const s = t_s % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Timeline markers: first hit per tag. Traps, class changes and arrests take all by kind. */
const TIMELINE_TAGS: Array<{ tag: string; re: RegExp }> = [
  { tag: "level", re: /Level chosen/ },
  { tag: "sizeup", re: /Size-up complete/ },
  { tag: "takeover", re: /Take over from|Bystander lets go/ },
  { tag: "expose", re: /Thigh exposed|Exposed: no major wound/ },
  { tag: "belt", re: /Belt removed|Belt cinched/ },
  { tag: "tq", re: /TQ time written|Apply CAT|second CAT/i },
  { tag: "packing", re: /Wound packed|packing pressure/i },
  { tag: "pressure", re: /Direct pressure|pressure dressing/i },
  { tag: "o2", re: /O2 .*L\/min|oxygen on/i },
  { tag: "line", re: /IV flowing|IO placed|line placed/i },
  { tag: "drug", re: /Push .*mcg|drug given/i },
  { tag: "sweep", re: /Blood sweep/ },
  { tag: "package", re: /Destination chosen|Loaded for transport/ },
  { tag: "transport", re: /Transport skip|Arrived at/ },
  { tag: "radio", re: /Radio: complete|Radio: you confirmed/ },
  { tag: "end", re: /Run over/ }
];

function timelineLines(log: LogEvent[]): string[] {
  const taken = new Set<string>();
  const lines: string[] = [];
  for (const e of log) {
    if (e.kind === "trap" || e.kind === "class" || e.kind === "arrest") {
      lines.push(`T+${fmtClock(e.t_s)} - ${e.text}`);
      continue;
    }
    for (const { tag, re } of TIMELINE_TAGS) {
      if (taken.has(tag)) continue;
      if (re.test(e.text)) {
        taken.add(tag);
        lines.push(`T+${fmtClock(e.t_s)} - ${e.text}`);
        break;
      }
    }
    if (lines.length >= 16) break;
  }
  return lines;
}

const FIRST_HANDS = [/TQ time written/i, /Wound packed/i, /Direct pressure/i, /pressure dressing/i, /Take over from/i, /packing pressure/i];

function firstHandsAt(log: LogEvent[]): number | null {
  for (const e of log) {
    if (e.t_s > 0 && FIRST_HANDS.some((re) => re.test(e.text))) return e.t_s;
  }
  return null;
}

/**
 * Code-built fallback debrief. Facts only: the same sections the Spark FTO
 * covers, with no grade invented when Spark is unreachable.
 */
export function buildFallbackDebrief(f: DebriefFacts): string {
  const s: string[] = [];
  s.push(`FTO DEBRIEF - ${f.win ? "HANDOFF, PATIENT ALIVE" : "RUN LOST"} (${f.levelLabel})`);
  s.push(FTO_FRAMING);
  s.push("");
  s.push("Timeline of key moments:");
  const timeline = timelineLines(f.log);
  s.push(...(timeline.length > 0 ? timeline.map((l) => `- ${l}`) : ["- No key moments logged."]));
  s.push("");
  s.push("What went right:");
  const right: string[] = [];
  for (const c of f.checks) {
    if (c.pass) right.push(`- Handoff check passed: ${c.label}.`);
  }
  if (f.final.tqApplied) right.push(`- Bleed controlled with the CAT (rate ${f.final.rate}/min at handoff).`);
  if (f.final.timeWritten) right.push("- TQ time written.");
  if (f.final.o2device !== "none") right.push(`- Oxygen on (${f.final.o2device}).`);
  if (f.final.wrapped) right.push("- Patient kept warm (wrapped).");
  if (f.final.lineCount > 0) right.push(`- ${f.final.lineCount} line(s) placed.`);
  if (f.final.drugCount > 0) right.push(`- ${f.final.drugCount} drug(s) given.`);
  if (f.final.sweepDone) right.push("- Blood sweep done.");
  if (f.final.sizeupCount >= 5) right.push("- Full size-up (5/5).");
  if (f.radioComplete) right.push("- Radio report complete.");
  s.push(...(right.length > 0 ? right : ["- Nothing tracked was completed - see misses."]));
  s.push("");
  s.push("Misses (not done this run - facts, not grades):");
  const miss: string[] = [];
  if (f.final.beltLeft && f.final.woundPresent) miss.push("- Bystander belt still on the thigh.");
  if (f.final.tqApplied && !f.final.timeWritten) miss.push("- CAT on but time not written.");
  if (f.final.o2device === "none") miss.push("- No oxygen applied.");
  if (!f.final.exposed && f.final.woundPresent) miss.push("- Wound never exposed.");
  if (f.final.lineCount === 0) miss.push("- No IV or IO line.");
  if (f.final.sizeupCount < 5) miss.push(`- Size-up ${f.final.sizeupCount}/5.`);
  if (!f.radioComplete) miss.push("- Radio report incomplete or skipped.");
  if (!f.final.sweepDone) miss.push("- No blood sweep.");
  s.push(...(miss.length > 0 ? miss : ["- None logged - clean run on the tracked items."]));
  s.push("");
  const handsAt = firstHandsAt(f.log);
  s.push(`Time to critical intervention: ${handsAt === null ? "no hemorrhage control started" : `first hands on the bleed at T+${fmtClock(handsAt)}`}.`);
  s.push("");
  s.push("Traps triggered:");
  const traps = f.log.filter((e) => e.kind === "trap" && e.t_s > 0);
  s.push(...(traps.length > 0 ? traps.map((e) => `- T+${fmtClock(e.t_s)} - ${e.text}`) : ["- None."]));
  s.push("");
  s.push("Reassessment notes:");
  const re = f.log.filter((e) => /loosened|re-bleed|reassess|slipped|peek|re-secure/i.test(e.text));
  s.push(...(re.length > 0 ? re.map((e) => `- T+${fmtClock(e.t_s)} - ${e.text}`) : ["- None logged."]));
  s.push("");
  s.push(`Destination (as logged): ${f.destination}. Correctness not graded - no medic rule yet.`);
  s.push(`Radio (as logged): ${f.radioComplete ? `complete report (${f.radioLines} radio log lines)` : "incomplete or skipped"}.`);
  s.push(`Expected pathway: ${f.pathway}`);
  s.push("");
  s.push("Open clinical questions (not settled here): handoff airway bar, 300-second transport skip, L1 deterioration at x0.5, destination rule.");
  s.push(`Final state: T+${fmtClock(f.final.t_s)}, blood lost ${f.final.loss_mL} mL, class ${f.final.atlsClass}, patency ${f.final.patency}.`);
  return s.join("\n");
}

/** Flat facts text for the Spark FTO prompt. */
export function factsToText(f: DebriefFacts): string {
  const s: string[] = [];
  s.push(`Level: ${f.levelLabel}. Destination: ${f.destination}. Outcome: ${f.win ? "win" : "lose"}.`);
  s.push(`Handoff checks: ${f.checks.map((c) => `${c.pass ? "PASS" : "FAIL"} ${c.label}`).join(" | ")}.`);
  s.push(`Expected pathway: ${f.pathway}`);
  s.push(`Radio complete: ${f.radioComplete}.`);
  const fin = f.final;
  s.push(
    `Final: T+${fmtClock(fin.t_s)}, loss ${fin.loss_mL} mL, rate ${fin.rate}/min, class ${fin.atlsClass}, ` +
      `arrested ${fin.arrested}, O2 ${fin.o2device}, wrapped ${fin.wrapped}, lines ${fin.lineCount}, ` +
      `drugs ${fin.drugCount}, TQ applied ${fin.tqApplied}, time written ${fin.timeWritten}, belt left ${fin.beltLeft}, ` +
      `exposed ${fin.exposed}, sweep ${fin.sweepDone}, sizeup ${fin.sizeupCount}/5.`
  );
  s.push("Event log:");
  for (const e of f.log.slice(-60)) {
    s.push(`T+${fmtClock(e.t_s)} [${e.kind}] ${e.text}`);
  }
  return s.join("\n");
}

/** Spark FTO with code-built fallback. Never blank, never a made-up grade. */
export async function fetchDebrief(f: DebriefFacts): Promise<{ text: string; live: boolean }> {
  try {
    const response = await fetch("/api/debrief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ facts: factsToText(f) })
    });
    if (!response.ok) throw new Error(`debrief route ${response.status}`);
    const data = (await response.json()) as { text?: unknown };
    if (typeof data.text !== "string" || data.text.trim() === "") throw new Error("empty debrief");
    return { text: data.text, live: true };
  } catch {
    return { text: buildFallbackDebrief(f), live: false };
  }
}
