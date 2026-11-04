// ACM overlay shared types, implemented from scratch Nov 3. UI-only run
// state for the Arma-style medical menu: selected category, exam memory,
// triage pick, and control values that survive re-renders. Nothing here
// touches the engine; every treatment still calls the same Sim methods.

import type { RegionId } from "../../patient/regions";

/** Eight ACM categories, keys 1-8 while the menu is open. */
export type AcmCategory =
  | "triage"
  | "examine"
  | "bleeding"
  | "airway"
  | "breathing"
  | "meds"
  | "lines"
  | "monitor";

export const ACM_CATEGORIES: { id: AcmCategory; key: string; label: string; glyph: string }[] = [
  { id: "triage", key: "1", label: "Triage card", glyph: "T+" },
  { id: "examine", key: "2", label: "Examine", glyph: "EX" },
  { id: "bleeding", key: "3", label: "Bleeding", glyph: "BL" },
  { id: "airway", key: "4", label: "Airway", glyph: "AW" },
  { id: "breathing", key: "5", label: "Breathing", glyph: "BR" },
  { id: "meds", key: "6", label: "Meds", glyph: "Rx" },
  { id: "lines", key: "7", label: "Lines / Blood", glyph: "IV" },
  { id: "monitor", key: "8", label: "Monitor", glyph: "ECG" }
];

export type TriageLevel = "none" | "minimal" | "delayed" | "immediate" | "deceased";

export const TRIAGE_LEVELS: { id: TriageLevel; label: string }[] = [
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal (green)" },
  { id: "delayed", label: "Delayed (yellow)" },
  { id: "immediate", label: "Immediate (red)" },
  { id: "deceased", label: "Deceased (black)" }
];

/** What the player has found by examining, per region. UI memory only. */
export interface AcmExamState {
  inspected: Set<RegionId>;
  palpated: Set<RegionId>;
  findings: Map<RegionId, string[]>;
}

export function freshExamState(): AcmExamState {
  return { inspected: new Set(), palpated: new Set(), findings: new Map() };
}

/** Per-run ACM state. Fresh on every dispatch accept. */
export interface AcmRunState {
  category: AcmCategory;
  exam: AcmExamState;
  triage: TriageLevel;
  /** Control values keyed by control id, so re-renders keep picks. */
  controls: Map<string, string>;
  /** Expanded action rows, keyed by row id. */
  expanded: Set<string>;
  /** Drug and reference picks for the meds draw-up card. */
  drugId: string;
  refDrug: string;
}

export function freshRunState(): AcmRunState {
  return {
    category: "examine",
    exam: freshExamState(),
    triage: "none",
    controls: new Map(),
    expanded: new Set(),
    drugId: "fentanyl",
    refDrug: ""
  };
}
