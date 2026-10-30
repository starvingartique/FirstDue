// Oct 29 airway and breathing: sizing tables, FiO2 math and tank math from
// OCT28_MEDICAL_ANSWERS section 7. Josh's correct sizes are data (see
// oct29_airway.json); this module only evaluates a player choice against them.
// All size judgments are pure functions so the headless tests can call them.

import type { AirwayState, BvmState, EttPlacement, O2Device, O2State } from "./types";

export const JOSH_OPA_CORRECT = 100;
export const JOSH_OPA_ACCEPTABLE = [90, 100];
export const JOSH_NPA_CORRECT = [30, 32];
export const JOSH_IGEL = 4;
export const JOSH_KING = 4;
export const JOSH_ETT = [7.5, 8.0];
export const JOSH_ETT_DEPTH_CM = [22, 23];
export const JOSH_BVM_MASK = "large";

export type Fit = "correct" | "small" | "big";

export function fitOpa(size_mm: number): Fit {
  if (JOSH_OPA_ACCEPTABLE.includes(size_mm)) return "correct";
  return size_mm < 90 ? "small" : "big";
}

export function fitNpa(size_fr: number): Fit {
  if (JOSH_NPA_CORRECT.includes(size_fr)) return "correct";
  return size_fr < 30 ? "small" : "big";
}

export function fitSupraglottic(size: number, correct: number): Fit {
  if (size === correct) return "correct";
  return size < correct ? "small" : "big";
}

export function fitEtt(size_mm: number): Fit {
  if (JOSH_ETT.includes(size_mm)) return "correct";
  return size_mm < 7.5 ? "small" : "big";
}

export function fitMask(size: string): Fit {
  if (size === JOSH_BVM_MASK) return "correct";
  // Small and medium both leak on Josh. Medium is closer but still wrong.
  return "small";
}

/** ETT placement from depth. Blind attempts go esophageal (game control). */
export function ettPlacementFor(depth_cm: number, blind: boolean): EttPlacement {
  if (blind) return "esophageal";
  if (depth_cm > 23) return "mainstem";
  return "tracheal";
}

/** Delivered FiO2 0.21-1.0. NRB with a deflated reservoir rebreathes: 0.21. */
export function fio2For(device: O2Device, flow_L_per_min: number, reservoirInflated: boolean): number {
  switch (device) {
    case "nasal_cannula":
      return 0.2 + 0.04 * Math.min(6, Math.max(1, flow_L_per_min));
    case "simple_mask": {
      const t = (Math.min(10, Math.max(6, flow_L_per_min)) - 6) / 4;
      return 0.35 + t * (0.6 - 0.35);
    }
    case "non_rebreather": {
      if (!reservoirInflated) return 0.21;
      const t = (Math.min(15, Math.max(10, flow_L_per_min)) - 10) / 5;
      return 0.6 + t * (0.9 - 0.6);
    }
    case "bvm_reservoir":
      return 0.95;
    case "cpap":
      // FiO2 is set on the device; the engine reads o2.cpap_fio2 instead.
      return 0.21;
    case "none":
    default:
      return 0.21;
  }
}

/** Tank minutes left: (psi - 200) x factor / L per min. */
export function tankMinutesLeft(psi: number, factor: number, lpm: number): number {
  if (lpm <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, ((psi - 200) * factor) / lpm);
}

/** PSI burned per sim-second at this flow. */
export function tankPsiPerSecond(factor: number, lpm: number): number {
  if (lpm <= 0) return 0;
  return lpm / factor / 60;
}

/** Drip math for the Lines tab: gtt/min = mL/h x drop factor / 60. */
export function gttPerMin(mL_per_h: number, dropFactor: number): number {
  return (mL_per_h * dropFactor) / 60;
}

export function freshAirway(): AirwayState {
  return {
    patency_0_to_1: 1,
    gagIntact: true,
    adjunct: null,
    ett: null,
    vomited: false,
    soiled: false,
    aspirated: false,
    epistaxis: false,
    gastricAir: false,
    esophageal_s: 0,
    esophagealRecognized: false,
    mainstem_s: 0,
    suctionDip_pct: 0,
    dislodged: false
  };
}

export function freshO2(): O2State {
  return {
    device: "none",
    flow_L_per_min: 0,
    reservoirInflated: false,
    cpap_cmH2O: 0,
    cpap_fio2: 0.5,
    tankPsi: 2000,
    tankFactor: 0.16,
    tankEmptyWarned: false
  };
}

export function freshBvm(): BvmState {
  return { maskSize: "large", breaths: [], gastric_0_to_10: 0, overventBreaths: 0 };
}

/** Breaths in the trailing 60 s window. */
export function bvmRatePerMin(bvm: BvmState, now_s: number): number {
  return bvm.breaths.filter((b) => now_s - b.t_s < 60).length;
}

/** Mask + device leak multiplier on a BVM breath (1 = full delivery). */
export function bvmDeliveryFactor(maskSize: string, adjunct: AirwayState["adjunct"]): number {
  let factor = maskSize === JOSH_BVM_MASK ? 1 : 0.5;
  if (adjunct !== null) {
    if (adjunct.kind === "igel" && adjunct.fit !== "correct") factor *= 0.6;
    if (adjunct.kind === "kinglt" && adjunct.fit !== "correct") factor *= 0.6;
  }
  return factor;
}
