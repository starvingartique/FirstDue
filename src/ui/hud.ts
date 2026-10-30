// HUD: call title, camera spot buttons, region panel and region chips. The
// chips select every region including the back, which the supine camera
// cannot raycast until the log roll lands.

import { REGION_IDS, REGION_LABELS, type RegionId } from "../patient/regions";
import type { SpotId } from "../engine/camera";
import type { FixedCall } from "../data/types";
import { applyTerms, type TermMode } from "./terms";

export interface HudHandlers {
  onSelectRegion: (region: RegionId) => void;
  onSelectSpot: (spot: SpotId) => void;
  onSpeed: (speed: number) => void;
  onTerms: (mode: TermMode) => void;
  onTips: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

export class Hud {
  private title = el("call-title");
  private clock = el("clock");
  private regionTitle = el("region-title");
  private regionSub = el("region-sub");
  private chips = el("region-chips");
  private spotButtons = [...document.querySelectorAll<HTMLButtonElement>(".spot-btn")];
  private chipButtons = new Map<RegionId, HTMLButtonElement>();
  private speedButtons = [...document.querySelectorAll<HTMLButtonElement>(".speed-btn")];
  private termButtons = [...document.querySelectorAll<HTMLButtonElement>(".term-btn")];
  private tipsButton = el<HTMLButtonElement>("tips-toggle");
  private pausedBanner = el("paused-banner");
  private region: RegionId | null = null;

  constructor(handlers: HudHandlers) {
    for (const region of REGION_IDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = REGION_LABELS[region];
      button.addEventListener("click", () => handlers.onSelectRegion(region));
      this.chips.appendChild(button);
      this.chipButtons.set(region, button);
    }
    for (const button of this.speedButtons) {
      button.addEventListener("click", () => handlers.onSpeed(Number(button.dataset["speed"] ?? "1")));
    }
    for (const button of this.termButtons) {
      button.addEventListener("click", () => handlers.onTerms(button.dataset["terms"] === "plain" ? "plain" : "medical"));
    }
    this.tipsButton.addEventListener("click", () => handlers.onTips());
    for (const button of this.spotButtons) {
      button.addEventListener("click", () => {
        const spot = button.dataset["spot"];
        if (spot === "patient" || spot === "kit" || spot === "bystander") {
          handlers.onSelectSpot(spot);
        }
      });
    }
  }

  showCall(call: FixedCall): void {
    const p = call.patient;
    this.title.textContent = `${call.dispatch.nature} - ${p.name}, ${p.age}${p.sex} - ${call.scene.timeOfDay}`;
  }

  showClock(t_s: number): void {
    const m = Math.floor(t_s / 60);
    const s = t_s % 60;
    this.clock.textContent = `T+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} since contact`;
  }

  showRegion(region: RegionId | null): void {
    this.region = region;
    if (region === null) {
      this.regionTitle.textContent = "No region selected";
      this.regionSub.textContent = "Click a body region, or pick a tab below.";
    } else {
      this.regionTitle.textContent = `Region: ${REGION_LABELS[region]}`;
      this.regionSub.textContent = "Examine tab follows this region. Other tabs hold the kit.";
    }
    for (const [id, button] of this.chipButtons) {
      button.classList.toggle("active", id === region);
      button.textContent = REGION_LABELS[id];
    }
    applyTerms(this.regionTitle);
    applyTerms(this.chips);
  }

  showSpeed(speed: number): void {
    for (const button of this.speedButtons) {
      button.classList.toggle("active", Number(button.dataset["speed"]) === speed);
    }
    this.pausedBanner.hidden = speed !== 0;
  }

  showTerms(mode: TermMode): void {
    for (const button of this.termButtons) {
      button.classList.toggle("active", button.dataset["terms"] === mode);
    }
    this.showRegion(this.region);
  }

  showTips(on: boolean): void {
    this.tipsButton.classList.toggle("active", on);
    this.tipsButton.setAttribute("aria-pressed", String(on));
  }

  showSpot(spot: SpotId): void {
    for (const button of this.spotButtons) {
      button.classList.toggle("active", button.dataset["spot"] === spot);
    }
  }
}
