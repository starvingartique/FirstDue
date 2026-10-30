// Physiology engine: 1 sim-second tick, single source of truth for vitals,
// bleeding, hemorrhage control, inventory and event log. No LLM ever touches
// these numbers. Deterministic per seed. All clinical values come from the
// Oct 28 data files; TUNE tags from the answers file stay in the data.

import { Rng } from "./rng";
import { deriveVitals, BASELINE_MAP, FEMORAL_BASE_ML_PER_MIN, BLOOD_VOLUME_ML } from "./physiology";
import {
  bvmDeliveryFactor,
  bvmRatePerMin,
  fio2For,
  fitEtt,
  fitMask,
  fitNpa,
  fitOpa,
  fitSupraglottic,
  freshAirway,
  freshBvm,
  freshO2,
  tankPsiPerSecond
} from "./airway";
import {
  IO_FLOW,
  PRESSURE_BAG_X,
  freshFluids,
  isLargeGaugeSmallVein,
  ioNeedleOk,
  ivSuccessP,
  IV_GRAVITY_FLOW,
  retainedFluids_mL
} from "./lines";
import { drugCatalog, effectFactor, formatDose } from "./drugs";
import {
  bpAuscultatedRead,
  bpPalpatedRead,
  capRefillRead,
  glucoseRead,
  nibpRead,
  pulsePointForSbp,
  pulseRead,
  rrRead,
  spo2Read,
  tempRead
} from "./exams";
import type { CuffFit } from "./exams";
import type {
  ActiveDrug,
  AirwayState,
  AtlsClass,
  BvmState,
  DressingState,
  DrugsState,
  FetchJob,
  FluidsState,
  Holder,
  LineState,
  LogEvent,
  MonitorState,
  O2Device,
  O2State,
  ObservedVitals,
  PackingState,
  PendingAction,
  PressureState,
  ShockFlag,
  TqState,
  Vitals
} from "./types";
import type { Oct29AirwayInput, Oct29DrugInput } from "./physiology";

export interface SimConfig {
  seed: number;
  startLoss_mL: number;
  bystanderShirt: boolean;
  beltTrap: boolean;
  stressActive: boolean;
  betaBlocked: boolean;
  wetClothing: boolean;
  wrapped: boolean;
  startTemp_C: number;
  startPain_0_to_10: number;
  /** Cabinet round trip in sim-seconds. Data range is 45-60. */
  fetch_s: number;
  darkScene: boolean;
  roadside: boolean;
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export interface TqOptions {
  strapTight: boolean;
  placement: "high_thigh" | "knee";
  halfTurns: number;
  writeTime: boolean;
}

/**
 * L1 slow-deterioration dial from the brief difficulty table. The brief gives
 * no number, so this stays a named TUNE flag for Wyatt: L1 accrues blood loss
 * at half the engine rate, L2 stays 1.0 exactly (Oct 28 curve untouched).
 */
export const L1_DETERIORATION_SCALE = 0.5;

export interface SecondTqOptions {
  /** Windlass half-turns on the second CAT. Under 3 never clamps (same rule as the first). Omitted = 3. */
  halfTurns?: number;
  placement: "proximal" | "distal" | "over_wound" | "overlapping";
  loosenedFirst: boolean;
}

export interface PackOptions {
  technique: "packed" | "on_top";
  gauze: "hemostatic" | "plain";
}

export interface PressureOptions {
  quality: "firm" | "light" | "off_source";
  holder: Holder;
}

const TOOL_ITEMS = new Set([
  "trauma_shears",
  "sharpie_tq_time",
  "opa_set",
  "npa_set",
  "suction_unit",
  "waveform_etco2",
  "bvm_adult",
  "io_drill_ezio",
  "pressure_bag_300",
  "fluid_warmer",
  "stethoscope",
  "bp_cuff_adult",
  "bp_cuff_large",
  "bp_cuff_peds",
  "penlight",
  "glucometer",
  "thermometer",
  "monitor_defib"
]);

function freshTq(): TqState {
  return {
    applied: false,
    occluded: false,
    residualFlow_0_to_1: 1,
    placement: "none",
    halfTurns: 0,
    timeWritten: false,
    appliedAt_s: 0,
    secondApplied: false,
    secondPlacement: "none",
    loosened: false,
    failedSlack: false
  };
}

function freshPacking(): PackingState {
  return {
    stage: "none",
    packed: false,
    technique: "packed",
    gauze: "hemostatic",
    holdRemaining_s: 0,
    holdTotal_s: 180,
    holder: null,
    loosened: false
  };
}

function freshPressure(): PressureState {
  return {
    active: false,
    quality: "firm",
    holder: null,
    held_s: 0,
    bystanderShirt: false
  };
}

function freshDressing(): DressingState {
  return {
    applied: false,
    tightness: "correct",
    overPacking: false,
    soaked: false,
    loosened: false
  };
}

export class Sim {
  readonly rng: Rng;
  readonly config: SimConfig;

  t_s = 0;
  loss_mL: number;
  temp_C: number;
  pain_0_to_10: number;
  arrested = false;

  stressActive: boolean;
  betaBlocked: boolean;
  wetClothing: boolean;
  wrapped: boolean;
  exposed = false;
  beltTrap: boolean;

  tq: TqState = freshTq();
  packing: PackingState = freshPacking();
  pressure: PressureState = freshPressure();
  dressing: DressingState = freshDressing();

  // Oct 29 kit depth: airway, breathing, lines/fluids, drugs, exams, monitor.
  airway: AirwayState = freshAirway();
  o2: O2State = freshO2();
  bvm: BvmState = freshBvm();
  fluids: FluidsState = freshFluids();
  drugs: DrugsState = { active: [], flags: [] };
  observed: ObservedVitals = {};
  monitor: MonitorState = { spo2Attached: false, etco2Attached: false, spo2History: [], movedDuringNibp: false };
  /** Cert level for vitals display: L1 auto, L2 manual. Bike down runs L2. */
  level: 1 | 2 = 2;
  /** Blood-loss accrual multiplier. L1 slow, L2 exactly 1.0. See setLevel. */
  deteriorationScale = 1;
  lastTalkAt_s = -1000;
  talkCount = 0;
  private stressEasedLogged = false;
  /** Rolled IO pressure-bag flows by line id (seeded at placement, logged). */
  private ioPressureFlows = new Map<number, number>();

  pending: PendingAction | null = null;
  private pendingDone: (() => void) | null = null;
  fetches: FetchJob[] = [];
  /** Background packing hold when the partner holds (player stays free). */
  private partnerHold_s = 0;

  stashes = new Map<string, { belt: number; jump: number; cabinet: number; fetched: number }>();
  log: LogEvent[] = [];

  private lastClass: AtlsClass | null = null;
  private lastShock: ShockFlag | null = null;
  private lastMap = BASELINE_MAP;
  private roadRashClotAt_s: number;
  vitals: Vitals;

  constructor(config: SimConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.loss_mL = config.startLoss_mL;
    this.temp_C = config.startTemp_C;
    this.pain_0_to_10 = config.startPain_0_to_10;
    this.stressActive = config.stressActive;
    this.betaBlocked = config.betaBlocked;
    this.wetClothing = config.wetClothing;
    this.wrapped = config.wrapped;
    this.beltTrap = config.beltTrap;
    this.pressure.bystanderShirt = config.bystanderShirt;
    this.roadRashClotAt_s = Math.round(this.rng.range(300, 600));
    this.vitals = this.derive();
    this.addLog("info", `Call start. Seed ${config.seed}. Blood loss at contact ${Math.round(config.startLoss_mL)} mL.`);
    if (config.bystanderShirt) {
      this.addLog("bleed", "Bystander holds a balled-up shirt on the wound (direct pressure, about 50 percent).");
    }
    if (config.beltTrap) {
      this.addLog("trap", "Belt cinched mid-thigh: venous tourniquet (x1.3 bleed). Leg purple and swollen.");
    }
  }

  // - inventory -

  stock(itemId: string, belt: number, jump: number, cabinet: number): void {
    this.stashes.set(itemId, { belt, jump, cabinet, fetched: 0 });
  }

  atPatient(itemId: string): number {
    const s = this.stashes.get(itemId);
    if (!s) return 0;
    return s.belt + s.jump + s.fetched;
  }

  cabinetLeft(itemId: string): number {
    return this.stashes.get(itemId)?.cabinet ?? 0;
  }

