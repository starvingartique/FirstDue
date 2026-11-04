// ACM display formatters, implemented from scratch Nov 3. Pure helpers:
// clocks, stock chips, done-times, pain words, and the ACE bleed/damage
// color scales. Display buckets only; no engine value changes here. The
// bleed tiers bucket the same mL/min rate the 3D wound pulse already
// uses, with the same 30 mL/min visible cut. No numbers reach the UI.

import type { Sim } from "../../sim/engine";
import type { LogEvent } from "../../sim/types";

/** T+mm:ss clock for the overlay header, log, and bands. */
export function fmtClockT(t_s: number): string {
  return `T+${String(Math.floor(t_s / 60)).padStart(2, "0")}:${String(t_s % 60).padStart(2, "0")}`;
}

/** Compact m:ss for TQ bands ("0:51"). */
export function fmtBandTime(t_s: number): string {
  return `${Math.floor(t_s / 60)}:${String(t_s % 60).padStart(2, "0")}`;
}

/** Stock chip: "x2 bag / x4 truck". Bag is at the patient, truck is cabinet. */
export function stockLabel(sim: Sim, itemId: string): { text: string; empty: boolean } {
  const bag = sim.atPatient(itemId);
  const truck = sim.cabinetLeft(itemId);
  return { text: `x${bag} bag / x${truck} truck`, empty: bag === 0 };
}

/** Last "Done: ..." time whose label contains the needle, or null. */
export function lastDoneTime(log: LogEvent[], needle: string): number | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i];
    if (event !== undefined && event.text.startsWith("Done: ") && event.text.includes(needle)) {
      return event.t_s;
    }
  }
  return null;
}

/** Pain 0-10 to words. Shown only when the player asked (chat gate). */
export function painWords(pain_0_to_10: number): string {
  if (pain_0_to_10 <= 0) return "no pain";
  if (pain_0_to_10 <= 3) return "mild pain";
  if (pain_0_to_10 <= 6) return "moderate pain";
  if (pain_0_to_10 <= 8) return "severe pain";
  return "worst pain";
}

/** Measured pulse rate to words for the assessment modal. */
export function pulseRateWords(hr: number): string {
  if (hr <= 0) return "no pulse";
  if (hr < 60) return "slow";
  if (hr <= 100) return "steady";
  if (hr <= 140) return "fast";
  return "very fast";
}

export type BleedTier = "none" | "slow" | "moderate" | "severe" | "massive";

/**
 * Display tier for a bleed rate. The 30 mL/min visible cut matches the 3D
 * wound pulse; the four tiers above it are display buckets only.
 */
export function bleedTierForRate(rate_mL_per_min: number): BleedTier {
  if (rate_mL_per_min < 30) return "none";
  if (rate_mL_per_min < 150) return "slow";
  if (rate_mL_per_min < 400) return "moderate";
  if (rate_mL_per_min < 700) return "severe";
  return "massive";
}

/** Tier to the overview bleeding line, words only. */
export function bleedLineForTier(tier: BleedTier): { text: string; cls: string } {
  if (tier === "massive") return { text: "Massive bleeding", cls: "acm-bleed-massive" };
  if (tier === "severe") return { text: "Severe bleeding", cls: "acm-bleed-severe" };
  if (tier === "moderate") return { text: "Moderate bleeding", cls: "acm-bleed-moderate" };
  if (tier === "slow") return { text: "Slow bleeding", cls: "acm-bleed-slow" };
  return { text: "No bleeding", cls: "acm-dim" };
}

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mix = pa.map((v, i) => Math.round(v + ((pb[i] ?? v) - v) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * ACE blood-loss scale, 10 steps white -> yellow -> red. Step 0 is the
 * dark unmarked base, not white: white steps only paint bleeding regions.
 */
export function bloodStepColor(step: number): string {
  const s = Math.min(10, Math.max(0, Math.round(step)));
  if (s === 0) return "#232c3d";
  if (s <= 5) return lerpHex("#ffffff", "#ffff00", s / 5);
  return lerpHex("#ffff00", "#ff0000", (s - 5) / 5);
}

/** ACE damage scale, 10 steps white -> cyan -> blue. Step 0 is the base. */
export function damageStepColor(step: number): string {
  const s = Math.min(10, Math.max(0, Math.round(step)));
  if (s === 0) return "#232c3d";
  if (s <= 5) return lerpHex("#ffffff", "#00ffff", s / 5);
  return lerpHex("#00ffff", "#0000ff", (s - 5) / 5);
}

/** Bleed tier to blood-scale step. */
export function bloodStepForTier(tier: BleedTier): number {
  if (tier === "slow") return 3;
  if (tier === "moderate") return 5;
  if (tier === "severe") return 8;
  if (tier === "massive") return 10;
  return 0;
}
