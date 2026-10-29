// Shared sim types. The engine owns true state; the UI only reads it.

export type AtlsClass = "I" | "II" | "III" | "IV";
export type ShockFlag = "normal" | "caution" | "shock" | "severe";
export type RadialPulse = "Strong" | "Weak" | "Thready / intermittent" | "Absent";
export type Rhythm = "sinus" | "sinus_tach" | "bradycardic" | "pea";
export type Holder = "player" | "partner" | "bystander";
export type Stash = "belt" | "jump_bag" | "cabinet";

/** Full derived vital set for one tick. Displayed in F1, never invented. */
export interface Vitals {
  hr_bpm: number;
  sbp_mmhg: number;
  dbp_mmhg: number;
  map_mmhg: number;
  rr_per_min: number;
  spo2_pct: number;
  etco2_mmhg: number;
  gcs_total: number;
  gcs_text: string;
  capRefill_s: number;
  capRefill_text: string;
  radial: RadialPulse;
  skin: string;
  mental: string;
  temp_C: number;
  pain_0_to_10: number;
  rhythm: Rhythm;
  shockIndex: number;
  shockFlag: ShockFlag;
  atlsClass: AtlsClass;
  loss_mL: number;
  loss_pct: number;
  pulsePressure_mmhg: number;
  arrested: boolean;
}

export interface LogEvent {
  t_s: number;
  kind:
    | "bleed"
    | "vitals"
    | "action"
    | "trap"
    | "movement"
    | "reassess"
    | "fetch"
    | "class"
    | "arrest"
    | "info";
  text: string;
}

export interface TqState {
  applied: boolean;
  /** Occluded means arterial flow stopped (modulo residual failure). */
  occluded: boolean;
  residualFlow_0_to_1: number;
  placement: "high_thigh" | "knee" | "venous_loose" | "none";
  halfTurns: number;
  timeWritten: boolean;
  appliedAt_s: number;
  /** Second TQ state. */
  secondApplied: boolean;
  secondPlacement: "proximal" | "distal" | "over_wound" | "overlapping" | "none";
  loosened: boolean;
  failedSlack: boolean;
}

export interface PackingState {
  stage: "none" | "packed_pending_hold" | "holding" | "set" | "failed";
  packed: boolean;
  technique: "packed" | "on_top";
  gauze: "hemostatic" | "plain";
  holdRemaining_s: number;
  holdTotal_s: number;
  holder: Holder | null;
  loosened: boolean;
}

export interface PressureState {
  active: boolean;
  quality: "firm" | "light" | "off_source";
  holder: Holder | null;
  held_s: number;
  /** Bystander shirt from scene start, until the spurt trigger. */
  bystanderShirt: boolean;
}

export interface DressingState {
  applied: boolean;
  tightness: "correct" | "loose" | "tight";
  overPacking: boolean;
  soaked: boolean;
  loosened: boolean;
}

export interface FetchJob {
  itemId: string;
  remaining_s: number;
  total_s: number;
  runner: Holder;
}

export interface PendingAction {
  id: string;
  label: string;
  total_s: number;
  remaining_s: number;
}
