// Physiology derivation: loss percent -> vitals via the Oct 28 shock anchors.
// Linear interpolation between rows, then the compensation order falls out of
// the anchor values themselves: HR first, pulse pressure narrows while SBP
// holds, RR rises, mental status declines, SBP falls late, radial is lost,
// then decompensation (HR falls) into PEA. All numbers from physiology.json.

import type { AtlsClass, RadialPulse, Rhythm, ShockFlag, Vitals } from "./types";

export const BLOOD_VOLUME_ML = 5600;
export const BASELINE_MAP = 93;
export const FEMORAL_BASE_ML_PER_MIN = 700;

interface Anchor {
  loss_pct: number;
  hr: number;
  sbp: number;
  dbp: number;
  rr: number;
  gcs: number;
  capRefill_s: number;
}

// Mirrors physiology.json shockClasses.interpolationAnchors_TUNE rows 0-50.
// The 55+ row (pre-arrest) is handled by the decomp segment below.
const ANCHORS: Anchor[] = [
  { loss_pct: 0, hr: 76, sbp: 124, dbp: 78, rr: 14, gcs: 15, capRefill_s: 1.5 },
  { loss_pct: 15, hr: 100, sbp: 122, dbp: 86, rr: 20, gcs: 15, capRefill_s: 2.5 },
  { loss_pct: 30, hr: 122, sbp: 108, dbp: 88, rr: 28, gcs: 14, capRefill_s: 3.5 },
  { loss_pct: 40, hr: 140, sbp: 82, dbp: 64, rr: 36, gcs: 12, capRefill_s: 5.0 },
  { loss_pct: 50, hr: 150, sbp: 60, dbp: 40, rr: 40, gcs: 8, capRefill_s: 6.5 }
];

// Decompensation endpoints at 55 percent: HR falls before arrest, RR goes
// agonal, GCS bottoms out. Bradycardia here is ominous, not improvement.
const DECOMP = { hr: 45, sbp: 38, dbp: 25, rr: 6, gcs: 3, capRefill_s: 8.0 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolate(loss_pct: number): Anchor {
  if (loss_pct <= 0) return { ...ANCHORS[0] };
  const last = ANCHORS[ANCHORS.length - 1];
  if (loss_pct >= 55) {
    return {
      loss_pct,
      hr: DECOMP.hr,
      sbp: DECOMP.sbp,
      dbp: DECOMP.dbp,
      rr: DECOMP.rr,
      gcs: DECOMP.gcs,
      capRefill_s: DECOMP.capRefill_s
    };
  }
  if (loss_pct >= 50) {
    const t = (loss_pct - 50) / 5;
    return {
      loss_pct,
      hr: lerp(last.hr, DECOMP.hr, t),
      sbp: lerp(last.sbp, DECOMP.sbp, t),
      dbp: lerp(last.dbp, DECOMP.dbp, t),
      rr: lerp(last.rr, DECOMP.rr, t),
      gcs: lerp(last.gcs, DECOMP.gcs, t),
      capRefill_s: lerp(last.capRefill_s, DECOMP.capRefill_s, t)
    };
  }
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const lo = ANCHORS[i];
    const hi = ANCHORS[i + 1];
    if (loss_pct >= lo.loss_pct && loss_pct <= hi.loss_pct) {
      const t = (loss_pct - lo.loss_pct) / (hi.loss_pct - lo.loss_pct);
      return {
        loss_pct,
        hr: lerp(lo.hr, hi.hr, t),
        sbp: lerp(lo.sbp, hi.sbp, t),
        dbp: lerp(lo.dbp, hi.dbp, t),
        rr: lerp(lo.rr, hi.rr, t),
        gcs: lerp(lo.gcs, hi.gcs, t),
        capRefill_s: lerp(lo.capRefill_s, hi.capRefill_s, t)
      };
    }
  }
  return { ...last };
}

export function atlsClass(loss_pct: number): AtlsClass {
  if (loss_pct < 15) return "I";
  if (loss_pct < 30) return "II";
  if (loss_pct < 40) return "III";
  return "IV";
}

export function shockFlagFor(si: number): ShockFlag {
  if (si > 1.4) return "severe";
  if (si > 1.0) return "shock";
  if (si > 0.9) return "caution";
  return "normal";
}

/** Engine rule only, not a teaching claim: radial fades as SBP falls. */
export function radialForSbp(sbp: number): RadialPulse {
  if (sbp >= 110) return "Strong";
  if (sbp >= 85) return "Weak";
  if (sbp >= 70) return "Thready / intermittent";
  return "Absent";
}

function skinFor(loss_pct: number): string {
  if (loss_pct < 15) return "Normal, warm, dry";
  if (loss_pct < 30) return "Pale, cool";
  if (loss_pct < 40) return "Pale, cool, diaphoretic";
  return "Cold, mottled, ashen";
}

