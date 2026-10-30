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
  /** Oct 29: drug-modified glucose (baseline 95). */
  glucose_mg_per_dL: number;
  /** Oct 29: delivered FiO2 0.21-1.0 from the O2 device and tank. */
  fio2_0_to_1: number;
  /** Oct 29: waveform EtCO2 present (the only reliable ETT check). */
  etco2Waveform: boolean;
  /** Oct 29: airway patency 0-1. */
  airwayPatency_0_to_1: number;
  /** Oct 29: circulating volume = blood volume - loss + retained fluids. */
  circulating_mL: number;
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
    | "airway"
    | "fluid"
    | "drug"
    | "exam"
    | "talk"
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
  secondPlacement: "proximal" | "distal" | "over_wound" | "overlapping" | "loose" | "none";
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

// - Oct 29 airway and breathing -

export type O2Device =
  | "none"
  | "nasal_cannula"
  | "simple_mask"
  | "non_rebreather"
  | "bvm_reservoir"
  | "cpap";

export type EttPlacement = "tracheal" | "mainstem" | "esophageal";

export interface AirwayAdjunct {
  kind: "opa" | "npa" | "igel" | "kinglt";
  size: string;
  fit: "correct" | "small" | "big";
}

export interface EttState {
  size_mm: number;
  depth_cm: number;
  placement: EttPlacement;
  secured: boolean;
  cuff_cmH2O: number;
  cuffLeak: boolean;
  willNotPass: boolean;
}

export interface AirwayState {
  /** 1 = fully patent. Wrong-size adjuncts and soiling reduce it. */
  patency_0_to_1: number;
  gagIntact: boolean;
  adjunct: AirwayAdjunct | null;
  ett: EttState | null;
  vomited: boolean;
  soiled: boolean;
  aspirated: boolean;
  epistaxis: boolean;
  gastricAir: boolean;
  /** Esophageal ETT clock: SpO2 falls 2 percent per 10 s unrecognized. */
  esophageal_s: number;
  esophagealRecognized: boolean;
  /** Mainstem clock: SpO2 falls 1 percent per 10 s (TUNE, no rate in data). */
  mainstem_s: number;
  /** Suction dip: transient SpO2 cost, recovers over 60 s. */
  suctionDip_pct: number;
  dislodged: boolean;
}

export interface O2State {
  device: O2Device;
  flow_L_per_min: number;
  reservoirInflated: boolean;
  cpap_cmH2O: number;
  cpap_fio2: number;
  tankPsi: number;
  tankFactor: number;
  tankEmptyWarned: boolean;
}

export interface BvmState {
  maskSize: "small" | "medium" | "large";
  /** Trailing breath log for rate math: { t_s, volume_mL }. */
  breaths: { t_s: number; volume_mL: number }[];
  gastric_0_to_10: number;
  overventBreaths: number;
}

// - Oct 29 lines and fluids -

export type LineKind = "iv" | "io";
export type IvSite = "ac" | "forearm" | "hand";
export type IoSite = "tibial" | "humeral";
export type FluidKind = "ns" | "lr" | "blood";

export interface FluidBag {
  fluid: FluidKind;
  volumeTotal_mL: number;
  volumeLeft_mL: number;
  drip: string;
}

export interface LineState {
  id: number;
  kind: LineKind;
  site: string;
  gauge?: number;
  needle_mm?: number;
  patent: boolean;
  infiltrated: boolean;
  placedAt_s: number;
  pressureBag: boolean;
  /** Rolled once at placement from the data range (seeded, logged). */
  flow_mL_per_min: number;
  bag: FluidBag | null;
  infused_mL: number;
  ioLidoGiven: boolean;
}

export interface FluidsState {
  lines: LineState[];
  nextLineId: number;
  /** Completed crystalloid bags for the decay sum: { t_s, mL }. */
  crystalloidBags: { t_s: number; mL: number }[];
  bloodRetained_mL: number;
}

// - Oct 29 drugs (minimal prep loop) -

export interface DrugTokens {
  hr_bpm?: number;
  sbp_mmhg?: number;
  rr_per_min?: number;
  spo2_pct?: number;
  gcs_points?: number;
  pain_0_to_10?: number;
  glucose_mg_per_dL?: number;
  broncho_0_to_1?: number;
  apnea?: boolean;
}

export interface ActiveDrug {
  drugId: string;
  givenAt_s: number;
  ratio_to_standard: number;
  route: string;
  onset_s: number;
  peak_s: number;
  duration_s: number;
  tokens: DrugTokens;
  toxic: boolean;
}

export interface DrugsState {
  active: ActiveDrug[];
  /** Toxicity flags from drugs.json dangers, applied above 2x standard. */
  flags: string[];
}

// - Oct 29 manual vitals and monitor -

export interface Observed {
  value: string;
  t_s: number;
  method: string;
}

export interface ObservedVitals {
  hr?: Observed;
  rr?: Observed;
  sbp?: Observed;
  dbp?: Observed;
  spo2?: Observed;
  temp?: Observed;
  glucose?: Observed;
  pupils?: Observed;
  skin?: Observed;
  lungs?: Observed;
  gcs?: Observed;
  capRefill?: Observed;
}

export interface MonitorState {
  spo2Attached: boolean;
  etco2Attached: boolean;
  /** True SpO2 ring for the 30 s monitor lag. */
  spo2History: { t_s: number; value: number }[];
  movedDuringNibp: boolean;
}
