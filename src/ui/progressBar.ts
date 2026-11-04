// Bottom-center action progress bar, implemented from scratch Nov 3. A
// clear bar in the bottom third of the screen with the running action
// label on it and a cancel button at the end, using the no-entry symbol,
// to stop the action before it completes. Cancel drops the action through
// Sim.cancelPending: kit already taken is refunded, the cancellation is
// logged, and nothing completes after. The bar freezes on pause because
// ticks stop, same as every other sim timer.

import type { Sim } from "../sim/engine";
import { sayLine } from "./wording";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

/** No-entry sign for the cancel button. */
export const CANCEL_GLYPH = "\u2298";

export class ProgressBar {
  private readonly root = el("progress-bar");
  private readonly label = document.createElement("div");
  private readonly track = document.createElement("div");
  private readonly fill = document.createElement("div");
  private readonly cancel = document.createElement("button");

  constructor(onCancel: () => void) {
    this.label.className = "progress-label";
    this.track.className = "progress-track";
    this.fill.className = "progress-fill";
    this.track.appendChild(this.fill);
    this.cancel.type = "button";
    this.cancel.className = "progress-cancel";
    this.cancel.textContent = CANCEL_GLYPH;
    this.cancel.title = "Cancel the running action";
    this.cancel.setAttribute("aria-label", "Cancel the running action");
    this.cancel.addEventListener("click", () => onCancel());
    this.root.append(this.label, this.track, this.cancel);
  }

  /** Called every sim tick: show while an action runs, hide otherwise. */
  refresh(sim: Sim | null): void {
    const pending = sim?.pending ?? null;
    if (pending === null) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    this.label.textContent = sayLine(`${pending.label} - ${pending.remaining_s}s left`);
    const done = pending.total_s <= 0 ? 1 : 1 - pending.remaining_s / pending.total_s;
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, done)) * 100)}%`;
  }
}