function mentalFor(loss_pct: number): string {
  if (loss_pct < 15) return "Alert, slightly anxious";
  if (loss_pct < 30) return "Mildly anxious";
  if (loss_pct < 40) return "Anxious, confused";
  if (loss_pct < 50) return "Confused, lethargic";
  return "Unresponsive, peri-arrest";
}

function gcsTextFor(gcs: number): string {
  if (gcs >= 15) return "E4 V5 M6 (15)";
  if (gcs >= 14) return "E4 V4 M6 (14)";
  if (gcs >= 13) return "E3 V4 M6 (13)";
  if (gcs >= 12) return "E3 V4 M5 (12)";
  if (gcs >= 10) return "E3 V3 M4 (10)";
  if (gcs >= 8) return "E2 V2 M4 (8)";
  if (gcs >= 6) return "E2 V1 M3 (6)";
  if (gcs >= 4) return "E1 V1 M2 (4)";
  return "E1 V1 M1 (3)";
}

export interface Oct29AirwayInput {
  patency_0_to_1: number;
  fio2_0_to_1: number;
  /** Summed SpO2 penalties: patency loss, aspiration, esophageal/mainstem clocks, suction dip. */
  spo2Penalty_pct: number;
  /** SpO2 bonus from supplemental FiO2 (TUNE coupling). */
  spo2Bonus_pct: number;
  /** EtCO2 delta: patency rise, overvent drop, rebreathe rise. */
  etco2Delta_mmhg: number;
  /** Esophageal ETT forces EtCO2 to 0 with no waveform. Null = use derived. */
  etco2Override_mmhg: number | null;
  etco2Waveform: boolean;
  /** SBP drop from overventilation (TUNE coupling). */
  overventSbpDrop_mmhg: number;
}

export interface Oct29DrugInput {
  hr_bpm: number;
  sbp_mmhg: number;
  rr_per_min: number;
  spo2_pct: number;
  gcs_points: number;
  pain_0_to_10: number;
  glucose_mg_per_dL: number;
  /** 0-1 apnea factor: spontaneous RR scales by (1 - apnea). */
  apnea_0_to_1: number;
}

export interface DeriveInput {
  loss_mL: number;
  /** Crash stress offset active (fades with analgesia, Oct 29 drugs). */
  stressActive: boolean;
  /** Beta-blocker comorbidity: suppress HR rise 60 percent (TUNE). */
  betaBlocked: boolean;
  temp_C: number;
  pain_0_to_10: number;
  arrested: boolean;
  /** Oct 29: loss minus retained fluids. Defaults to loss_mL (Oct 28 path). */
  effectiveLoss_mL?: number;
  airway?: Oct29AirwayInput;
  drugs?: Oct29DrugInput;
}

