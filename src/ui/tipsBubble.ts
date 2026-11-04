// L1 partner tips, reimplemented from scratch. One why-it-matters line
// per menu tab, posted to the group chat as a partner line when the
// player opens that tab. Each tab posts once per run; re-entering a tab
// does not repost it. L2 gets no tips. Tips never say which option is
// right, and traps stay traps. The old top-right bubble is gone: chat
// is the only home, and posted lines stay as posted (chat history is
// verbatim), so there is no reword pass.

import type { Sim } from "../sim/engine";
import type { Tab } from "./medicalMenu";

/** Bubble lifetime from the top-right era. Kept for history; unused now. */
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

export class TipsBubble {
  private sim: Sim | null = null;
  private shown = new Set<Tab>();

  constructor(private readonly hooks: { onTip: (tip: string) => void }) {}

  /** Bind to a fresh sim on dispatch accept. Null clears the run set. */
  bind(sim: Sim | null): void {
    this.sim = sim;
    this.shown.clear();
  }

  /** Post the tip for a freshly opened tab, once per tab per run. */
  show(tab: Tab): void {
    const sim = this.sim;
    if (sim === null || this.shown.has(tab)) return;
    const tip = tipFor(tab, sim.level);
    if (tip === null) return;
    this.shown.add(tab);
    this.hooks.onTip(tip);
  }
}
