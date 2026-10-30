// F1 debug overlay. LIVE engine values, refreshed every sim-second while open.
// Hidden truth: the player learns findings only through assessment, but F1
// shows true state for development and demo purposes.

import type { Sim } from "../sim/engine";

function fmtClock(t_s: number): string {
  const m = Math.floor(t_s / 60);
  const s = t_s % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export class DebugOverlay {
  private overlay: HTMLElement;
  private vitals: HTMLElement;
  private timer: number | null = null;

  constructor(private readonly sim: Sim) {
    const overlay = document.getElementById("debug-overlay");
    const vitals = document.getElementById("debug-vitals");
    if (overlay === null || vitals === null) {
      throw new Error("missing debug overlay nodes in index.html");
    }
    this.overlay = overlay;
    this.vitals = vitals;
    this.render();
  }

  toggle(): void {
    const hidden = this.overlay.hidden;
    this.overlay.hidden = !hidden;
    if (hidden) {
      this.render();
      this.timer = window.setInterval(() => this.render(), 1000);
    } else if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private render(): void {
    const v = this.sim.vitals;
    const s = this.sim;
    const airway = s.airway.ett !== null
      ? `ETT ${s.airway.ett.size_mm}/${s.airway.ett.depth_cm} ${s.airway.ett.placement}`
      : s.airway.adjunct !== null
        ? `${s.airway.adjunct.kind} ${s.airway.adjunct.size}`
        : "none";
    const rows: [string, string][] = [
      ["T+ contact", fmtClock(this.sim.t_s)],
      ["HR", `${v.hr_bpm}`],
      ["BP", v.arrested ? "0/0" : `${v.sbp_mmhg}/${v.dbp_mmhg} (MAP ${v.map_mmhg})`],
      ["Pulse press.", `${v.pulsePressure_mmhg}`],
      ["RR", `${v.rr_per_min}`],
      ["SpO2", `${v.spo2_pct}`],
      ["EtCO2", `${v.etco2_mmhg}${v.etco2Waveform ? " (wave)" : " (no wave)"}`],
      ["GCS", v.gcs_text],
      ["Cap refill", v.capRefill_text],
      ["Radial", v.radial],
      ["Skin", v.skin],
      ["Mental", v.mental],
      ["Temp", `${v.temp_C} C`],
      ["Pain", `${v.pain_0_to_10}/10`],
      ["Glucose", `${v.glucose_mg_per_dL}`],
      ["FiO2", `${v.fio2_0_to_1}`],
      ["Patency", `${v.airwayPatency_0_to_1}`],
      ["Airway", airway],
      ["O2", `${s.o2.device} ${Math.round(s.o2.tankPsi)}psi`],
      ["Lines", s.fluids.lines.length === 0 ? "none" : s.fluids.lines.map((l) => `${l.id}:${l.kind}${l.infiltrated ? "(infil)" : ""}`).join(" ")],
      ["Retained", `${Math.round(s.retainedFluids_mL())} mL`],
      ["Circ vol", `${v.circulating_mL} mL`],
      ["Drugs", s.drugs.active.length === 0 ? "none" : s.drugs.active.map((d) => `${d.drugId} ${d.ratio_to_standard}x`).join(" ")],
      ["Tox flags", `${s.drugs.flags.length}`],
      ["Observed", `${Object.keys(s.observed).length} slots`],
      ["Rhythm", v.rhythm],
      ["Shock idx", `${v.shockIndex} (${v.shockFlag})`],
      ["ATLS class", v.atlsClass],
      ["Blood lost", `${v.loss_mL} mL (${v.loss_pct}%)`],
      ["Eff loss", `${Math.round(s.effectiveLoss_mL())} mL`],
      ["Bleed rate", `${Math.round(this.sim.bleedRate_mL_per_min())} mL/min`],
      ["Engine", this.sim.busy ? this.sim.pendingLabel : "Idle"]
    ];
    this.vitals.innerHTML = "";
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      this.vitals.append(dt, dd);
    }
  }
}
