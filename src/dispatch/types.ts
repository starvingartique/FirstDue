// Dispatch Engine v1 shapes. The skeleton is code-drawn IDs only (never LLM).
// The fleshed call is the skeleton plus Muse narrative, assembled server-side
// into the same FixedCall shape the Oct 30 flow already renders.

import type { FixedCall } from "../data/types";

export interface SkeletonPatient {
  age: number;
  sex: "M" | "F";
  weight_kg: number;
}

export interface SkeletonComplication {
  id: string;
  onset_s: number;
}

export interface CallSkeleton {
  version: "dispatch-v1";
  seed: number;
  level: 1 | 2;
  complaintId: string;
  mechanismId: string;
  subtypeId: string;
  conditionIds: string[];
  patient: SkeletonPatient;
  comorbidityIds: string[];
  homeMeds: string[];
  environmentId: string;
  timeOfDay: string;
  weather: string;
  bystanderId: string | null;
  complication: SkeletonComplication | null;
}

/** Strict LLM output: narrative only, no clinical numbers, IDs echoed. */
export interface LlmFlesh {
  dispatch: {
    nature: string;
    address: string;
    cadText: string;
    updates: string[];
  };
  scene: {
    description: string;
  };
  patient: {
    name: string;
  };
  persona: string;
  historyCard: HistoryCard;
  bystander: {
    label: string;
    lines: string[];
  };
  expectedPathway: string;
}

export interface HistoryCard {
  SAMPLE: {
    signs_symptoms: string;
    allergies: string;
    medications: string;
    past_history: string;
    last_meal: string;
    events: string;
  };
  OPQRST: {
    onset: string;
    provokes: string;
    quality: string;
    radiates: string;
    severity_words: string;
    time: string;
  };
  secrets: Array<{ fact: string; revealWhen: string }>;
}

/**
 * A generated call in the Oct 30 FixedCall shape, so dispatch, size-up, HUD,
 * package, transport, radio and the run report render it unchanged. The extra
 * keys carry the skeleton, the persona, the hidden history card, bystander
 * lines and the FTO-only expected pathway.
 */
export interface FleshedCall extends FixedCall {
  skeleton: CallSkeleton;
  persona: string;
  historyCard: HistoryCard;
  bystanderLines: string[];
  expectedPathway: string;
  complication: SkeletonComplication | null;
}
