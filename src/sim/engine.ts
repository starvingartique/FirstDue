// Physiology engine: 1 sim-second tick, single source of truth for vitals,
// bleeding, hemorrhage control, inventory and event log. No LLM ever touches
// these numbers. Deterministic per seed. All clinical values come from the
// Oct 28 data files; TUNE tags from the answers file stay in the data.

import { Rng } from "./rng";
import { deriveVitals, BASELINE_MAP, FEMORAL_BASE_ML_PER_MIN, BLOOD_VOLUME_ML } from "./physiology";
import type {
  AtlsClass,
  DressingState,
  FetchJob,
  Holder,
  LogEvent,
  PackingState,
  PendingAction,
  PressureState,
  ShockFlag,
  TqState,
  Vitals
} from "./types";

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

export interface SecondTqOptions {
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

const TOOL_ITEMS = new Set(["trauma_shears", "sharpie_tq_time"]);

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
      // PEA: clock runs, nothing recovers. No CPR on Oct 28.
      this.t_s += 1;
      this.finishPending();
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

    // Bleed accrues at the controlled rate. MAP from last tick keeps the
    // pressure scaling causal: the bleed slows as he crashes.
    const ratePerMin = this.bleedRate_mL_per_min();
    this.loss_mL += ratePerMin / 60;

    // Hypothermia slide: -0.5 C per 10 min exposed and wet (TUNE).
    const slide = this.wetClothing && !this.wrapped ? 1 : this.wetClothing || !this.wrapped ? 0.5 : 0;
    this.temp_C -= (0.5 / 600) * slide;

    this.vitals = this.derive();
    this.lastMap = this.vitals.map_mmhg;

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
    // forced at 58 percent (TUNE).
    const loss_pct = (this.loss_mL / BLOOD_VOLUME_ML) * 100;
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
      arrested: this.arrested
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
    this.fetches.push({ itemId, remaining_s: seconds, total_s: seconds, runner });
    this.addLog("fetch", `${runner} to the truck for ${itemId} (${seconds}s round trip).`);
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
    // Standard blanket; the Oct 29 kit depth adds it to equipment.json.
    return this.start("wrap", "Wrap for hypothermia", 30, () => {
      this.wrapped = true;
      this.addLog("action", "Patient wrapped. Hypothermia slide cut.");
    });
  }
}
