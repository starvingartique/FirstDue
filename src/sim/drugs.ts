// Oct 29 minimal drug prep loop. Reads drugs.json as-is (never edited) plus
// the physiology.json effect-token map. Strict no-guess rules:
//
// Standard dose = the FIRST dosing entry, and only when it carries a single
// numeric mass dose (dose_mg, dose_mcg, dose_g, dose_mg_per_kg or
// dose_mcg_per_kg). String ranges ("2-4") are not a standard dose: picking a
// number from a range would be guessing, so those drugs stay unusable.
//
// Token mapping = effects entries on the 8 mapped keys whose value is a bare
// token (+/++/+++, -/--/---) with at most a plain parenthetical note.
// Conditionals ("if opioid", "in adrenal crisis only"), alternatives ("-/0",
// "+ to +++") and prose ("dissociated...") are skipped, not guessed. A drug
// with no parseable mapped token stays unusable. RR "arrow to 0" means apnea.
//
// At push time the loop computes ratio = given / standard. Token effects apply
// at peak, scaled linearly by min(ratio, 2). Above 2x the dangers[] strings
// from drugs.json are applied as toxicity flags (logged + flagged, no invented
// vitals change). Doses stack: each push is its own curve.

import { loadDrugs, loadPhysiology } from "../data/loaders";
import type { Drug, DrugDosing, DrugPresentation } from "../data/types";
import type { DrugTokens } from "./types";

/** Engine weight for weight-based doses. Never shown in UI. */
export const ENGINE_WEIGHT_KG = 80;

const MAPPED_KEYS = [
  "heartRate",
  "sbp",
  "respRate",
  "spo2",
  "gcs",
  "painScore",
  "glucose",
  "bronchodilation"
] as const;

export type MappedKey = (typeof MAPPED_KEYS)[number];

/** A token string parsed from an effects value, or null when unparseable. */
export function parseToken(value: string): string | null {
  // RR arrow-to-0 spellings all mean apnea per the token map.
  if (value === "ARROW 0" || value === "ARROW 0 (apnea)") return "APNEA";
  const match = /^(\+\+\+|\+\+|\+|---|--|-)( \(([^)]*)\))?$/.exec(value);
  if (match === null) return null;
  const note = (match[3] ?? "").toLowerCase();
  // Conditional or exclusive notes need a clinical judgment call: skip.
  if (note.includes("if ") || note.includes("only")) return null;
  return match[1] ?? null;
}

/** Token string to effect-table steps: +1/+2/+3 or -1/-2/-3. APNEA = 9. */
export function tokenSteps(token: string): number {
  switch (token) {
    case "+++":
      return 3;
    case "++":
      return 2;
    case "+":
      return 1;
    case "---":
      return -3;
    case "--":
      return -2;
    case "-":
      return -1;
    case "APNEA":
      return 9;
    default:
      return 0;
  }
}

// Token magnitudes from physiology.json effectTokens (TUNE-tagged there).
const TOKEN_TABLE: Record<string, [number, number, number]> = {
  heartRate: [10, 25, 40],
  sbp: [10, 25, 45],
  respRate: [3, 7, 12],
  spo2: [2, 5, 10],
  gcs: [1, 3, 6],
  painScore: [-2, -4, -6],
  glucose: [25, 60, 110],
  bronchodilation: [0.15, 0.35, 0.6]
};

/** Steps (+/-1..3) to effect units at 1x standard dose. */
export function tokenToUnits(key: MappedKey, steps: number): number {
  const row = TOKEN_TABLE[key];
  if (row === undefined || steps === 0 || steps === 9) return 0;
  const mag = row[Math.min(3, Math.abs(steps)) - 1] ?? 0;
  // Pain rows are already negative; HR/SBP/RR/SpO2/GCS/glucose/broncho mirror.
  if (key === "painScore") return steps < 0 ? mag : -mag;
  return steps < 0 ? -mag : mag;
}

export interface StandardDose {
  /** Mass in mcg at 1x for an 80 kg adult. */
  mcg: number;
  unit: string;
  route: string;
  indication: string;
}