  /** Take one unit from belt, jump bag, or fetched stock. Tools only need presence. */
  private take(itemId: string): boolean {
    const s = this.stashes.get(itemId);
    if (!s) return false;
    if (TOOL_ITEMS.has(itemId)) {
      return s.belt + s.jump + s.fetched > 0;
    }
    if (s.belt > 0) {
      s.belt -= 1;
      return true;
    }
    if (s.jump > 0) {
      s.jump -= 1;
      return true;
    }
    if (s.fetched > 0) {
      s.fetched -= 1;
      return true;
    }
    return false;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  get pendingLabel(): string {
    return this.pending ? `${this.pending.label} (${this.pending.remaining_s}s left)` : "Idle";
  }

  // - core tick -

  /** Advance one sim-second: timers, bleed, vitals, flags, arrest rolls. */
  tick(): void {
    if (this.arrested) {
      // PEA: clock runs, nothing recovers. No CPR on Oct 28. The tank still
      // drains and fluids still run, so the Oct 29 tick still applies.
      this.t_s += 1;
      this.finishPending();
      this.tickOct29();
      this.vitals = this.derive();
      return;
    }
    this.t_s += 1;

    // Partner-held packing pressure runs in the background.
    if (this.partnerHold_s > 0) {
      this.partnerHold_s -= 1;
      if (this.partnerHold_s <= 0) this.completePackingHold();
    }
    // Partner packing-hold tracking on the state itself.
    if (this.packing.stage === "holding" && this.packing.holder === "partner") {
      this.packing.holdRemaining_s = this.partnerHold_s;
    }

    this.finishPending();

    // Direct-pressure fatigue clock.
    if (this.pressure.active) this.pressure.held_s += 1;

    this.tickOct29();

    // Bleed accrues at the controlled rate. MAP from last tick keeps the
    // pressure scaling causal: the bleed slows as he crashes.
    const ratePerMin = this.bleedRate_mL_per_min();
    // L1 difficulty dial only: L2 multiplies by exactly 1.0, so the Oct 28
    // bleed curve underneath is unchanged.
    this.loss_mL += (ratePerMin / 60) * this.deteriorationScale;

    // Hypothermia slide: -0.5 C per 10 min exposed and wet (TUNE).
    const slide = this.wetClothing && !this.wrapped ? 1 : this.wetClothing || !this.wrapped ? 0.5 : 0;
    this.temp_C -= (0.5 / 600) * slide;

    this.vitals = this.derive();
    this.lastMap = this.vitals.map_mmhg;
    // Monitor SpO2 lags true SpO2 by 30 s: keep a ring of true values.
    this.monitor.spo2History.push({ t_s: this.t_s, value: this.vitals.spo2_pct });
    while (this.monitor.spo2History.length > 0 && this.t_s - (this.monitor.spo2History[0]?.t_s ?? 0) > 120) {
      this.monitor.spo2History.shift();
    }

    // Class and shock-index flags, logged on change.
    if (this.lastClass !== null && this.vitals.atlsClass !== this.lastClass) {
      this.addLog("class", `Shock class ${this.lastClass} -> ${this.vitals.atlsClass} at ${Math.round(this.loss_mL)} mL lost.`);
    }
    this.lastClass = this.vitals.atlsClass;
    if (this.lastShock !== null && this.vitals.shockFlag !== this.lastShock) {
      this.addLog("vitals", `Shock index ${this.vitals.shockIndex} (${this.vitals.shockFlag}).`);
    }
    this.lastShock = this.vitals.shockFlag;

    // Arrest window: 15 percent per-second-tick chance above 50 percent loss,
    // forced at 58 percent (TUNE). Runs on EFFECTIVE loss so fluids help;
    // with no fluids this is identical to Oct 28.
    const loss_pct = (this.effectiveLoss_mL() / BLOOD_VOLUME_ML) * 100;
    if (loss_pct >= 58) {
      this.arrest("forced at 58 percent loss");
    } else if (loss_pct > 50 && this.rng.chance(0.15)) {
      this.arrest("PEA roll in the arrest window");
    }
  }

  private finishPending(): void {
    // Fetch jobs run in the background (partner) or as the pending action.
    for (let i = this.fetches.length - 1; i >= 0; i--) {
      const job = this.fetches[i];
      job.remaining_s -= 1;
      if (job.remaining_s <= 0) {
        const s = this.stashes.get(job.itemId);
        if (s && s.cabinet > 0) {
          s.cabinet -= 1;
          s.fetched += 1;
          this.addLog("fetch", `${job.itemId} fetched from the truck (${job.total_s}s round trip).`);
        }
        this.fetches.splice(i, 1);
      }
    }
    if (this.pending === null) return;
    this.pending.remaining_s -= 1;
    if (this.pending.remaining_s <= 0) {
      const done = this.pendingDone;
      this.addLog("action", `Done: ${this.pending.label}.`);
      this.pending = null;
      this.pendingDone = null;
      done?.();
    }
  }

  private derive(): Vitals {
    return deriveVitals({
      loss_mL: this.loss_mL,
      stressActive: this.stressActive,
      betaBlocked: this.betaBlocked,
      temp_C: this.temp_C,
      pain_0_to_10: this.pain_0_to_10,
      arrested: this.arrested,
      effectiveLoss_mL: this.effectiveLoss_mL(),
      airway: this.airwayDeriveInput(),
      drugs: this.drugDeriveInput()
    });
  }

  addLog(kind: LogEvent["kind"], text: string): void {
    this.log.push({ t_s: this.t_s, kind, text });
  }

  private arrest(why: string): void {
    this.arrested = true;
    this.pressure.active = false;
    this.pressure.bystanderShirt = false;
    this.addLog("arrest", `PEA arrest (${why}). Bleeding stops: no perfusion.`);
    this.vitals = this.derive();
  }

  // - bleed model -

  /** Current femoral bleed rate in mL/min, controlled by interventions. */
  bleedRate_mL_per_min(): number {
    if (this.arrested) return 0;
    const base = FEMORAL_BASE_ML_PER_MIN * (this.lastMap / BASELINE_MAP);
    let mult = 1;
    let residual = 1;

    if (this.beltTrap) mult *= 1.3;

    // Tourniquet.
    if (this.tq.applied) {
      if (this.tq.placement === "venous_loose") {
        mult *= 1.3;
      } else if (this.tq.placement === "knee") {
        residual = Math.min(residual, 0.9);
      } else if (this.tq.occluded) {
        // Moved patient: occlusion slips to at least 35 percent flow until
        // reassessed (engine rule). Must override, not min, the residual.
        const r = this.tq.loosened
          ? Math.max(this.tq.residualFlow_0_to_1, 0.35)
          : this.tq.residualFlow_0_to_1;
        residual = Math.min(residual, r);
      }
    }
    // Second TQ proximal brings residual flow to 0.
    if (this.tq.secondApplied) {
      if (this.tq.secondPlacement === "proximal") residual = 0;
      else if (this.tq.secondPlacement === "overlapping") residual = Math.min(residual, 0.5);
    }

    // Packing.
    if (this.packing.stage === "set") {
      let r = this.packing.technique === "packed" ? (this.packing.gauze === "hemostatic" ? 0.1 : 0.25) : 0.65;
      if (this.packing.loosened) r = Math.min(1, r * 2);
      residual = Math.min(residual, r);
    } else if (this.packing.stage === "holding" || this.packing.stage === "packed_pending_hold") {
      // Packed but not set: pressure in progress holds like firm pressure.
      residual = Math.min(residual, 0.45);
    }

    // Direct pressure.
    if (this.pressure.bystanderShirt) residual = Math.min(residual, 0.5);
    if (this.pressure.active) {
      let eff = this.pressure.quality === "firm" ? 0.55 : this.pressure.quality === "light" ? 0.2 : 0.1;
      // Fatigue: -5 percent effectiveness per minute after 3 min (TUNE).
      if (this.pressure.held_s > 180) {
        eff = Math.max(0, eff - 0.05 * Math.floor((this.pressure.held_s - 180) / 60));
      }
      residual = Math.min(residual, 1 - eff);
    }

    // Pressure dressing.
    if (this.dressing.applied) {
      if (this.dressing.tightness === "loose") {
        this.dressing.soaked = true;
        residual = Math.min(residual, 0.85);
      } else if (this.dressing.tightness === "tight") {
        // Distal venous tourniquet: weak control plus distal congestion.
        residual = Math.min(residual, 0.9);
      } else if (this.dressing.overPacking) {
        // Holds the packing effect: no extra change, protects the set.
        residual = Math.min(residual, this.packing.stage === "set" ? 0.1 : 0.6);
      } else {
        residual = Math.min(residual, 0.6);
      }
      if (this.dressing.loosened) residual = Math.min(1, residual + 0.2);
    }

    // Road rash ooze until it self-clots (capillary, not pressure-scaled).
    const ooze = this.t_s < this.roadRashClotAt_s ? 2 : 0;
    return Math.max(0, base * mult * residual + ooze);
  }

  /** True when the thigh is congested: belt trap, venous TQ, or tight dressing. */
  legCongested(): boolean {
    return (
      this.beltTrap ||
      (this.tq.applied && this.tq.placement === "venous_loose") ||
      (this.dressing.applied && this.dressing.tightness === "tight")
    );
  }

  // - actions -

  private start(id: string, label: string, seconds: number, done: () => void): ActionResult {
    if (this.arrested) return { ok: false, reason: "Patient is in arrest." };
    if (this.pending !== null) return { ok: false, reason: `Busy: ${this.pending.label}.` };
    this.pending = { id, label, total_s: seconds, remaining_s: seconds };
    this.pendingDone = done;
    this.addLog("action", `Start: ${label} (${seconds}s).`);
    return { ok: true };
  }

  /** First hands-on M step: the bystander lets go and it spurts. */
  private spurtCheck(): void {
    if (this.pressure.bystanderShirt) {
      this.pressure.bystanderShirt = false;
      this.addLog("bleed", "Bystander lets go. The wound spurts.");
    }
  }

  takeOverFromBystander(): ActionResult {
    if (!this.pressure.bystanderShirt) return { ok: false, reason: "Nobody to take over from." };
    this.spurtCheck();
    return { ok: true };
  }

  exposeWound(): ActionResult {
    if (this.exposed) return { ok: false, reason: "Already exposed." };
    if (this.atPatient("trauma_shears") < 1) return { ok: false, reason: "Need trauma shears at the patient." };
    return this.start("expose", "Expose the thigh (shears)", 10, () => {
      this.exposed = true;
      this.addLog("action", "Thigh exposed: partial femoral laceration, spurting. Belt cinched mid-thigh, leg purple and swollen.");
    });
  }

  removeBelt(): ActionResult {
    if (!this.beltTrap) return { ok: false, reason: "No belt to remove." };
    return this.start("remove_belt", "Remove the bystander belt", 5, () => {
      this.beltTrap = false;
      this.addLog("trap", "Belt removed. Venous congestion easing, x1.3 multiplier gone.");
    });
  }

  applyTQ(o: TqOptions): ActionResult {
    if (this.tq.applied) return { ok: false, reason: "A tourniquet is already on." };
    if (o.halfTurns < 0 || o.halfTurns > 6) return { ok: false, reason: "Half-turns must be 0-6." };
    if (!this.take("cat_tourniquet")) {
      return { ok: false, reason: "No CAT at the patient. Check the belt or jump bag, or fetch from the truck." };
    }
    this.spurtCheck();
    return this.start("apply_tq", "Apply CAT high and tight", 30, () => {
      if (!o.strapTight) {
        this.tq.failedSlack = true;
        this.tq.applied = false;
        this.addLog("trap", "Slack strap: windlass maxes out without occluding. Start over with a fresh pull.");
        return;
      }
      this.tq.applied = true;
      this.tq.appliedAt_s = this.t_s;
      this.tq.halfTurns = o.halfTurns;
      this.tq.timeWritten = o.writeTime;
      this.pain_0_to_10 = Math.min(10, this.pain_0_to_10 + 3);
      if (o.placement === "knee") {
        this.tq.placement = "knee";
        this.tq.occluded = false;
        this.addLog("trap", "Tourniquet over the knee joint: ineffective (x0.9 of the bleed). Move it to the thigh.");
      } else if (o.halfTurns < 3) {
        this.tq.placement = "venous_loose";
        this.tq.occluded = false;
        this.addLog("trap", "Venous tourniquet: too loose, bleed x1.3, limb engorged and blue. Crank to occlude.");
      } else {
        this.tq.placement = "high_thigh";
        this.tq.occluded = true;
        // Single thigh CAT failure: 25 percent chance (TUNE) of 10-20 percent residual.
        if (this.rng.chance(0.25)) {
          this.tq.residualFlow_0_to_1 = this.rng.range(0.1, 0.2);
          this.addLog("bleed", `Tourniquet occluded with ${Math.round(this.tq.residualFlow_0_to_1 * 100)} percent residual flow. Consider a second TQ.`);
        } else {
          this.tq.residualFlow_0_to_1 = 0;
          this.addLog("bleed", "Tourniquet occluded: bleeding stopped AND distal pulse gone.");
        }
      }
      if (!o.writeTime) this.addLog("trap", "No TQ time written: logged, missing from MIST.");
      else this.addLog("action", `TQ time written: T+${this.t_s}s.`);
    });
  }

  applySecondTQ(o: SecondTqOptions): ActionResult {
    if (!this.tq.applied) return { ok: false, reason: "No first tourniquet to back up." };
    if (this.tq.secondApplied) return { ok: false, reason: "Second tourniquet already on." };
    if (!this.take("cat_tourniquet")) {
      return { ok: false, reason: "No CAT at the patient. Check the belt or jump bag, or fetch from the truck." };
    }
    this.spurtCheck();
    const gap = o.loosenedFirst;
    if (gap) this.addLog("trap", "First TQ loosened to place the second: full bleed resumes during the gap.");
    return this.start("apply_tq2", "Apply second CAT proximal", 30, () => {
      this.tq.secondApplied = true;
      const turns = o.halfTurns ?? 3;
      if (turns < 3 && (o.placement === "proximal" || o.placement === "overlapping")) {
        this.tq.secondPlacement = "loose";
        this.addLog("trap", "Second TQ too loose: windlass not cranked enough to clamp. No effect, crank it or add another.");
        return;
      }
      this.tq.secondPlacement = o.placement;
      if (o.placement === "proximal") {
        this.tq.residualFlow_0_to_1 = 0;
        this.addLog("bleed", "Second TQ proximal, side by side: bleed to 0.");
      } else if (o.placement === "overlapping") {
        this.addLog("trap", "Overlapping windlasses: neither locks, x0.5 residual.");
      } else {
        this.addLog("trap", "Second TQ below the first or over the wound: no effect.");
      }
    });
  }

  packWound(o: PackOptions): ActionResult {
    if (this.packing.stage === "holding" || this.packing.stage === "packed_pending_hold") {
      return { ok: false, reason: "Packing already in progress." };
    }
    if (!this.exposed) return { ok: false, reason: "Expose the wound first (shears)." };
    const gauzeId = o.gauze === "hemostatic" ? "hemostatic_gauze_zfold" : "plain_gauze_roll_kerlix";
    if (!this.take(gauzeId)) return { ok: false, reason: `No ${o.gauze} gauze at the patient.` };
    this.spurtCheck();
    return this.start("pack", `Pack the wound (${o.gauze} gauze)`, 60, () => {
      this.packing.stage = "packed_pending_hold";
      this.packing.packed = true;
      this.packing.technique = o.technique;
      this.packing.gauze = o.gauze;
      this.packing.holdRemaining_s = 180;
      this.packing.holdTotal_s = 180;
      this.packing.loosened = false;
      if (o.technique === "on_top") {
        this.addLog("trap", "Gauze laid on top, not packed: only about 35 percent reduction even if held.");
      } else {
        this.addLog("action", "Wound packed onto the bleeding source. Now 3 min of continuous firm pressure.");
      }
    });
  }

  holdPacking(holder: Holder): ActionResult {
    if (this.packing.stage !== "packed_pending_hold") {
      return { ok: false, reason: "Nothing packed and waiting for pressure." };
    }
    if (this.pressure.active && this.pressure.holder === holder) {
      return { ok: false, reason: "That holder is already on the wound." };
    }
    this.packing.stage = "holding";
    this.packing.holder = holder;
    this.packing.holdRemaining_s = 180;
    if (holder === "partner") {
      this.partnerHold_s = 180;
      this.addLog("action", "Partner holds packing pressure (3 min). Player stays free.");
      return { ok: true };
    }
    this.addLog("action", `${holder === "player" ? "You hold" : "Bystander holds"} packing pressure (3 min, continuous).`);
    // Bystander hold runs as a background timer like the partner; the player
    // holding occupies the player as the pending action.
    if (holder === "bystander") {
      this.partnerHold_s = 180;
      return { ok: true };
    }
    return this.start("hold_packing", "Hold packing pressure", 180, () => {
      this.completePackingHold();
    });
  }

  private completePackingHold(): void {
    if (this.packing.stage !== "holding") return;
    this.packing.stage = "set";
    this.packing.holdRemaining_s = 0;
    this.addLog("bleed", "3 min hold complete. Packing set: arterial bleed down about 90 percent. Dress it.");
  }

  releasePackingEarly(): ActionResult {
    if (this.packing.stage !== "holding" && this.packing.stage !== "packed_pending_hold") {
      return { ok: false, reason: "No packing under pressure to release." };
    }
    // Cancel a player hold if it is the pending action.
    if (this.pending?.id === "hold_packing") {
      this.pending = null;
      this.pendingDone = null;
    }
    this.partnerHold_s = 0;
    // 60 percent rebleed chance (TUNE).
    if (this.rng.chance(0.6)) {
      this.packing.stage = "failed";
      this.packing.packed = false;
      this.addLog("trap", "Pressure released before 3 min: rebleed. The clot failed, repack.");
    } else {
      this.packing.stage = "set";
      this.addLog("bleed", "Pressure released early but the clot held this time. Do not count on it.");
    }
    return { ok: true };
  }

  peekPacking(): ActionResult {
    if (this.packing.stage !== "set" && this.packing.stage !== "holding") {
      return { ok: false, reason: "No packing to peek at." };
    }
    if (this.pending?.id === "hold_packing") {
      this.pending = null;
      this.pendingDone = null;
    }
    this.partnerHold_s = 0;
    this.packing.stage = "none";
    this.packing.packed = false;
    this.addLog("trap", "Peeked at the packing: clot disrupted, full bleed restarts. Repack.");
    return { ok: true };
  }

  startPressure(o: PressureOptions): ActionResult {
    if (this.arrested) return { ok: false, reason: "Patient is in arrest." };
    if (this.pressure.active) return { ok: false, reason: "Pressure already held. Release it first." };
    if (this.pending !== null && o.holder === "player") {
      return { ok: false, reason: `Busy: ${this.pending.label}.` };
    }
    this.spurtCheck();
    const apply = (): void => {
      this.pressure.active = true;
      this.pressure.quality = o.quality;
      this.pressure.holder = o.holder;
      this.pressure.held_s = 0;
      const what = o.quality === "firm" ? "firm, bodyweight" : o.quality === "light" ? "light" : "off the source";
      this.addLog("action", `Direct pressure (${what}) by ${o.holder}. A bridge, not a fix.`);
    };
    if (o.holder === "player") {
      return this.start("pressure", "Take over direct pressure", 3, apply);
    }
    // Partner or bystander starts within 2-5 s while the player stays free.
    apply();
    return { ok: true };
  }

  releasePressure(): ActionResult {
    if (!this.pressure.active) return { ok: false, reason: "Nobody is holding pressure." };
    this.pressure.active = false;
    this.pressure.holder = null;
    this.addLog("bleed", "Pressure lifted: full rate resumes instantly.");
    return { ok: true };
  }

  swapPressureHolder(holder: Holder): ActionResult {
    if (!this.pressure.active) return { ok: false, reason: "Nobody is holding pressure." };
    this.pressure.holder = holder;
    this.pressure.held_s = 0;
    this.addLog("action", `${holder} swaps in on pressure. Fatigue clock reset.`);
    return { ok: true };
  }

  applyDressing(tightness: "correct" | "loose" | "tight"): ActionResult {
    if (this.dressing.applied) return { ok: false, reason: "A dressing is already on." };
    if (!this.exposed) return { ok: false, reason: "Expose the wound first (shears)." };
    if (!this.take("pressure_bandage_6in")) {
      return { ok: false, reason: "No 6 in pressure bandage at the patient." };
    }
    this.spurtCheck();
    return this.start("dressing", "Apply pressure dressing", 65, () => {
      this.dressing.applied = true;
      this.dressing.tightness = tightness;
      this.dressing.overPacking = this.packing.stage === "set";
      this.dressing.loosened = false;
      if (tightness === "loose") {
        this.dressing.soaked = true;
        this.addLog("trap", "Dressing too loose: soaking through, about 15 percent effect. Escalate.");
      } else if (tightness === "tight") {
        this.addLog("trap", "Dressing too tight: distal venous tourniquet. Distal cap refill long, limb swells. PMS check catches it.");
      } else if (this.dressing.overPacking) {
        this.addLog("bleed", "Dressing over packing: holds the packing effect.");
      } else {
        this.addLog("bleed", "Dressing over an unpacked arterial wound: only about 40 percent. Escalate to TQ or pack.");
      }
    });
  }

  removeDressing(): ActionResult {
    if (!this.dressing.applied) return { ok: false, reason: "No dressing to remove." };
    this.dressing = freshDressing();
    this.addLog("trap", "Soaked dressing removed: bleed restarts.");
    return { ok: true };
  }

  reassessBleeding(): ActionResult {
    const any =
      (this.tq.applied && this.tq.loosened) ||
      (this.packing.loosened && this.packing.stage === "set") ||
      (this.dressing.applied && this.dressing.loosened);
    if (!any) return { ok: false, reason: "Nothing loosened. No reassessment due." };
    return this.start("reassess", "Reassess hemorrhage control", 15, () => {
      this.tq.loosened = false;
      this.packing.loosened = false;
      this.dressing.loosened = false;
      this.addLog("reassess", "Hemorrhage control reassessed after movement. Control restored.");
    });
  }

  movePatient(kind: "log_roll" | "cot_transfer" | "loading"): ActionResult {
    if (this.arrested) return { ok: false, reason: "Patient is in arrest." };
    const label = kind === "log_roll" ? "Log roll" : kind === "cot_transfer" ? "Cot transfer" : "Loading";
    if (this.pressure.active || this.pressure.bystanderShirt) {
      this.pressure.active = false;
      this.pressure.holder = null;
      this.pressure.bystanderShirt = false;
      this.addLog("movement", `${label}: direct pressure lost until re-established.`);
    }
    if (this.tq.applied) {
      this.tq.loosened = true;
      this.addLog("movement", `${label}: tourniquet may have loosened. Reassessment required.`);
    }
    if (this.packing.stage === "set" || this.packing.stage === "holding") {
      this.packing.loosened = true;
      this.addLog("movement", `${label}: packing may have loosened. Reassessment required.`);
    }
    if (this.dressing.applied) {
      this.dressing.loosened = true;
      this.addLog("movement", `${label}: dressing may have loosened. Reassessment required.`);
    }
    if (this.packing.stage === "holding") {
      // A move during the hold breaks it: same as an early release.
      this.addLog("movement", `${label} during the 3 min hold: pressure broken.`);
      this.releasePackingEarly();
    }
    // Oct 29: ETT dislodges on any move unless secured (shallow: even secured).
    const ett = this.airway.ett;
    if (ett !== null && (!ett.secured || ett.depth_cm < 22)) {
      this.airway.ett = null;
      this.airway.esophageal_s = 0;
      this.airway.mainstem_s = 0;
      this.airway.dislodged = true;
      this.airway.patency_0_to_1 = Math.max(this.airway.patency_0_to_1, 0.8);
      this.addLog("movement", `${label}: ETT dislodged (was ${ett.secured ? "shallow" : "not secured"}). Reassess the airway.`);
    }
    // Oct 29: infiltration +5 percent per move (TUNE) on every running line.
    for (const line of this.fluids.lines) {
      if (!line.patent || line.infiltrated) continue;
      if (this.rng.chance(0.05)) {
        line.infiltrated = true;
        this.addLog("movement", `${label}: line ${line.id} infiltrated. Stops delivering, site swells.`);
      }
    }
    // Oct 29: NIBP fails with motion.
    if (this.pending?.id === "nibp") this.monitor.movedDuringNibp = true;
    return { ok: true };
  }

  fetchFromTruck(itemId: string, runner: Holder): ActionResult {
    const s = this.stashes.get(itemId);
    if (!s) return { ok: false, reason: `Unknown item ${itemId}.` };
    if (s.cabinet < 1) return { ok: false, reason: "None left in the truck cabinet." };
    if (this.fetches.some((f) => f.itemId === itemId)) return { ok: false, reason: "Fetch already running." };
    const seconds = this.config.fetch_s;
    if (runner === "player") {
      return this.start("fetch", `Fetch ${itemId} from the truck`, seconds, () => {
        const st = this.stashes.get(itemId);
        if (st && st.cabinet > 0) {
          st.cabinet -= 1;
          st.fetched += 1;
          this.addLog("fetch", `${itemId} fetched from the truck (${seconds}s round trip).`);
        }
      });
    }
    const partnerJobs = this.fetches.filter((f) => f.runner === runner);
    const latest = partnerJobs.reduce((m, f) => Math.max(m, f.remaining_s), 0);
    if (partnerJobs.length > 0 && latest > seconds / 2) {
      // Still on the way out: grab this item on the same trip.
      this.fetches.push({ itemId, remaining_s: latest, total_s: seconds, runner });
      this.addLog("fetch", `${runner} adds ${itemId} to the current truck run (back in ${latest}s).`);
      return { ok: true };
    }
    const wait = partnerJobs.length > 0 ? latest : 0;
    this.fetches.push({ itemId, remaining_s: wait + seconds, total_s: seconds, runner });
    this.addLog(
      "fetch",
      wait > 0
        ? `${runner} heading back out for ${itemId} after this run (back in ${wait + seconds}s).`
        : `${runner} to the truck for ${itemId} (${seconds}s round trip).`
    );
    return { ok: true };
  }

  removeWetClothing(): ActionResult {
    if (!this.wetClothing) return { ok: false, reason: "Clothing already dry or removed." };
    return this.start("dry_clothes", "Remove wet clothing", 45, () => {
      this.wetClothing = false;
      this.addLog("action", "Wet clothing removed. Hypothermia slide cut.");
    });
  }

  applyWrap(): ActionResult {
    if (this.wrapped) return { ok: false, reason: "Already wrapped." };
    if (!this.take("hypothermia_wrap_blanket")) {
      return { ok: false, reason: "No wrap blanket at the patient. Fetch one from the truck." };
    }
    return this.start("wrap", "Wrap for hypothermia", 30, () => {
      this.wrapped = true;
      this.addLog("action", "Patient wrapped. Hypothermia slide cut.");
    });
  }

  // - Oct 29 shared helpers -

  /** Retained fluids in mL: crystalloid decay sum + blood at 90 percent. */
  retainedFluids_mL(): number {
    return retainedFluids_mL(this.fluids, this.t_s);
  }

  /** Effective loss drives the shock anchors and the arrest window. */
  effectiveLoss_mL(): number {
    return Math.max(0, this.loss_mL - this.retainedFluids_mL());
  }

  effectiveLoss_pct(): number {
    return (this.effectiveLoss_mL() / BLOOD_VOLUME_ML) * 100;
  }

  /** Delivered FiO2: device math, or room air when the tank is dry. */
  fio2Current(): number {
    if (this.o2.device === "none") return 0.21;
    if (this.o2.tankPsi <= 200) return 0.21;
    if (this.o2.device === "cpap") return this.o2.cpap_fio2;
    return fio2For(this.o2.device, this.o2.flow_L_per_min, this.o2.reservoirInflated);
  }

  /** O2 drain rate for the current device (CPAP 10 L/min is a TUNE stand-in). */
  private o2Drain_L_per_min(): number {
    if (this.o2.device === "none" || this.o2.tankPsi <= 200) return 0;
    if (this.o2.device === "cpap") return 10;
    return this.o2.flow_L_per_min;
  }

  /** True when a correct BVM breath landed in the last 10 s. */
  private bvmAssisting(): boolean {
    const recent = this.bvm.breaths.filter((b) => this.t_s - b.t_s <= 10);
    return recent.some((b) => b.volume_mL >= 500 && b.volume_mL <= 600);
  }

  private overventing(): boolean {
    if (bvmRatePerMin(this.bvm, this.t_s) > 12) return true;
    return this.bvm.breaths.some((b) => this.t_s - b.t_s < 60 && b.volume_mL > 600);
  }

  private airwayDeriveInput(): Oct29AirwayInput {
    const aw = this.airway;
    const fio2 = this.fio2Current();
    // TUNE couplings from oct29_airway.json engineCoupling_TUNE.
    let penalty = (1 - aw.patency_0_to_1) * 20;
    if (aw.aspirated) penalty += 8;
    penalty += Math.floor(aw.esophageal_s / 10) * 2;
    penalty += Math.floor(aw.mainstem_s / 10) * 1;
    penalty += aw.suctionDip_pct;
    if (aw.ett?.cuffLeak === true) penalty += 2;
    let bonus = Math.max(0, (fio2 - 0.21) * 25);
    if (this.bvmAssisting()) bonus += 5;
    let etco2Delta = (1 - aw.patency_0_to_1) * 15;
    if (this.overventing()) etco2Delta -= 10;
    if (this.o2.device === "non_rebreather" && !this.o2.reservoirInflated) etco2Delta += 10;
    const esophageal = aw.ett?.placement === "esophageal";
    // First derive runs before vitals exists: assume spontaneous breathing.
    const lastRr = this.vitals === undefined ? 14 : this.vitals.rr_per_min;
    const ventilated = lastRr > 0 || this.bvmAssisting();
    // Excess overvent breaths in the trailing minute drive the SBP drop.
    const rate = bvmRatePerMin(this.bvm, this.t_s);
    const excess = Math.max(0, rate - 12);
    let sbpDrop = excess * 2;
    if (this.effectiveLoss_pct() > 30) sbpDrop *= 2;
    return {
      patency_0_to_1: aw.patency_0_to_1,
      fio2_0_to_1: Math.round(fio2 * 100) / 100,
      spo2Penalty_pct: Math.round(penalty * 10) / 10,
      spo2Bonus_pct: Math.round(bonus * 10) / 10,
      etco2Delta_mmhg: Math.round(etco2Delta * 10) / 10,
      etco2Override_mmhg: esophageal ? 0 : null,
      etco2Waveform: this.monitor.etco2Attached && !esophageal && ventilated && !this.arrested,
      overventSbpDrop_mmhg: sbpDrop
    };
  }

  private drugDeriveInput(): Oct29DrugInput {
    const out: Oct29DrugInput = {
      hr_bpm: 0,
      sbp_mmhg: 0,
      rr_per_min: 0,
      spo2_pct: 0,
      gcs_points: 0,
      pain_0_to_10: 0,
      glucose_mg_per_dL: 0,
      apnea_0_to_1: 0
    };
    for (const d of this.drugs.active) {
      const f = effectFactor(d.givenAt_s, d.onset_s, d.peak_s, d.duration_s, this.t_s);
      if (f <= 0) continue;
      const s = Math.min(2, d.ratio_to_standard) * f;
      out.hr_bpm += (d.tokens.hr_bpm ?? 0) * s;
      out.sbp_mmhg += (d.tokens.sbp_mmhg ?? 0) * s;
      out.rr_per_min += (d.tokens.rr_per_min ?? 0) * s;
      out.spo2_pct += (d.tokens.spo2_pct ?? 0) * s;
      out.gcs_points += (d.tokens.gcs_points ?? 0) * s;
      out.pain_0_to_10 += (d.tokens.pain_0_to_10 ?? 0) * s;
      out.glucose_mg_per_dL += (d.tokens.glucose_mg_per_dL ?? 0) * s;
      if (d.tokens.apnea === true) {
        out.apnea_0_to_1 = Math.max(out.apnea_0_to_1, f * Math.min(1, d.ratio_to_standard));
      }
      // Analgesia on board eases the crash stress offset (section 1 rule).
      if ((d.tokens.pain_0_to_10 ?? 0) < 0 && f > 0.25 && this.stressActive) {
        this.stressActive = false;
        if (!this.stressEasedLogged) {
          this.stressEasedLogged = true;
          this.addLog("drug", "Analgesia taking effect: crash stress offset easing.");
        }
      }
    }
    return out;
  }

  private tickOct29(): void {
    // Esophageal and mainstem clocks run while the tube sits there.
    const placement = this.airway.ett?.placement;
    if (placement === "esophageal") this.airway.esophageal_s += 1;
    if (placement === "mainstem") this.airway.mainstem_s += 1;
    // Suction dip recovers over 60 s.
    if (this.airway.suctionDip_pct > 0) {
      this.airway.suctionDip_pct = Math.max(0, this.airway.suctionDip_pct - 4 / 60);
    }
    // Prune the BVM window to the trailing 120 s.
    this.bvm.breaths = this.bvm.breaths.filter((b) => this.t_s - b.t_s < 120);
    // Tank drain.
    const drain = this.o2Drain_L_per_min();
    if (drain > 0) {
      this.o2.tankPsi = Math.max(0, this.o2.tankPsi - tankPsiPerSecond(this.o2.tankFactor, drain));
      if (this.o2.tankPsi <= 200 && !this.o2.tankEmptyWarned) {
        this.o2.tankEmptyWarned = true;
        this.addLog("trap", "O2 tank at reserve (200 psi): flows room air now. Swap cylinders.");
      }
    }
    // Lines: infuse, finish bags, roll hourly infiltration (5 percent/hr).
    for (const line of this.fluids.lines) {
      if (!line.patent || line.infiltrated) continue;
      if (this.rng.chance(0.05 / 3600)) {
        line.infiltrated = true;
        this.addLog("trap", `Line ${line.id} infiltrated: stops delivering, site swells.`);
        continue;
      }
      const bag = line.bag;
      if (bag === null || bag.volumeLeft_mL <= 0) continue;
      const per_s = line.flow_mL_per_min / 60;
      const mL = Math.min(per_s, bag.volumeLeft_mL);
      bag.volumeLeft_mL -= mL;
      line.infused_mL += mL;
      if (bag.fluid === "blood") this.fluids.bloodRetained_mL += mL * 0.9;
      if (bag.volumeLeft_mL <= 0.001) {
        bag.volumeLeft_mL = 0;
        if (bag.fluid !== "blood") {
          this.fluids.crystalloidBags.push({ t_s: this.t_s, mL: bag.volumeTotal_mL });
        }
        this.addLog("fluid", `Line ${line.id}: ${bag.fluid} bag empty (${Math.round(bag.volumeTotal_mL)} mL in).`);
        line.bag = null;
      }
    }
    // Drugs: expire finished curves.
    for (let i = this.drugs.active.length - 1; i >= 0; i--) {
      const d = this.drugs.active[i];
      if (d === undefined) continue;
      if (this.t_s >= d.givenAt_s + d.peak_s + d.duration_s) {
        this.drugs.active.splice(i, 1);
        this.addLog("drug", `${d.drugId} wore off.`);
      }
    }
  }

  /** Shared vomit event: soils the airway, aspirates unless protected. */
  private vomit(why: string): void {
    const aw = this.airway;
    aw.vomited = true;
    aw.soiled = true;
    aw.patency_0_to_1 = Math.max(0.1, aw.patency_0_to_1 - 0.3);
    const ett = aw.ett;
    const protectedAirway =
      ett !== null &&
      (ett.placement === "tracheal" || ett.placement === "mainstem") &&
      !ett.cuffLeak &&
      ett.cuff_cmH2O >= 20 &&
      ett.cuff_cmH2O <= 30;
    if (protectedAirway) {
      this.addLog("airway", `Patient vomits (${why}). Cuffed ETT protects: suction now.`);
    } else {
      aw.aspirated = true;
      this.addLog("trap", `Patient vomits and aspirates (${why}). SpO2 penalty until suctioned.`);
    }
  }

  /** Lagged monitor SpO2 (30 s) with shock/cold and motion artifacts. */
  monitorSpo2(): { value: number; note: string } | { none: string } | null {
    if (!this.monitor.spo2Attached) return null;
    if (this.arrested) return { none: "No pleth: arrest." };
    const target = this.t_s - 30;
    let lagged = this.vitals.spo2_pct;
    for (const entry of this.monitor.spo2History) {
      if (entry.t_s <= target) lagged = entry.value;
      else break;
    }
    // Deterministic per state: the monitor must not re-roll every refresh.
    // The one-shot manual read (readSpo2) keeps the seeded coin flip.
    if (this.effectiveLoss_pct() > 30 || this.temp_C < 35) {
      return { value: Math.max(0, lagged - 6), note: "Weak pleth: falsely low in shock / cold." };
    }
    return { value: lagged, note: "Good pleth." };
  }

  monitorEtco2(): { waveform: boolean; value: number } | null {
    if (!this.monitor.etco2Attached) return null;
    return { waveform: this.vitals.etco2Waveform, value: this.vitals.etco2_mmhg };
  }

  setLevel(level: 1 | 2): void {
    this.level = level;
    this.deteriorationScale = level === 1 ? L1_DETERIORATION_SCALE : 1;
    this.addLog(
      "info",
      `Cert level ${level}: ${level === 1 ? "vitals auto-display, slow deterioration." : "manual vitals, real deterioration."}`
    );
  }

  recordTalk(): void {
    this.lastTalkAt_s = this.t_s;
    this.talkCount += 1;
  }

  // - Oct 29 airway actions -

  private airwayBlocked(): string | null {
    if (this.airway.adjunct !== null) return "An airway adjunct is already in. Remove it first.";
    if (this.airway.ett !== null) return "An ETT is already in. Remove it first.";
    return null;
  }

  insertOpa(size_mm: number): ActionResult {
    const blocked = this.airwayBlocked();
    if (blocked !== null) return { ok: false, reason: blocked };
    if (this.atPatient("opa_set") < 1) return { ok: false, reason: "Need the OPA set at the patient." };
    return this.start("opa", `Insert OPA ${size_mm} mm`, 15, () => {
      const fit = fitOpa(size_mm);
      this.airway.adjunct = { kind: "opa", size: String(size_mm), fit };
      // OPA with an intact gag reflex is contraindicated, whatever the size.
      if (this.airway.gagIntact) {
        this.addLog("trap", `OPA ${size_mm} in a patient with an intact gag: contraindicated.`);
        this.vomit("OPA against an intact gag");
        return;
      }
      if (fit === "correct") {
        this.airway.patency_0_to_1 = 1;
        this.addLog("airway", `OPA ${size_mm} seated: airway patent.`);
      } else if (fit === "small") {
        this.airway.patency_0_to_1 = Math.max(0.1, this.airway.patency_0_to_1 - 0.4);
        this.addLog("trap", `OPA ${size_mm} too small: pushes the tongue back, patency -0.4.`);
      } else {
        this.airway.patency_0_to_1 = Math.max(0.1, this.airway.patency_0_to_1 - 0.5);
        this.addLog("trap", `OPA ${size_mm} too big: pushes the epiglottis down, patency -0.5.`);
        this.vomit("oversized OPA on the gag");
      }
    });
  }

  insertNpa(size_fr: number): ActionResult {
    const blocked = this.airwayBlocked();
    if (blocked !== null) return { ok: false, reason: blocked };
    if (this.atPatient("npa_set") < 1) return { ok: false, reason: "Need the NPA set at the patient." };
    return this.start("npa", `Insert NPA ${size_fr} Fr`, 15, () => {
      const fit = fitNpa(size_fr);
      this.airway.adjunct = { kind: "npa", size: String(size_fr), fit };
      if (fit === "correct") {
        this.airway.patency_0_to_1 = 1;
        this.addLog("airway", `NPA ${size_fr} seated past the tongue: airway patent.`);
      } else if (fit === "small") {
        this.addLog("trap", `NPA ${size_fr} too small: does not pass the tongue, no benefit.`);
      } else {
        this.airway.epistaxis = true;
        this.airway.gastricAir = true;
        this.addLog("trap", `NPA ${size_fr} too big: epistaxis plus esophageal placement (gastric air).`);
      }
    });
  }

  placeSupraglottic(kind: "igel" | "kinglt", size: number): ActionResult {
    const blocked = this.airwayBlocked();
    if (blocked !== null) return { ok: false, reason: blocked };
    const item = kind === "igel" ? "igel_set" : "kinglt_set";
    if (!this.take(item)) return { ok: false, reason: `No ${kind === "igel" ? "i-gel" : "King LT"} at the patient.` };
    const label = kind === "igel" ? `i-gel #${size}` : `King LT #${size}`;
    return this.start("sga", `Place ${label}`, 25, () => {
      const fit = fitSupraglottic(size, 4);
      this.airway.adjunct = { kind, size: `#${size}`, fit };
      if (fit === "correct") {
        this.airway.patency_0_to_1 = 1;
        this.addLog("airway", `${label} seated: airway patent.`);
      } else if (kind === "igel") {
        this.addLog("trap", `${label} wrong size: leak, delivered tidal volume x0.6.`);
      } else if (fit === "small") {
        this.addLog("trap", `${label} too small: leak.`);
      } else {
        this.addLog("trap", `${label} too big: will not seat properly.`);
      }
    });
  }

  intubate(size_mm: number, depth_cm: number, blind: boolean, cuff_cmH2O: number): ActionResult {
    const blocked = this.airwayBlocked();
    if (blocked !== null) return { ok: false, reason: blocked };
    if (!this.take("ett_set")) return { ok: false, reason: "No ETT set at the patient." };
    return this.start("ett", `Intubate ${size_mm} mm at ${depth_cm} cm`, 60, () => {
      const fit = fitEtt(size_mm);
      if (fit === "big") {
        this.airway.patency_0_to_1 = Math.max(0.1, this.airway.patency_0_to_1 - 0.2);
        this.addLog("trap", `ETT ${size_mm} too big: will not pass, laryngeal trauma.`);
        return;
      }
      const placement = depth_cm < 22 ? "tracheal" : blind ? "esophageal" : depth_cm > 23 ? "mainstem" : "tracheal";
      const cuffOk = cuff_cmH2O >= 20 && cuff_cmH2O <= 30;
      this.airway.ett = {
        size_mm,
        depth_cm,
        placement,
        secured: false,
        cuff_cmH2O,
        cuffLeak: fit === "small" || !cuffOk,
        willNotPass: false
      };
      this.airway.esophageal_s = 0;
      this.airway.mainstem_s = 0;
      this.airway.esophagealRecognized = false;
      this.airway.dislodged = false;
      if (fit === "small") {
        this.addLog("trap", `ETT ${size_mm} too small: high resistance, cuff leak.`);
      }
      if (!cuffOk) {
        this.addLog("trap", `Cuff at ${cuff_cmH2O} cmH2O: outside the 20-30 target, cuff leak.`);
      }
      if (placement === "esophageal") {
        this.airway.patency_0_to_1 = 0.1;
        this.addLog("trap", "Tube in the esophagus: no EtCO2 waveform. SpO2 falls 2 percent per 10 s until it is out.");
      } else if (placement === "mainstem") {
        this.airway.patency_0_to_1 = 0.9;
        this.addLog("trap", `ETT at ${depth_cm} cm: right mainstem. Left sounds absent, SpO2 falling, pressures up. Pull back.`);
      } else if (depth_cm < 22) {
        this.airway.patency_0_to_1 = 1;
        this.addLog("airway", `ETT ${size_mm} at ${depth_cm} cm: tracheal but shallow, high dislodge risk. Advance to 22-23.`);
      } else {
        this.airway.patency_0_to_1 = 1;
        this.addLog("airway", `ETT ${size_mm} at ${depth_cm} cm: tracheal. Confirm on waveform EtCO2, then secure it.`);
      }
    });
  }

  secureTube(): ActionResult {
    const ett = this.airway.ett;
    if (ett === null) return { ok: false, reason: "No tube to secure." };
    if (ett.secured) return { ok: false, reason: "Tube already secured." };
    return this.start("secure_ett", "Secure the ETT", 15, () => {
      const tube = this.airway.ett;
      if (tube !== null) tube.secured = true;
      this.addLog("airway", "ETT secured: holds through patient moves (unless shallow).");
    });
  }

  removeAirwayDevice(): ActionResult {
    if (this.airway.adjunct === null && this.airway.ett === null) {
      return { ok: false, reason: "No airway device to remove." };
    }
    const what =
      this.airway.ett !== null
        ? `ETT ${this.airway.ett.size_mm} (${this.airway.ett.placement})`
        : `${this.airway.adjunct?.kind} ${this.airway.adjunct?.size}`;
    this.airway.adjunct = null;
    this.airway.ett = null;
    this.airway.esophageal_s = 0;
    this.airway.mainstem_s = 0;
    this.airway.patency_0_to_1 = Math.max(this.airway.patency_0_to_1, 0.8);
    this.addLog("airway", `${what} removed. Reassess patency.`);
    return { ok: true };
  }

  checkTube(): ActionResult {
    const ett = this.airway.ett;
    if (ett === null) return { ok: false, reason: "No tube to check." };
    if (!this.monitor.etco2Attached) {
      return { ok: false, reason: "Attach waveform EtCO2 on the Monitor tab first: it is the only reliable confirmation." };
    }
    if (ett.placement === "esophageal") {
      this.airway.esophagealRecognized = true;
      this.addLog("trap", "EtCO2 check: NO waveform. The tube is esophageal. Pull it now.");
    } else if (ett.placement === "mainstem") {
      this.addLog("airway", "EtCO2 check: waveform present, but left sounds are absent. Right mainstem: pull back 2 cm.");
    } else {
      this.addLog("airway", "EtCO2 check: square waveform, value tracks perfusion. Tube confirmed tracheal.");
    }
    return { ok: true };
  }

  suctionAirway(site: "mouth" | "ett", seconds: number): ActionResult {
    if (seconds < 10 || seconds > 15) return { ok: false, reason: "Suction passes run 10-15 s max." };
    if (this.atPatient("suction_unit") < 1) return { ok: false, reason: "Need the suction unit at the patient." };
    if (site === "ett") {
      if (this.airway.ett === null) return { ok: false, reason: "No ETT to suction." };
      if (!this.take("suction_catheter_14fr")) {
        return { ok: false, reason: "Need a 14 Fr catheter for the ETT." };
      }
    }
    return this.start("suction", `Suction ${site} (${seconds}s)`, seconds, () => {
      this.airway.soiled = false;
      this.airway.patency_0_to_1 = Math.min(1, this.airway.patency_0_to_1 + 0.3);
      this.airway.suctionDip_pct = 4;
      this.addLog("airway", `Suction ${site} clear. Pass cost about -4 percent SpO2, recovers over a minute.`);
    });
  }

  // - Oct 29 O2 and BVM actions -

  applyO2(device: O2Device, flow_L_per_min: number, reservoirInflated: boolean, cpap_cmH2O: number, cpap_fio2: number): ActionResult {
    if (device === "none") return { ok: false, reason: "Pick an O2 device." };
    const item =
      device === "nasal_cannula"
        ? "nasal_cannula"
        : device === "simple_mask"
          ? "simple_mask"
          : device === "non_rebreather"
            ? "non_rebreather"
            : device === "cpap"
              ? "cpap_unit"
              : "bvm_adult";
    if (device === "bvm_reservoir") {
      if (this.atPatient("bvm_adult") < 1) return { ok: false, reason: "Need the BVM at the patient." };
    } else if (device === "cpap") {
      if (this.atPatient("cpap_unit") < 1) return { ok: false, reason: "No CPAP at the patient. Fetch it from the truck." };
    } else if (!this.take(item)) {
      return { ok: false, reason: `No ${device} at the patient.` };
    }
    if (this.atPatient("o2_tank_d") < 1 && this.o2.tankPsi <= 200 && this.atPatient("o2_tank_m") < 1) {
      return { ok: false, reason: "No O2 cylinder at the patient." };
    }
    return this.start("o2", `Apply ${device} at ${device === "cpap" ? cpap_cmH2O + " cmH2O" : flow_L_per_min + " L/min"}`, 20, () => {
      this.o2.device = device;
      this.o2.flow_L_per_min = flow_L_per_min;
      this.o2.reservoirInflated = reservoirInflated;
      this.o2.cpap_cmH2O = cpap_cmH2O;
      this.o2.cpap_fio2 = cpap_fio2;
      if (device === "non_rebreather" && !reservoirInflated) {
        this.addLog("trap", "NRB on with a deflated reservoir: the patient rebreathes. Pre-inflate it.");
      } else {
        this.addLog("airway", `${device} flowing. Tank ${Math.round(this.o2.tankPsi)} psi.`);
      }
    });
  }

  preinflateReservoir(): ActionResult {
    if (this.o2.device !== "non_rebreather") return { ok: false, reason: "No NRB on to pre-inflate." };
    if (this.o2.reservoirInflated) return { ok: false, reason: "Reservoir already inflated." };
    this.o2.reservoirInflated = true;
    this.addLog("airway", "NRB reservoir pre-inflated: now delivering 60-90 percent.");
    return { ok: true };
  }

  removeO2(): ActionResult {
    if (this.o2.device === "none") return { ok: false, reason: "No O2 device on." };
    this.o2.device = "none";
    this.o2.flow_L_per_min = 0;
    this.addLog("airway", "O2 device removed: back to room air.");
    return { ok: true };
  }

  swapTank(): ActionResult {
    if (!this.take("o2_tank_m")) {
      return { ok: false, reason: "No M cylinder at the patient. Fetch one from the truck." };
    }
    return this.start("tank_swap", "Swap to the M cylinder", 30, () => {
      this.o2.tankPsi = 2000;
      this.o2.tankFactor = 1.56;
      this.o2.tankEmptyWarned = false;
      this.addLog("airway", "M cylinder on (factor 1.56): tank math restarts at 2,000 psi.");
    });
  }

  setBvmMask(size: "small" | "medium" | "large"): ActionResult {
    this.bvm.maskSize = size;
    const fit = fitMask(size);
    if (fit === "correct") this.addLog("airway", "BVM mask large: seals.");
    else this.addLog("trap", `BVM mask ${size}: leaks, tidal volume x0.5.`);
    return { ok: true };
  }

  squeezeBvm(volume_mL: number): ActionResult {
    if (this.arrested) return { ok: false, reason: "Patient is in arrest." };
    if (this.atPatient("bvm_adult") < 1) return { ok: false, reason: "Need the BVM at the patient." };
    const delivered = Math.round(volume_mL * bvmDeliveryFactor(this.bvm.maskSize, this.airway.adjunct));
    this.bvm.breaths.push({ t_s: this.t_s, volume_mL });
    const rate = bvmRatePerMin(this.bvm, this.t_s);
    const over = rate > 12 || volume_mL > 600;
    if (over) {
      this.bvm.overventBreaths += 1;
      this.bvm.gastric_0_to_10 = Math.min(10, this.bvm.gastric_0_to_10 + 1);
      this.addLog(
        "trap",
        `Overventilation (rate ${rate}/min, ${volume_mL} mL set, ${delivered} mL delivered): ` +
          `gastric distension ${Math.round(this.bvm.gastric_0_to_10)}/10, SBP sagging.`
      );
      if (this.bvm.gastric_0_to_10 >= 10) {
        this.bvm.gastric_0_to_10 = 4;
        this.vomit("gastric distension from overventilation");
      }
    } else if (volume_mL < 500) {
      this.addLog("airway", `Shallow BVM breath (${delivered} mL delivered): ventilates poorly.`);
    }
    return { ok: true };
  }

  // - Oct 29 lines and fluids actions -

  startIv(site: "ac" | "forearm" | "hand", gauge: number): ActionResult {
    const flow = IV_GRAVITY_FLOW[gauge];
    if (flow === undefined) return { ok: false, reason: `No ${gauge}g catheter in the kit.` };
    if (!this.take(`iv_cath_${gauge}g`)) {
      return { ok: false, reason: `No ${gauge}g catheter at the patient.` };
    }
    return this.start("iv", `Start ${gauge}g IV (${site})`, 75, () => {
      const p = ivSuccessP({
        shock: this.effectiveLoss_pct() >= 15,
        darkOrRain: this.config.darkScene,
        largeGaugeSmallVein: isLargeGaugeSmallVein(gauge, site)
      });
      if (this.rng.chance(p)) {
        const id = this.fluids.nextLineId++;
        this.fluids.lines.push({
          id,
          kind: "iv",
          site,
          gauge,
          patent: true,
          infiltrated: false,
          placedAt_s: this.t_s,
          pressureBag: false,
          flow_mL_per_min: flow,
          bag: null,
          infused_mL: 0,
          ioLidoGiven: false
        });
        this.addLog("fluid", `IV ${gauge}g ${site} in, flash confirmed. Gravity ${flow} mL/min.`);
      } else {
        this.addLog("trap", `IV ${gauge}g ${site} missed (${Math.round(p * 100)} percent shot). Try again or go IO.`);
      }
    });
  }

  startIo(site: "tibial" | "humeral", needle_mm: number, lidoFirst: boolean): ActionResult {
    if (this.atPatient("io_drill_ezio") < 1) return { ok: false, reason: "Need the EZ-IO drill at the patient." };
    if (!this.take(`io_needle_${needle_mm}mm`)) {
      return { ok: false, reason: `No ${needle_mm} mm needle at the patient.` };
    }
    if (!ioNeedleOk(site, needle_mm)) {
      const want = site === "tibial" ? "25 mm" : "45 mm";
      return { ok: false, reason: `${needle_mm} mm is the wrong needle for ${site} (Josh needs ${want}).` };
    }
    return this.start("io", `Start IO ${site} (${needle_mm} mm)`, 30, () => {
      if (!this.rng.chance(0.95)) {
        this.addLog("trap", `IO ${site} missed (5 percent miss). Reposition and try again.`);
        return;
      }
      const id = this.fluids.nextLineId++;
      const range = site === "humeral" ? IO_FLOW.humeral : IO_FLOW.tibial;
      const pressureFlow = Math.round(this.rng.range(range[0], range[1]));
      this.fluids.lines.push({
        id,
        kind: "io",
        site,
        needle_mm,
        patent: true,
        infiltrated: false,
        placedAt_s: this.t_s,
        pressureBag: false,
        flow_mL_per_min: IO_FLOW.gravity,
        bag: null,
        infused_mL: 0,
        ioLidoGiven: lidoFirst
      });
      this.addLog(
        "fluid",
        `IO ${site} in (${needle_mm} mm). Gravity poor (${IO_FLOW.gravity} mL/min); ` +
          `with a pressure bag about ${pressureFlow} mL/min.`
      );
      // Remember the rolled pressure flow for applyPressureBag.
      this.ioPressureFlows.set(id, pressureFlow);
      if (!lidoFirst && this.vitals.gcs_total >= 14) {
        this.pain_0_to_10 = 10;
        this.addLog("trap", "IO flushed in a conscious patient with no lidocaine 40 mg first: pain 10/10.");
      } else if (lidoFirst) {
        this.addLog("fluid", "Lidocaine 40 mg IO before the flush (drug box).");
      }
    });
  }

  applyPressureBag(lineId: number): ActionResult {
    if (this.atPatient("pressure_bag_300") < 1) {
      return { ok: false, reason: "No pressure bag at the patient." };
    }
    const line = this.fluids.lines.find((l) => l.id === lineId);
    if (line === undefined) return { ok: false, reason: `No line ${lineId}.` };
    if (!line.patent || line.infiltrated) return { ok: false, reason: `Line ${lineId} is not running.` };
    for (const other of this.fluids.lines) {
      if (other.id !== lineId && other.pressureBag) {
        other.pressureBag = false;
        this.refreshLineFlow(other);
      }
    }
    line.pressureBag = true;
    this.refreshLineFlow(line);
    this.addLog("fluid", `Pressure bag (300 mmHg) on line ${lineId}: now ${Math.round(line.flow_mL_per_min)} mL/min.`);
    return { ok: true };
  }

  private refreshLineFlow(line: LineState): void {
    if (line.kind === "iv" && line.gauge !== undefined) {
      const base = IV_GRAVITY_FLOW[line.gauge] ?? 60;
      line.flow_mL_per_min = line.pressureBag ? base * PRESSURE_BAG_X : base;
    } else if (line.kind === "io") {
      line.flow_mL_per_min = line.pressureBag ? (this.ioPressureFlows.get(line.id) ?? 55) : IO_FLOW.gravity;
    }
  }

  hangFluids(lineId: number, fluid: "ns" | "lr" | "blood", drip: string): ActionResult {
    const line = this.fluids.lines.find((l) => l.id === lineId);
    if (line === undefined) return { ok: false, reason: `No line ${lineId}.` };
    if (!line.patent || line.infiltrated) return { ok: false, reason: `Line ${lineId} is not running.` };
    if (line.bag !== null) return { ok: false, reason: `Line ${lineId} already has a bag hanging.` };
    const bagItem = fluid === "ns" ? "ns_1000ml" : fluid === "lr" ? "lr_1000ml" : "whole_blood_unit";
    if (!this.take(bagItem)) return { ok: false, reason: `No ${fluid} bag at the patient.` };
    if (fluid === "blood") {
      if (!this.take("blood_tubing_filter")) {
        return { ok: false, reason: "Blood needs blood tubing with a filter. Fetch it from the truck." };
      }
      if (this.atPatient("fluid_warmer") < 1) {
        return { ok: false, reason: "Blood needs the warmer at 38 C. Fetch it from the truck." };
      }
    } else if (!this.take(drip === "micro60" ? "micro_drip_set" : "macro_drip_set")) {
      return { ok: false, reason: "No drip set at the patient." };
    }
    const what = fluid === "blood" ? "whole blood (500 mL)" : `${fluid.toUpperCase()} 1,000 mL`;
    return this.start("hang", `Hang ${what} on line ${lineId}`, 30, () => {
      const target = this.fluids.lines.find((l) => l.id === lineId);
      if (target === undefined || !target.patent || target.infiltrated) {
        this.addLog("trap", `Line ${lineId} went bad while hanging the bag. Bag wasted.`);
        return;
      }
      target.bag = {
        fluid,
        volumeTotal_mL: fluid === "blood" ? 500 : 1000,
        volumeLeft_mL: fluid === "blood" ? 500 : 1000,
        drip
      };
      this.refreshLineFlow(target);
      this.addLog(
        "fluid",
        `${what} hanging on line ${lineId} at ${Math.round(target.flow_mL_per_min)} mL/min` +
          `${target.pressureBag ? " (pressure bag)" : " (gravity)"}.`
      );
    });
  }

  pullLine(lineId: number): ActionResult {
    const index = this.fluids.lines.findIndex((l) => l.id === lineId);
    if (index < 0) return { ok: false, reason: `No line ${lineId}.` };
    const line = this.fluids.lines[index];
    if (line?.bag !== null && line?.bag !== undefined) {
      this.addLog("fluid", `Line ${lineId} pulled with ${Math.round(line.bag.volumeLeft_mL)} mL still in the bag: bag wasted.`);
    } else {
      this.addLog("fluid", `Line ${lineId} pulled.`);
    }
    this.fluids.lines.splice(index, 1);
    this.ioPressureFlows.delete(lineId);
    return { ok: true };
  }

  // - Oct 29 drug prep loop (minimal: pick, prep, push at the standard dose) -

  prepPush(drugId: string, presIndex: number, amount: number, syringeId: string, lineId: number | null): ActionResult {
    const catalog = drugCatalog();
    const entry = catalog.usable.find((u) => u.drug.id === drugId);
    if (entry === undefined) {
      if (catalog.noDose.includes(drugId)) {
        return { ok: false, reason: `${drugId} has no single standard dose in drugs.json: unusable in this build (see TODO_CLINICAL).` };
      }
      return { ok: false, reason: `${drugId} has no token mapping in this build: unusable (see TODO_CLINICAL).` };
    }
    const pres = entry.presentations.find((p) => p.index === presIndex);
    if (pres === undefined) return { ok: false, reason: "That presentation has no computable concentration." };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "Draw a positive amount." };
    if (pres.math.maxUnits !== null && amount > pres.math.maxUnits * 4) {
      return { ok: false, reason: `That is more than 4 ${pres.math.unitLabel === "mL" ? "vials" : "units"} worth: split the prep.` };
    }
    if (!this.take(syringeId)) return { ok: false, reason: `No ${syringeId} at the patient.` };
    const routeUpper = entry.standard.route.toUpperCase();
    const needsLine = routeUpper.startsWith("IV") || routeUpper.startsWith("IO");
    let line: LineState | null = null;
    if (needsLine) {
      const candidates = this.fluids.lines.filter((l) => l.patent && !l.infiltrated);
      if (candidates.length === 0) return { ok: false, reason: "IV/IO push needs a patent line. Start one first." };
      line = lineId === null ? null : (candidates.find((l) => l.id === lineId) ?? null);
      if (line === null) return { ok: false, reason: "Pick which line to push through." };
    }
    const doseMcg = amount * pres.math.mcgPer;
    const ratio = doseMcg / entry.standard.mcg;
    const lineNote = line !== null ? ` via line ${line.id}` : "";
    return this.start("drug", `Prep and push ${entry.drug.name} (${formatDose(doseMcg)} ${entry.standard.route}${lineNote})`, 45, () => {
      const push: ActiveDrug = {
        drugId: entry.drug.id,
        givenAt_s: this.t_s,
        ratio_to_standard: Math.round(ratio * 100) / 100,
        route: entry.standard.route,
        onset_s: entry.pk_s[0],
        peak_s: entry.pk_s[1],
        duration_s: entry.pk_s[2],
        tokens: entry.tokens,
        toxic: ratio > 2
      };
      this.drugs.active.push(push);
      if (ratio > 2) {
        const dangers = entry.drug.dangers ?? ["unspecified toxicity"];
        for (const danger of dangers) {
          this.drugs.flags.push(`${entry.drug.id}: ${danger}`);
        }
        this.addLog(
          "trap",
          `${entry.drug.name} ${formatDose(doseMcg)} is ${push.ratio_to_standard}x standard: TOXICITY. ` +
            `Effects capped at 2x. Flags: ${dangers.join(" / ")}`
        );
      } else {
        this.addLog(
          "drug",
          `${entry.drug.name} ${formatDose(doseMcg)} ${entry.standard.route}${lineNote} pushed ` +
            `(${push.ratio_to_standard}x standard). Peak in ${entry.pk_s[1]}s.`
        );
      }
    });
  }

