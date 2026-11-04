// Held Item Info panel, implemented from scratch Nov 3. Bottom-right
// card naming the kit item in the player's hands: while a procedure runs
// it follows the same held-item rule as the 3D hands, otherwise it shows
// the selected staged kit item, otherwise hands free. Names and blurbs
// come from the kit label sources, worded like the rest of the UI.

import type { PendingAction } from "../sim/types";
import { heldItemForPending } from "../engine/hands";
import type { KitItemId } from "../engine/kit";
import { KIT_BLURBS, KIT_LABELS } from "./kitLabels";
import { sayLine } from "./wording";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

export class HeldItemPanel {
  private readonly root = el("held-item");
  private signature = "";

  /** Called every sim tick. Null pending with no selection reads hands free. */
  refresh(pending: PendingAction | null, selectedKit: KitItemId | null): void {
    const held = pending === null ? null : heldItemForPending(pending.id, pending.label);
    const shown: KitItemId | null = held ?? selectedKit;
    const sig = `${pending?.id ?? "idle"}|${shown ?? "none"}`;
    if (sig === this.signature) return;
    this.signature = sig;
    this.root.innerHTML = "";
    this.root.hidden = false;
    const head = document.createElement("div");
    head.className = "held-head";
    head.textContent = "Held Item Info";
    const name = document.createElement("div");
    name.className = "held-name";
    const sub = document.createElement("div");
    sub.className = "held-sub";
    if (shown === null) {
      name.textContent = sayLine("Hands free");
      sub.textContent = sayLine("No procedure running, no kit item selected.");
    } else {
      name.textContent = sayLine(KIT_LABELS[shown]);
      const use = pending === null ? "" : ` In use: ${pending.label}.`;
      sub.textContent = sayLine(`${KIT_BLURBS[shown]}${use}`);
    }
    this.root.append(head, name, sub);
  }

  /** Wording mode changed: rebuild strings from source. */
  reword(pending: PendingAction | null, selectedKit: KitItemId | null): void {
    this.signature = "";
    this.refresh(pending, selectedKit);
  }
}
