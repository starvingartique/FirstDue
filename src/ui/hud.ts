// HUD: top bar call blocks, camera spot tabs, region panel and region
// chips. The top bar follows the Nov 3 mockup: call and shift plus nature,
// patient plus known allergies, wall time plus scene clock plus weather,
// then speed controls, the wording toggle, and the four camera tabs.

import { REGION_IDS, REGION_LABELS, type RegionId } from "../patient/regions";
import type { SpotId } from "../engine/camera";
import type { FixedCall } from "../data/types";
import { getWording, sayLine, type WordingMode } from "./wording";

export interface HudHandlers {
  onSelectRegion: (region: RegionId) => void;
  onSelectSpot: (spot: SpotId) => void;
  onPackage: () => void;
  onWording: (mode: WordingMode) => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

const SPOT_LABELS: { spot: SpotId; label: string }[] = [
  { spot: "patient", label: "1 Patient" },
  { spot: "kit", label: "2 Bag" },
  { spot: "bystander", label: "3 Bystander" },
  { spot: "partner", label: "4 Partner" }
];

/** Scene time of day to the shift name shown in the top bar. Data only. */
export function shiftFor(timeOfDay: string): string {
  const t = timeOfDay.trim().toLowerCase();
  if (t === "night") return "Night Shift";
  if (t === "day") return "Day Shift";
  if (t === "evening") return "Evening Shift";
  if (t === "morning") return "Morning Shift";
  if (t === "afternoon") return "Afternoon Shift";
  if (t === "dawn") return "Dawn Shift";
  if (t === "dusk") return "Dusk Shift";
  const titled = t === "" ? "Unknown" : t.charAt(0).toUpperCase() + t.slice(1);
  return `${titled} Shift`;
}

export class Hud {
  private callLine = el("call-line");
  private callNature = el("call-nature");
  private patientLine = el("patient-line");
  private allergyLine = el("allergy-line");
  private wallClock = el("wall-clock");
  private clock = el("clock");
  private weatherLine = el("weather-line");
  private vitalsPill = el("vitals-pill");
  private regionTitle = el("region-title");
  private regionSub = el("region-sub");
  private chips = el("region-chips");
  private spotButtons = [...document.querySelectorAll<HTMLButtonElement>(".spot-btn")].filter((b) =>
    b.closest("#spot-nav")
  );
  private chipButtons = new Map<RegionId, HTMLButtonElement>();
  private packageButton = el<HTMLButtonElement>("package-btn");
  private wordingButton = el<HTMLButtonElement>("wording-btn");
  private wording: WordingMode = getWording();
  private lastRegion: RegionId | null = null;
  private lastVitals: string | null = null;
  private lastCall: { nature: string; patient: string; weather: string } | null = null;

  constructor(handlers: HudHandlers) {
    this.packageButton.addEventListener("click", () => handlers.onPackage());
    this.wordingButton.addEventListener("click", () => {
      handlers.onWording(this.wording === "medical" ? "plain" : "medical");
    });
    for (const region of REGION_IDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = sayLine(REGION_LABELS[region]);
      button.addEventListener("click", () => handlers.onSelectRegion(region));
      this.chips.appendChild(button);
      this.chipButtons.set(region, button);
    }
    for (const button of this.spotButtons) {
      button.addEventListener("click", () => {
        const spot = button.dataset["spot"];
        if (spot === "patient" || spot === "kit" || spot === "bystander" || spot === "partner") {
          handlers.onSelectSpot(spot);
        }
      });
    }
    this.rewordSpots();
  }

  showCall(call: FixedCall, callNo?: number): void {
    const p = call.patient;
    const no = callNo ?? 1;
    this.callLine.textContent = `Call #${no} | ${shiftFor(call.scene.timeOfDay)}`;
    this.lastCall = {
      nature: call.dispatch.nature,
      patient: `${p.name}, ${p.age}${p.sex}`,
      weather: call.scene.weather ?? call.scene.timeOfDay
    };
    // Known allergies: the clean data carries none for Bike down, and
    // generated-call allergies stay hidden history until asked about, so
    // the honest top-bar state is unknown. Never invented here.
    this.allergyLine.textContent = "Known Allergies: unknown";
    this.renderCall();
  }

  private renderCall(): void {
    if (this.lastCall === null) return;
    this.callNature.textContent = sayLine(this.lastCall.nature);
    this.patientLine.textContent = this.lastCall.patient;
    this.weatherLine.textContent = sayLine(this.lastCall.weather);
  }

  showClock(t_s: number): void {
    const m = Math.floor(t_s / 60);
    const s = t_s % 60;
    this.clock.textContent = `T+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} since contact`;
    const now = new Date();
    this.wallClock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  showRegion(region: RegionId | null): void {
    this.lastRegion = region;
    if (region === null) {
      this.regionTitle.textContent = sayLine("No region selected");
      this.regionSub.textContent = sayLine("Click a body region, or pick a tab below.");
    } else {
      this.regionTitle.textContent = sayLine(`Region: ${REGION_LABELS[region]}`);
      this.regionSub.textContent = sayLine("Examine tab follows this region. Other tabs hold the kit.");
    }
    for (const [id, button] of this.chipButtons) {
      button.classList.toggle("active", id === region);
    }
  }

  showPackage(visible: boolean): void {
    this.packageButton.hidden = !visible;
  }

  showWording(mode: WordingMode): void {
    this.wording = mode;
    this.wordingButton.textContent = mode === "medical" ? "Medical / Plain: Medical" : "Medical / Plain: Plain";
  }

  /** Persistent monitor pill: null hides it. Engine numbers only. */
  showVitals(text: string | null): void {
    this.lastVitals = text;
    this.vitalsPill.hidden = text === null;
    if (text !== null) this.vitalsPill.textContent = sayLine(text);
  }

  /** Wording mode changed: reword call blocks, spots, chips, region and pill. */
  reword(): void {
    this.renderCall();
    this.rewordSpots();
    for (const [id, button] of this.chipButtons) {
      button.textContent = sayLine(REGION_LABELS[id]);
    }
    this.showRegion(this.lastRegion);
    this.showVitals(this.lastVitals);
  }

  private rewordSpots(): void {
    for (const button of this.spotButtons) {
      const spot = button.dataset["spot"];
      const found = SPOT_LABELS.find((s) => s.spot === spot);
      if (found !== undefined) button.textContent = sayLine(found.label);
    }
  }

  showSpot(spot: SpotId): void {
    for (const button of this.spotButtons) {
      button.classList.toggle("active", button.dataset["spot"] === spot);
    }
  }
}