export function deriveVitals(input: DeriveInput): Vitals {
  // Displayed loss is blood on the ground; the anchors run on EFFECTIVE loss
  // (loss minus retained fluids). With no fluids they are identical, so the
  // Oct 28 curve, the 35 percent slip and the linear 50-55 decomp segment are
  // untouched.
  const loss_pct = (input.loss_mL / BLOOD_VOLUME_ML) * 100;
  const effLoss_mL = input.effectiveLoss_mL ?? input.loss_mL;
  const eff_pct = (Math.max(0, effLoss_mL) / BLOOD_VOLUME_ML) * 100;
  const a = interpolate(eff_pct);
  const drug = input.drugs ?? {
    hr_bpm: 0,
    sbp_mmhg: 0,
    rr_per_min: 0,
    spo2_pct: 0,
    gcs_points: 0,
    pain_0_to_10: 0,
    glucose_mg_per_dL: 0,
    apnea_0_to_1: 0
  };

  let hr = a.hr;
  let rr = a.rr;
  let sbp = a.sbp;
  if (input.stressActive) {
    hr += 15;
    rr += 4;
    sbp += 10;
  }
  if (input.betaBlocked) {
    // Suppress only the rise above baseline, not the baseline itself.
    const rise = Math.max(0, hr - 76);
    hr = 76 + rise * 0.4;
  }
  // Oct 29 drug offsets apply after the shock curve and masking.
  hr += drug.hr_bpm;
  rr += drug.rr_per_min;
  sbp += drug.sbp_mmhg;
  rr *= 1 - Math.min(1, Math.max(0, drug.apnea_0_to_1));

  const airway = input.airway;
  sbp -= airway?.overventSbpDrop_mmhg ?? 0;

  const dbp = a.dbp;
  const map = dbp + (sbp - dbp) / 3;
  // SpO2 holds until late shock, then slides. EtCO2 falls as perfusion fails.
  let spo2 = Math.max(60, 98 - Math.max(0, eff_pct - 30) * 0.15);
  spo2 = spo2 - (airway?.spo2Penalty_pct ?? 0) + (airway?.spo2Bonus_pct ?? 0) + drug.spo2_pct;
  spo2 = Math.min(100, Math.max(0, spo2));
  let etco2 = Math.max(10, 38 - Math.max(0, eff_pct - 15) * 0.25);
  etco2 += airway?.etco2Delta_mmhg ?? 0;
  if (airway?.etco2Override_mmhg !== undefined && airway.etco2Override_mmhg !== null) {
    etco2 = airway.etco2Override_mmhg;
  }
  etco2 = Math.max(0, etco2);
  const gcs_total = Math.round(Math.min(15, Math.max(3, a.gcs + drug.gcs_points)));
  const pain = Math.round(Math.min(10, Math.max(0, input.pain_0_to_10 + drug.pain_0_to_10)));
  const glucose = Math.round(95 + drug.glucose_mg_per_dL);
  const fio2 = airway?.fio2_0_to_1 ?? 0.21;
  const patency = airway?.patency_0_to_1 ?? 1;
  const retained = Math.max(0, input.loss_mL - Math.max(0, effLoss_mL));
  const circulating = Math.round(BLOOD_VOLUME_ML - input.loss_mL + retained);

  let rhythm: Rhythm = "sinus";
  if (input.arrested) rhythm = "pea";
  else if (eff_pct >= 50) rhythm = "bradycardic";
  else if (hr > 100) rhythm = "sinus_tach";

  const shockIndex = sbp > 0 ? hr / sbp : 9.9;

  if (input.arrested) {
    return {
      hr_bpm: 0,
      sbp_mmhg: 0,
      dbp_mmhg: 0,
      map_mmhg: 0,
      rr_per_min: 0,
      spo2_pct: 0,
      etco2_mmhg: 0,
      gcs_total: 3,
      gcs_text: "E1 V1 M1 (3)",
      capRefill_s: 9,
      capRefill_text: "Absent, mottled",
      radial: "Absent",
      skin: "Cold, mottled, ashen",
      mental: "PEA arrest",
      temp_C: input.temp_C,
      pain_0_to_10: 0,
      glucose_mg_per_dL: glucose,
      fio2_0_to_1: Math.round(fio2 * 100) / 100,
      etco2Waveform: false,
      airwayPatency_0_to_1: Math.round(patency * 100) / 100,
      circulating_mL: circulating,
      rhythm,
      shockIndex: 9.9,
      shockFlag: "severe",
      atlsClass: atlsClass(eff_pct),
      loss_mL: Math.round(input.loss_mL),
      loss_pct: Math.round(loss_pct * 10) / 10,
      pulsePressure_mmhg: 0,
      arrested: true
    };
  }

  return {
    hr_bpm: Math.round(hr),
    sbp_mmhg: Math.round(sbp),
    dbp_mmhg: Math.round(dbp),
    map_mmhg: Math.round(map * 10) / 10,
    rr_per_min: Math.round(Math.max(0, rr)),
    spo2_pct: Math.round(spo2),
    etco2_mmhg: Math.round(etco2),
    gcs_total,
    gcs_text: gcsTextFor(gcs_total),
    capRefill_s: Math.round(a.capRefill_s * 10) / 10,
    capRefill_text:
      a.capRefill_s > 6
        ? `over 6 s, mottled`
        : `${(Math.round(a.capRefill_s * 10) / 10).toFixed(1)} s`,
    radial: radialForSbp(sbp),
    skin: skinFor(eff_pct),
    mental: mentalFor(eff_pct),
    temp_C: Math.round(input.temp_C * 10) / 10,
    pain_0_to_10: pain,
    glucose_mg_per_dL: glucose,
    fio2_0_to_1: Math.round(fio2 * 100) / 100,
    etco2Waveform: airway?.etco2Waveform ?? false,
    airwayPatency_0_to_1: Math.round(patency * 100) / 100,
    circulating_mL: circulating,
    rhythm,
    shockIndex: Math.round(shockIndex * 100) / 100,
    shockFlag: shockFlagFor(shockIndex),
    atlsClass: atlsClass(eff_pct),
    loss_mL: Math.round(input.loss_mL),
    loss_pct: Math.round(loss_pct * 10) / 10,
    pulsePressure_mmhg: Math.round(sbp - dbp),
    arrested: false
  };
}

/** Blood pool radius in meters from cumulative loss. Area grows with mL. */
export function bloodPoolRadius_m(loss_mL: number): number {
  const r = 0.1 * Math.sqrt(Math.max(0, loss_mL) / 100);
  return Math.min(0.95, Math.max(0.05, r));
}
