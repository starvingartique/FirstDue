// Quick Actions panel, implemented from scratch Nov 4. Replaces the
// duplicate labels-only region panel on the left side of the main screen.
// Five buttons in fixed order, all existing actions only: blood sweep,
// visual skin check, pulse oximeter gated on a hand or finger pick,
// medical menu opener, and bag view opener. No new clinical action, no
// timing change, no effect change. The pulse ox gate maps hand and finger
// to the arm regions, because the arm mesh includes the hand sphere under
// the same region id (see patient/body.ts), and the doll has no separate
// hand region. With no arm selected the button names the missing pick in
// plain words and runs nothing.

import type { RegionId } from "../patient/regions";
import type { Sim } from "../sim/engine";
import { sayLine } from "./wording";

export interface QuickActionsHooks {
  sim: () => Sim | null;
  region: () => RegionId | null;
  onRun: () => void;
  onOpenMenu: () => void;
  onOpenBag: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

/** True when the pick covers a hand or finger: either arm region. */
export function handSelected(region: RegionId | null): boolean {
  return region === "arm_left" || region === "arm_right";
}

export class QuickActions {
  private readonly root = el("quick-panel");
  private readonly sweepBtn = document.createElement("button");
  private readonly visualBtn = document.createElement("button");
  private readonly spo2Btn = document.createElement("button");
  private readonly menuBtn = document.createElement("button");
  private readonly bagBtn = document.createElement("button");
  private readonly status = document.createElement("div");
  private sig = "";

  constructor(private readonly hooks: QuickActionsHooks) {
    this.root.innerHTML = "";
    const head = document.createElement("div");
    head.className = "quick-head";
    head.textContent = "Quick Actions";
    this.sweepBtn.type = "button";
    this.visualBtn.type = "button";
    this.spo2Btn.type = "button";
    this.menuBtn.type = "button";
    this.bagBtn.type = "button";
    this.sweepBtn.className = "menu-btn quick-btn";
    this.visualBtn.className = "menu-btn quick-btn";
    this.spo2Btn.className = "menu-btn quick-btn";
    this.menuBtn.className = "menu-btn quick-btn";
    this.bagBtn.className = "menu-btn quick-btn";
    this.status.className = "menu-note quick-status";
    this.sweepBtn.addEventListener("click", () => {
      const sim = this.hooks.sim();
      if (sim === null) return;
      const res = sim.bloodSweep();
      if (!res.ok && res.reason) sim.addLog("info", `Cannot: Blood sweep - ${res.reason}`);
      this.hooks.onRun();
      this.refresh();
    });
    this.visualBtn.addEventListener("click", () => {
      const sim = this.hooks.sim();
      if (sim === null) return;
      const res = sim.checkSkin();
      if (!res.ok && res.reason) sim.addLog("info", `Cannot: Visual condition - ${res.reason}`);
      this.hooks.onRun();
      this.refresh();
    });
    this.spo2Btn.addEventListener("click", () => {
      const sim = this.hooks.sim();
      if (sim === null) return;
      if (!handSelected(this.hooks.region())) return;
      if (!sim.monitor.spo2Attached) {
        const put = sim.attachSpo2();
        if (!put.ok) {
          if (put.reason) sim.addLog("info", `Cannot: Apply pulse oximeter - ${put.reason}`);
          this.hooks.onRun();
          this.refresh();
          return;
        }
      }
      const read = sim.readSpo2();
      if (!read.ok && read.reason) sim.addLog("info", `Cannot: Read SpO2 - ${read.reason}`);
      this.hooks.onRun();
      this.refresh();
    });
    this.menuBtn.addEventListener("click", () => this.hooks.onOpenMenu());
    this.bagBtn.addEventListener("click", () => this.hooks.onOpenBag());
    this.root.append(head, this.sweepBtn, this.visualBtn, this.spo2Btn, this.menuBtn, this.bagBtn, this.status);
    this.refresh();
  }

  reword(): void {
    this.sig = "";
    this.refresh();
  }

  refresh(): void {
    const sim = this.hooks.sim();
    const region = this.hooks.region();
    const key = [
      sim === null ? "norun" : sim.pending?.id ?? "idle",
      sim?.monitor.spo2Attached ?? false,
      region ?? "none"
    ].join("|");
    if (key === this.sig) return;
    this.sig = key;
    const live = sim !== null;
    this.root.hidden = !live;
    if (!live) return;
    this.sweepBtn.textContent = sayLine("Blood sweep (12s)");
    this.visualBtn.textContent = sayLine("Check visual condition (5s)");
    if (handSelected(region)) {
      this.spo2Btn.textContent = sayLine("Apply pulse oximeter");
      this.spo2Btn.disabled = false;
    } else {
      this.spo2Btn.textContent = sayLine("Apply pulse oximeter: select a hand or finger first");
      this.spo2Btn.disabled = false;
    }
    this.menuBtn.textContent = sayLine("Medical Menu (H)");
    this.bagBtn.textContent = sayLine("Bag (2)");
    const picked = region === null ? "No region selected." : `Selected: ${region}.`;
    this.status.textContent = sayLine(`${picked} Pulse ox needs a hand or finger (either arm on the doll).`);
  }
}
