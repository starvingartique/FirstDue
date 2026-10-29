// HUD: call title, camera spot buttons, region panel and region chips. The
// chips select every region including the back, which the supine camera
// cannot raycast until the log roll lands.

import { REGION_IDS, REGION_LABELS, type RegionId } from "../patient/regions";
import type { SpotId } from "../engine/camera";
import type { FixedCall } from "../data/types";

export interface HudHandlers {
  onSelectRegion: (region: RegionId) => void;
  onSelectSpot: (spot: SpotId) => void;
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
    if (region === null) {
      this.regionTitle.textContent = "No region selected";
      this.regionSub.textContent = "Click a body region, or pick Examine / Circulation below.";
    } else {
      this.regionTitle.textContent = `Region: ${REGION_LABELS[region]}`;
      this.regionSub.textContent = "Examine tab follows this region. Circulation holds hemorrhage control.";
    }
    for (const [id, button] of this.chipButtons) {
      button.classList.toggle("active", id === region);
    }
  }

  showSpot(spot: SpotId): void {
    for (const button of this.spotButtons) {
      button.classList.toggle("active", button.dataset["spot"] === spot);
    }
  }
}