  // - Oct 29 manual vitals and monitor actions -

  checkPulse(): ActionResult {
    const irregular = this.vitals.rhythm === "bradycardic" || this.vitals.rhythm === "pea";
    const seconds = irregular ? 60 : 20;
    return this.start("exam_pulse", `Take pulse (${seconds}s)`, seconds, () => {
      const point = pulsePointForSbp(this.vitals.sbp_mmhg);
      if (point === "none") {
        this.observed.hr = { value: "no pulse palpable", t_s: this.t_s, method: "carotid absent below ~60" };
        this.addLog("exam", "Pulse: no carotid pulse palpable.");
      } else {
        const read = pulseRead(this.vitals.hr_bpm);
        this.observed.hr = { value: `${read}`, t_s: this.t_s, method: `${point}, 30s x 2${irregular ? ", full 60s" : ""}` };
        this.addLog("exam", `Pulse ${read} (${point}).`);
      }
    });
  }

  checkRR(): ActionResult {
    return this.start("exam_rr", "Count RR (30s)", 30, () => {
      const aware = this.t_s - this.lastTalkAt_s < 120;
      const read = rrRead(this.vitals.rr_per_min, aware);
      this.observed.rr = { value: `${read}`, t_s: this.t_s, method: aware ? "chest rise (patient aware, +4)" : "chest rise 30s x 2" };
      this.addLog("exam", `RR ${read}${aware ? " (patient knew you were watching: +4)." : "."}`);
    });
  }