/**
 * Standard dose from the FIRST dosing entry. Returns null when the entry has
 * no single numeric mass dose (range strings, volume doses, infusions and
 * device doses are not standard doses for the push loop).
 */
export function standardDose(dosing: DrugDosing[]): StandardDose | null {
  const first = dosing[0];
  if (first === undefined) return null;
  const route = first.route?.[0] ?? "IV";
  const indication = first.indication;
  if (typeof first.dose_mg === "number") {
    return { mcg: first.dose_mg * 1000, unit: "mg", route, indication };
  }
  if (typeof first.dose_mcg === "number") {
    return { mcg: first.dose_mcg, unit: "mcg", route, indication };
  }
  if (typeof first.dose_g === "number") {
    return { mcg: first.dose_g * 1000000, unit: "g", route, indication };
  }
  if (typeof first.dose_mg_per_kg === "number") {
    return { mcg: first.dose_mg_per_kg * ENGINE_WEIGHT_KG * 1000, unit: "mg/kg", route, indication };
  }
  if (typeof first.dose_mcg_per_kg === "number") {
    return { mcg: first.dose_mcg_per_kg * ENGINE_WEIGHT_KG, unit: "mcg/kg", route, indication };
  }
  return null;
}

export interface PrepMath {
  /** How the player measures this presentation: mL drawn or units counted. */
  kind: "ml" | "units";
  /** mcg per mL or per unit. */
  mcgPer: number;
  unitLabel: string;
  maxUnits: number | null;
}

/**
 * Dose math for one presentation. Returns null when the presentation carries
 * no computable concentration (nothing to multiply mL by).
 */
export function presentationMath(p: DrugPresentation): PrepMath | null {
  if (typeof p.mg_per_mL === "number") {
    return { kind: "ml", mcgPer: p.mg_per_mL * 1000, unitLabel: "mL", maxUnits: p.volume_mL ?? null };
  }
  if (typeof p.mcg_per_mL === "number") {
    return { kind: "ml", mcgPer: p.mcg_per_mL, unitLabel: "mL", maxUnits: p.volume_mL ?? null };
  }
  if (typeof p.g_per_mL === "number") {
    return { kind: "ml", mcgPer: p.g_per_mL * 1000000, unitLabel: "mL", maxUnits: p.volume_mL ?? null };
  }
  if (typeof p.mg_per_tab === "number") {
    return { kind: "units", mcgPer: p.mg_per_tab * 1000, unitLabel: "tab", maxUnits: null };
  }
  if (typeof p.mg_per_dose === "number") {
    return { kind: "units", mcgPer: p.mg_per_dose * 1000, unitLabel: "spray", maxUnits: null };
  }
  if (typeof p.fixedDose_mg === "number") {
    return { kind: "units", mcgPer: p.fixedDose_mg * 1000, unitLabel: "unit", maxUnits: 1 };
  }
  if (typeof p.fixedDose_mcg === "number") {
    return { kind: "units", mcgPer: p.fixedDose_mcg, unitLabel: "unit", maxUnits: 1 };
  }
  if (typeof p.fixedDose_g === "number") {
    return { kind: "units", mcgPer: p.fixedDose_g * 1000000, unitLabel: "unit", maxUnits: 1 };
  }
  return null;
}

/** Parseable mapped tokens for one drug (empty = no token mapping). */
export function drugTokens(drug: Drug): DrugTokens {
  const out: DrugTokens = {};
  const effects = drug.effects ?? {};
  for (const key of MAPPED_KEYS) {
    const raw = effects[key];
    if (typeof raw !== "string") continue;
    // Normalize the literal arrow char to an ASCII marker before parsing.
    const normalized = raw.replaceAll("\u2192", "ARROW");
    const token = parseToken(normalized.trim());
    if (token === null) continue;
    if (token === "APNEA") {
      if (key === "respRate") out.apnea = true;
      continue;
    }
    const units = tokenToUnits(key, tokenSteps(token));
    if (units === 0) continue;
    if (key === "heartRate") out.hr_bpm = units;
    else if (key === "sbp") out.sbp_mmhg = units;
    else if (key === "respRate") out.rr_per_min = units;
    else if (key === "spo2") out.spo2_pct = units;
    else if (key === "gcs") out.gcs_points = units;
    else if (key === "painScore") out.pain_0_to_10 = units;
    else if (key === "glucose") out.glucose_mg_per_dL = units;
    else if (key === "bronchodilation") out.broncho_0_to_1 = units;
  }
  return out;
}

