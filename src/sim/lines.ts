// Oct 29 lines and fluids: catheter flows, start success math, infiltration
// and the explicit fluid model (NOT tokens). Crystalloid: +1,000 mL
// intravascular now, decaying to about 250 mL retained over 60 min. Blood
// products stay about 90 percent intravascular. All values from
// oct29_lines.json (section 7).

import type { FluidsState, IvSite } from "./types";

/** Gravity flow mL/min crystalloid by gauge (pressure bag x1.75). */
export const IV_GRAVITY_FLOW: Record<number, number> = {
  14: 300,
  16: 200,
  18: 100,
  20: 60,
  22: 35,
  24: 20
};

export const PRESSURE_BAG_X = 1.75;

/** IO flow with a pressure bag, rolled once at placement (seeded). */
export const IO_FLOW = {
  humeral: [80, 150] as const,
  tibial: [30, 80] as const,
  gravity: 10
};

export interface IvAttemptInput {
  shock: boolean;
  darkOrRain: boolean;
  largeGaugeSmallVein: boolean;
}

/** First-attempt success probability 0-1 after modifiers. */
export function ivSuccessP(input: IvAttemptInput): number {
  let p = 0.75;
  if (input.shock) p -= 0.3;
  if (input.darkOrRain) p -= 0.1;
  if (input.largeGaugeSmallVein) p -= 0.1;
  return Math.max(0.05, p);
}

/** Large gauge in a small vein (TUNE): 14/16g in a hand vein. */
export function isLargeGaugeSmallVein(gauge: number, site: IvSite): boolean {
  return site === "hand" && (gauge === 14 || gauge === 16);
}

/** IO needle fit for Josh. Wrong needle fails deterministically, no guessing. */
export function ioNeedleOk(site: "tibial" | "humeral", needle_mm: number): boolean {
  if (site === "tibial") return needle_mm === 25;
  return needle_mm === 45;
}

/** Crystalloid retained fraction at age t (minutes): 250 + 750 x e^(-kt). */
export function crystalloidRetainedFraction(age_min: number): number {
  const k = 0.077;
  return 0.25 + 0.75 * Math.exp(-k * Math.max(0, age_min));
}

/** Total retained crystalloid mL across completed bags at now_s. */
export function crystalloidRetained_mL(state: FluidsState, now_s: number): number {
  let total = 0;
  for (const bag of state.crystalloidBags) {
    total += bag.mL * crystalloidRetainedFraction((now_s - bag.t_s) / 60);
  }
  // Bags still running count at full infused volume (age about zero).
  for (const line of state.lines) {
    if (line.bag !== null && line.bag.fluid !== "blood") {
      total += line.bag.volumeTotal_mL - line.bag.volumeLeft_mL;
    }
  }
  return total;
}

/** Total retained fluid mL: crystalloid decay sum + blood at 90 percent. */
export function retainedFluids_mL(state: FluidsState, now_s: number): number {
  return crystalloidRetained_mL(state, now_s) + state.bloodRetained_mL;
}

export function freshFluids(): FluidsState {
  return { lines: [], nextLineId: 1, crystalloidBags: [], bloodRetained_mL: 0 };
}