  checkBpAusc(cuff: CuffFit, deflateFast: boolean): ActionResult {
    const item = cuff === "correct" ? "bp_cuff_adult" : cuff === "small" ? "bp_cuff_peds" : "bp_cuff_large";
    if (this.atPatient(item) < 1) return { ok: false, reason: `Need ${item} at the patient.` };
    if (this.atPatient("stethoscope") < 1) return { ok: false, reason: "Need the stethoscope at the patient." };
    return this.start("exam_bp", "Auscultated BP (50s)", 50, () => {
      const read = bpAuscultatedRead(this.rng, this.vitals.sbp_mmhg, this.vitals.dbp_mmhg, cuff, deflateFast, this.config.roadside);
      if ("inaudible" in read) {
        this.observed.sbp = { value: "inaudible", t_s: this.t_s, method: "auscultated, roadside noise" };
        this.observed.dbp = { value: "inaudible", t_s: this.t_s, method: "auscultated, roadside noise" };
        this.addLog("exam", "Auscultated BP: inaudible over roadside noise. Fall back to palpated BP.");
      } else {
        this.observed.sbp = { value: `${read.sbp}`, t_s: this.t_s, method: "auscultated" };
        this.observed.dbp = { value: `${read.dbp}`, t_s: this.t_s, method: "auscultated" };
        this.addLog("exam", `BP ${read.sbp}/${read.dbp}. ${read.note}`);
      }
    });
  }

