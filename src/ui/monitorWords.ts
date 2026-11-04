// Monitor display words, implemented from scratch Nov 3. Pure string
// helpers over engine state for the pulse ox pill and the defib/monitor
// view. Display only: no rhythm is added, no treatment is added. PEA reads
// as a rhythm with no pulse, never a normal pulse and never a blank.

import type { Sim } from "../sim/engine";
import type { Rhythm } from "../sim/types";
import { pulsePointForSbp } from "../sim/exams";

/** Engine rhythm to monitor words. Authored Medical; worded at render. */
export function rhythmWords(rhythm: Rhythm): string {
  if (rhythm === "pea") return "PEA: organized rhythm, NO pulse";
  if (rhythm === "bradycardic") return "bradycardic rhythm";
  if (rhythm === "sinus_tach") return "sinus tach";
  return "sinus rhythm";
}

/** Pulse presence in monitor words, from the engine SBP. */
export function pulseWords(sim: Sim): string {
  if (sim.vitals.rhythm === "pea" || sim.arrested) return "no pulse";
  const point = pulsePointForSbp(sim.vitals.sbp_mmhg);
  return point === "none" ? "no pulse palpable" : `${point} pulse palpable`;
}

/** Defib/monitor line for the Monitor tab. Shown while pads are on. */
export function defibMonitorLine(sim: Sim): string {
  if (sim.vitals.rhythm === "pea" || sim.arrested) {
    return "Defib monitor: PEA - organized rhythm, NO pulse.";
  }
  return `Defib monitor: ${rhythmWords(sim.vitals.rhythm)}, ${pulseWords(sim)}.`;
}

/**
 * Persistent vitals pill text. Shows while the pulse ox probe or defib pads
 * are on: pleth HR plus the lagged monitor SpO2, engine numbers only. Null
 * hides the pill. PEA reads as rhythm with no pulse. No new vital here.
 */
export function vitalsPillText(s: Sim): string | null {
  if (!s.monitor.spo2Attached && !s.defibPadsOn) return null;
  const spo2 = s.monitorSpo2();
  const spo2Text = spo2 === null ? "--" : "none" in spo2 ? "no pleth" : `${spo2.value}`;
  if (s.vitals.rhythm === "pea" || s.arrested) {
    return `PEA rhythm - NO PULSE - SpO2 ${spo2Text}`;
  }
  return `HR ${s.vitals.hr_bpm} - SpO2 ${spo2Text}`;
}