/** PK [onset, peak, duration] seconds for the standard route, if present. */
export function pkForRoute(drug: Drug, route: string): [number, number, number] | null {
  const pk = drug.pk_s ?? {};
  const want = route.toUpperCase();
  for (const [key, value] of Object.entries(pk)) {
    if (want.startsWith(key.toUpperCase()) && Array.isArray(value) && value.length === 3) {
      const [onset, peak, duration] = value as [number, number, number];
      if (
        typeof onset === "number" &&
        typeof peak === "number" &&
        typeof duration === "number" &&
        duration > 0
      ) {
        return [onset, peak, duration];
      }
    }
  }
  return null;
}

export interface UsableDrug {
  drug: Drug;
  standard: StandardDose;
  tokens: DrugTokens;
  pk_s: [number, number, number];
  /** Presentations with computable dose math. */
  presentations: { index: number; math: PrepMath }[];
}

export interface DrugCatalog {
  usable: UsableDrug[];
  noDose: string[];
  noMapping: string[];
}

let cached: DrugCatalog | null = null;

/** Full 104-drug sort into usable / no-dose / no-mapping. Deterministic. */
export function drugCatalog(): DrugCatalog {
  if (cached !== null) return cached;
  // Touch the token map so a missing table fails loudly at boot.
  void loadPhysiology();
  const file = loadDrugs();
  const usable: UsableDrug[] = [];
  const noDose: string[] = [];
  const noMapping: string[] = [];
  for (const drug of file.drugs) {
    const standard = standardDose(drug.dosing);
    if (standard === null) {
      noDose.push(drug.id);
      continue;
    }
    const tokens = drugTokens(drug);
    const hasToken = Object.keys(tokens).length > 0;
    if (!hasToken) {
      noMapping.push(drug.id);
      continue;
    }
    const pk = pkForRoute(drug, standard.route);
    if (pk === null) {
      noMapping.push(drug.id);
      continue;
    }
    const presentations: { index: number; math: PrepMath }[] = [];
    drug.presentations.forEach((p, index) => {
      const math = presentationMath(p);
      if (math !== null) presentations.push({ index, math });
    });
    if (presentations.length === 0) {
      noMapping.push(drug.id);
      continue;
    }
    usable.push({ drug, standard, tokens, pk_s: pk, presentations });
  }
  usable.sort((a, b) => a.drug.name.localeCompare(b.drug.name));
  cached = { usable, noDose, noMapping };
  return cached;
}

/**
 * Effect factor 0-1 at time t: linear ramp onset->peak, linear decay
 * peak->peak+duration. Doses stack: each push runs its own curve.
 */
export function effectFactor(givenAt_s: number, onset_s: number, peak_s: number, duration_s: number, now_s: number): number {
  const t = now_s - givenAt_s;
  if (t < onset_s) return 0;
  if (t < peak_s) {
    if (peak_s <= onset_s) return 1;
    return (t - onset_s) / (peak_s - onset_s);
  }
  const end = peak_s + duration_s;
  if (t >= end) return 0;
  return 1 - (t - peak_s) / duration_s;
}

/** Human dose string for the menu: standard at 1x in sensible units. */
export function formatDose(mcg: number): string {
  if (mcg >= 1000000 && mcg % 1000000 === 0) return `${mcg / 1000000} g`;
  if (mcg >= 1000000) return `${(mcg / 1000000).toFixed(2)} g`;
  if (mcg >= 1000 && mcg % 1000 === 0) return `${mcg / 1000} mg`;
  if (mcg >= 1000) return `${(mcg / 1000).toFixed(1)} mg`;
  return `${Math.round(mcg * 100) / 100} mcg`;
}