  checkBpPalp(): ActionResult {
    if (this.atPatient("bp_cuff_adult") < 1) return { ok: false, reason: "Need a BP cuff at the patient." };
    return this.start("exam_bpp", "Palpated BP (30s)", 30, () => {
      if (pulsePointForSbp(this.vitals.sbp_mmhg) === "none" || this.vitals.sbp_mmhg < 80) {
        this.observed.sbp = { value: "radial absent", t_s: this.t_s, method: "palpated, SBP below ~80" };
        this.addLog("exam", "Palpated BP: no radial to feel. SBP below ~80.");
        return;
      }
      const read = bpPalpatedRead(this.vitals.sbp_mmhg);
      this.observed.sbp = { value: `${read}`, t_s: this.t_s, method: "palpated (SBP only, ~10 low)" };
      this.addLog("exam", `Palpated SBP ${read} (reads about 10 low).`);
    });
  }

  runNibp(): ActionResult {
    if (this.atPatient("monitor_defib") < 1) return { ok: false, reason: "Need the monitor at the patient." };
    this.monitor.movedDuringNibp = false;
    return this.start("nibp", "NIBP auto cycle (40s)", 40, () => {
      const irregular = this.vitals.rhythm === "bradycardic" || this.vitals.rhythm === "pea";
      const read = nibpRead(this.vitals.sbp_mmhg, this.vitals.dbp_mmhg, this.monitor.movedDuringNibp, irregular);
      if ("failed" in read) {
        this.observed.sbp = { value: "---", t_s: this.t_s, method: "NIBP failed" };
        this.addLog("exam", `NIBP: ${read.failed}`);
      } else {
        this.observed.sbp = { value: `${read.sbp}`, t_s: this.t_s, method: "NIBP" };
        this.observed.dbp = { value: `${read.dbp}`, t_s: this.t_s, method: "NIBP" };
        this.addLog("exam", `NIBP ${read.sbp}/${read.dbp}.`);
      }
    });
  }

