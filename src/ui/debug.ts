// F1 debug overlay. Placeholder vitals only, clearly labeled. The Oct 28
// physiology engine replaces these with the true ticking state.

export interface DebugVitals {
  hr: number;
  sbp: number;
  dbp: number;
  spo2: number;
  rr: number;
  etco2: number;
  gcs: string;
}

// Fake but plausible for a young adult with a controlled bleed. Jitter keeps
// the overlay visibly alive without implying engine truth.
const BASE: DebugVitals = { hr: 128, sbp: 92, dbp: 58, spo2: 97, rr: 24, etco2: 31, gcs: "E4 V5 M6 (15)" };

function jitter(base: number, spread: number): number {
  return Math.round(base + (Math.random() * 2 - 1) * spread);
}

export class DebugOverlay {
  private overlay: HTMLElement;
  private vitals: HTMLElement;
  private timer: number | null = null;

  constructor() {
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
      this.timer = window.setInterval(() => this.render(), 2000);
    } else if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private render(): void {
    const rows: [string, string][] = [
      ["HR", `${jitter(BASE.hr, 2)}`],
      ["SBP", `${jitter(BASE.sbp, 2)}`],
      ["DBP", `${jitter(BASE.dbp, 2)}`],
      ["SpO2", `${jitter(BASE.spo2, 1)}`],
      ["RR", `${jitter(BASE.rr, 1)}`],
      ["EtCO2", `${jitter(BASE.etco2, 1)}`],
      ["GCS", BASE.gcs]
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
