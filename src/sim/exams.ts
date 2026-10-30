// Oct 29 manual vitals (L2): error and artifact math from section 7. Each
// function takes the TRUE engine value plus the artifact inputs and returns
// what the player observes. Pure and seeded where chance applies, so the
// headless tests can verify every listed error without running the UI.

import type { Rng } from "./rng";

/** Pulse point available at this SBP (engine rule only, heuristic). */
export function pulsePointForSbp(sbp_mmhg: number): "radial" | "femoral" | "carotid" | "none" {
  if (sbp_mmhg >= 80) return "radial";
  if (sbp_mmhg >= 70) return "femoral";
  if (sbp_mmhg >= 60) return "carotid";
  return "none";
}

/** 30 s x 2 count returns an even number. */
export function pulseRead(true_hr: number): number {
  return Math.round(true_hr / 2) * 2;
}

/** RR read: +4 when the patient knows they are watched (Talk used recently). */
export function rrRead(true_rr: number, patientAware: boolean): number {
  return true_rr + (patientAware ? 4 : 0);
}

export type CuffFit = "correct" | "small" | "big";

/**
 * Auscultated BP read. Cuff too small reads HIGH +10-30, too big LOW -5-10.
 * Deflating too fast misses SBP (+/-10). Roadside is inaudible.
 */
export function bpAuscultatedRead(
  rng: Rng,
  true_sbp: number,
  true_dbp: number,
  cuff: CuffFit,
  deflateFast: boolean,
  roadside: boolean
): { sbp: number; dbp: number; note: string } | { inaudible: true } {
  if (roadside) return { inaudible: true };
  let sbp = true_sbp;
  let dbp = true_dbp;
  let note = "Korotkoff sounds clear.";
  if (cuff === "small") {
    const err = Math.round(rng.range(10, 31));
    sbp += err;
    dbp += Math.round(err / 2);
    note = `Cuff too small: reads HIGH (+${err} systolic).`;
  } else if (cuff === "big") {
    const err = Math.round(rng.range(5, 11));
    sbp -= err;
    dbp -= Math.round(err / 2);
    note = `Cuff too big: reads LOW (-${err} systolic).`;
  }
  if (deflateFast) {
    const miss = rng.chance(0.5) ? 10 : -10;
    sbp += miss;
    note += ` Deflated too fast: missed SBP (${miss > 0 ? "+" : ""}${miss}).`;
  }
  return { sbp: Math.max(0, sbp), dbp: Math.max(0, dbp), note };
}

/** Palpated BP: SBP only, reads about 10 low. */
export function bpPalpatedRead(true_sbp: number): number {
  return Math.max(0, true_sbp - 10);
}

/** NIBP: fails with motion, very low BP (reads ---), irregular rhythm. */
export function nibpRead(
  true_sbp: number,
  true_dbp: number,
  motion: boolean,
  irregular: boolean
): { sbp: number; dbp: number } | { failed: string } {
  if (motion) return { failed: "Motion artifact: cycle aborted." };
  if (irregular) return { failed: "Irregular rhythm: NIBP cannot resolve." };
  if (true_sbp < 60) return { failed: "--- (pressure too low to resolve)." };
  return { sbp: true_sbp, dbp: true_dbp };
}

/** SpO2 read: shock/cold = none or falsely low, else the lagged value. */
export function spo2Read(
  rng: Rng,
  lagged_spo2: number,
  unreliable: boolean
): { value: number; note: string } | { none: string } {
  if (unreliable) {
    if (rng.chance(0.5)) return { none: "No pleth: shock / cold fingers." };
    const low = Math.max(0, lagged_spo2 - Math.round(rng.range(3, 9)));
    return { value: low, note: "Weak pleth: falsely low in shock / cold." };
  }
  return { value: lagged_spo2, note: "Good pleth." };
}

/** Cap refill: night roadside cold adds +1-2 s. */
export function capRefillRead(rng: Rng, true_s: number, coldScene: boolean): number {
  const add = coldScene ? rng.range(1, 2.99) : 0;
  return Math.round((true_s + add) * 10) / 10;
}

/** Glucose: +/-15 percent. Shock makes fingertip readings unreliable. */
export function glucoseRead(rng: Rng, true_mg: number, shock: boolean): { value: number; note: string } {
  const err = 1 + rng.range(-0.15, 0.15);
  return {
    value: Math.round(true_mg * err),
    note: shock ? "Fingertip unreliable in shock: treat with suspicion." : "Meter read."
  };
}

/** Temp: temporal reads low in cold or sweaty skin (TUNE magnitude). */
export function tempRead(
  rng: Rng,
  true_C: number,
  method: "tympanic" | "oral" | "temporal",
  coldOrSweaty: boolean
): { value: number; note: string } {
  if (method === "temporal" && coldOrSweaty) {
    const low = rng.range(0.5, 1.0);
    return {
      value: Math.round((true_C - low) * 10) / 10,
      note: "Temporal reads low on cold / sweaty skin."
    };
  }
  return { value: Math.round(true_C * 10) / 10, note: `${method} read.` };
}