  attachSpo2(): ActionResult {
    if (this.monitor.spo2Attached) return { ok: false, reason: "SpO2 probe already on." };
    if (this.atPatient("monitor_defib") < 1) return { ok: false, reason: "Need the monitor at the patient." };
    this.monitor.spo2Attached = true;
    this.addLog("exam", "SpO2 probe on the finger: monitor reads with a 30 s lag.");
    return { ok: true };
  }

  readSpo2(): ActionResult {
    if (!this.monitor.spo2Attached) return { ok: false, reason: "Put the SpO2 probe on first." };
    return this.start("exam_spo2", "Read SpO2 (15s)", 15, () => {
      const target = this.t_s - 30;
      let lagged = this.vitals.spo2_pct;
      for (const entry of this.monitor.spo2History) {
        if (entry.t_s <= target) lagged = entry.value;
        else break;
      }
      const unreliable = this.effectiveLoss_pct() > 30 || this.temp_C < 35;
      const read = spo2Read(this.rng, lagged, unreliable);
      if ("none" in read) {
        this.observed.spo2 = { value: "no reading", t_s: this.t_s, method: "probe, shock/cold" };
        this.addLog("exam", `SpO2: ${read.none}`);
      } else {
        this.observed.spo2 = { value: `${read.value}`, t_s: this.t_s, method: "probe, 30s lag" };
        this.addLog("exam", `SpO2 ${read.value}. ${read.note}`);
      }
    });
  }

