// Upper-right paper doll panel, implemented from scratch Nov 3. Owns the
// #doll-panel slot in the right rail: rebuilds the doll when engine
// markers or the selected region change, and forwards region picks to the
// same path as the scene click and the chips. Markers come from engine
// state only, through buildDoll.

import type { RegionId } from "../patient/regions";
import type { Sim } from "../sim/engine";
import { buildDoll, markersFor } from "./bodyDoll";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

export class DollPanel {
  private readonly root = el("doll-panel");
  private sim: Sim | null = null;
  private selected: RegionId | null = null;
  private signature = "";

  constructor(private readonly onSelect: (region: RegionId) => void) {}

  /** Bind to a fresh sim on dispatch accept. Null clears the panel. */
  bind(sim: Sim | null): void {
    this.sim = sim;
    this.signature = "";
    this.selected = null;
    this.refresh();
  }

  setSelected(region: RegionId | null): void {
    this.selected = region;
    this.refresh();
  }

  /** Wording mode changed: rebuild names from authored strings. */
  reword(): void {
    this.signature = "";
    this.refresh();
  }

  /** Called every sim tick: rebuild only when markers change. */
  refresh(): void {
    const sim = this.sim;
    if (sim === null) {
      this.root.innerHTML = "";
      return;
    }
    const sig = JSON.stringify(markersFor(sim)) + (this.selected ?? "none");
    if (sig === this.signature) return;
    this.signature = sig;
    this.root.innerHTML = "";
    const head = document.createElement("div");
    head.className = "doll-panel-head";
    head.textContent = "Body";
    this.root.appendChild(head);
    this.root.appendChild(
      buildDoll(sim, this.selected, (picked) => {
        this.onSelect(picked);
      })
    );
  }
}
