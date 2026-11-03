// L1 partner tips, reimplemented from scratch as a speech bubble from the
// top right. One why-it-matters line per menu tab, shown when the player
// opens that tab, then gone: auto-dismiss after TIP_SHOW_MS, or click to
// dismiss sooner. Each tab shows once per run; re-entering a tab does not
// reshow it. L2 gets no tips. Tips never say which option is right, and
// traps stay traps. The bubble sits top right, clear of the menu (left),
// the chat (left), and the scene log (bottom right).

import type { Sim } from "../sim/engine";
import type { Tab } from "./medicalMenu";
import { word } from "./wording";

/** Bubble lifetime. UI timing only, 6 real seconds. */
export const TIP_SHOW_MS = 6000;

const TIPS: Record<Tab, string> = {
  examine: "Partner: the sweep and region exams find what is actually wrong before you treat it.",
  airway: "Partner: a blocked airway kills faster than anything else you can fix here.",
  breathing: "Partner: breathing trouble hides behind the obvious bleed, so this tab earns a look.",
  circulation: "Partner: stopping the bleed is half the job, volume and reassessment are the other half.",
  meds: "Partner: drugs buy comfort and time, and every push has a tradeoff.",
  lines: "Partner: access first and fluids second, and the clock matters for both.",
  monitor: "Partner: the monitor shows trends, so trend it and keep hands on the patient."
};

/** The tip for a tab, or null for L2 (no tips) and unknown levels. */
export function tipFor(tab: Tab, level: number): string | null {
  return level === 1 ? (TIPS[tab] ?? null) : null;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

export class TipsBubble {
  private readonly root = el("tips-bubble");
  private sim: Sim | null = null;
  private currentTip: string | null = null;
  private shown = new Set<Tab>();
  private timer: number | null = null;

  constructor() {
    this.root.addEventListener("click", () => this.hide());
  }

  /** Bind to a fresh sim on dispatch accept. Null hides the bubble. */
  bind(sim: Sim | null): void {
    this.sim = sim;
    this.shown.clear();
    this.currentTip = null;
    this.hide();
  }

  /** Show the tip for a freshly opened tab, once per tab per run. */
  show(tab: Tab): void {
    const sim = this.sim;
    if (sim === null || this.shown.has(tab)) return;
    const tip = tipFor(tab, sim.level);
    if (tip === null) return;
    this.shown.add(tab);
    this.currentTip = tip;
    this.root.textContent = tip;
    word(this.root);
    this.root.hidden = false;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), TIP_SHOW_MS);
  }

  /** Wording mode changed: reword the visible tip from the authored line. */
  reword(): void {
    if (this.root.hidden || this.currentTip === null) return;
    this.root.textContent = this.currentTip;
    word(this.root);
  }

  private hide(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.root.hidden = true;
  }
}