  attachEtco2(): ActionResult {
    if (this.monitor.etco2Attached) return { ok: false, reason: "EtCO2 already attached." };
    if (this.atPatient("waveform_etco2") < 1) return { ok: false, reason: "Need the EtCO2 module at the patient." };
    if (this.atPatient("monitor_defib") < 1) return { ok: false, reason: "Need the monitor at the patient." };
    this.monitor.etco2Attached = true;
    this.addLog("exam", "Waveform EtCO2 attached: the only reliable ETT confirmation.");
    return { ok: true };
  }

  checkCapRefill(): ActionResult {
    return this.start("exam_cr", "Cap refill (8s)", 8, () => {
      const read = capRefillRead(this.rng, this.vitals.capRefill_s, this.config.roadside && this.temp_C < 36.5);
      this.observed.capRefill = { value: `${read} s`, t_s: this.t_s, method: "nail bed press" };
      this.addLog("exam", `Cap refill ${read} s.`);
    });
  }

  checkPupils(): ActionResult {
    if (this.atPatient("penlight") < 1) return { ok: false, reason: "Need the penlight at the patient." };
    return this.start("exam_pupil", "Pupil check (10s)", 10, () => {
      this.observed.pupils = { value: "4 mm, equal, reactive", t_s: this.t_s, method: "penlight each eye + consensual" };
      this.addLog("exam", "Pupils 4 mm, equal, reactive. (Engine has no pupil drug model yet.)");
    });
  }

  checkGlucose(): ActionResult {
    if (this.atPatient("glucometer") < 1) return { ok: false, reason: "Need the glucometer at the patient." };
    return this.start("exam_glu", "Fingerstick glucose (12s)", 12, () => {
      const shock = this.effectiveLoss_pct() > 30;
      const read = glucoseRead(this.rng, this.vitals.glucose_mg_per_dL, shock);
      this.observed.glucose = { value: `${read.value}`, t_s: this.t_s, method: "fingerstick" };
      this.addLog("exam", `Glucose ${read.value} mg/dL. ${read.note}`);
    });
  }

  checkTemp(method: "tympanic" | "oral" | "temporal"): ActionResult {
    if (this.atPatient("thermometer") < 1) return { ok: false, reason: "Need the thermometer at the patient." };
    return this.start("exam_temp", `Temperature ${method} (15s)`, 15, () => {
      const coldOrSweaty = this.temp_C < 36.5 || this.effectiveLoss_pct() >= 15;
      const read = tempRead(this.rng, this.vitals.temp_C, method, coldOrSweaty);
      this.observed.temp = { value: `${read.value} C`, t_s: this.t_s, method };
      this.addLog("exam", `Temp ${read.value} C (${method}). ${read.note}`);
    });
  }

  checkSkin(): ActionResult {
    return this.start("exam_skin", "Skin check (5s)", 5, () => {
      this.observed.skin = { value: this.vitals.skin, t_s: this.t_s, method: "look + touch" };
      this.addLog("exam", `Skin: ${this.vitals.skin}.`);
    });
  }

  checkLungs(): ActionResult {
    if (this.atPatient("stethoscope") < 1) return { ok: false, reason: "Need the stethoscope at the patient." };
    return this.start("exam_lung", "Lung sounds (25s)", 25, () => {
      const mainstem = this.airway.ett?.placement === "mainstem";
      const value = mainstem ? "right present, LEFT ABSENT" : "equal bilateral, no wheeze";
      this.observed.lungs = { value, t_s: this.t_s, method: "4 sites, roadside noise" };
      this.addLog("exam", `Lungs: ${value} (roadside noise).${mainstem ? " Mainstem until proven otherwise." : ""}`);
    });
  }

  checkGcs(): ActionResult {
    return this.start("exam_gcs", "GCS assess (20s)", 20, () => {
      const confound = this.vitals.pain_0_to_10 >= 7 ? " Pain confounds the verbal score." : "";
      this.observed.gcs = { value: this.vitals.gcs_text, t_s: this.t_s, method: "eyes/verbal/motor" };
      this.addLog("exam", `GCS ${this.vitals.gcs_text}.${confound}`);
    });
  }
}
