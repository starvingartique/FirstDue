// Right-side partner progress bar, implemented from scratch Nov 3 night.
// Shows the partner's current job in plain words with a fill, plus its
// own cancel button using the same no-entry symbol as the player bar.
// Hidden while the partner is free, same as the player bar hides while
// idle, so no dead bar sits on screen and no stale task lingers after a
// finish or cancel. Cancel drops the job through Sim.cancelPartnerJob:
// nothing completes after, the partner is free for a new task, and the
// player pending action is never touched.

import { TRUCK_BOXES, type Sim } from "../sim/engine";
import type { PartnerJob } from "../sim/types";
import { CANCEL_GLYPH } from "./progressBar";
import { sayLine } from "./wording";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

/** Fetchable item ids to short plain labels, same words as the menu. */
const FETCH_LABELS: Record<string, string> = {
  cat_tourniquet: "CAT",
  hemostatic_gauze_zfold: "Hemostatic gauze",
  pressure_bandage_6in: "6 in bandage",
  softt_wide_tourniquet: "SOF-T",
  junctional_tourniquet_samjt: "SAM JT",
  hypothermia_wrap_blanket: "Wrap blanket",
  o2_tank_m: "O2 M cylinder",
  whole_blood_unit: "Whole blood",
  y_tubing_blood: "Y tubing",
  fluid_warmer: "Fluid warmer",
  cpap_unit: "CPAP"
};

/** Plain-words task name for one partner job. Pure, tested headless. */
export function partnerJobLabel(job: PartnerJob): string {
  if (job.kind === "hold") return "Hold packing pressure";
  if (job.kind === "box") {
    const names = job.ref.split(",").map((id) => TRUCK_BOXES.find((b) => b.id === id)?.label ?? id);
    return `Bring ${names.join(", ")}`;
  }
  return `Fetch ${FETCH_LABELS[job.ref] ?? job.ref}`;
}

export class PartnerBar {
  private readonly root = el("partner-bar");
  private readonly head = document.createElement("div");
  private readonly label = document.createElement("div");
  private readonly row = document.createElement("div");
  private readonly track = document.createElement("div");
  private readonly fill = document.createElement("div");
  private readonly cancel = document.createElement("button");
  private readonly more = document.createElement("div");
  private currentKey: string | null = null;

  constructor(onCancel: (key: string) => void) {
    this.head.className = "partner-head";
    this.label.className = "partner-label";
    this.row.className = "partner-row";
    this.track.className = "partner-track";
    this.fill.className = "partner-fill";
    this.track.appendChild(this.fill);
    this.cancel.type = "button";
    this.cancel.className = "partner-cancel";
    this.cancel.textContent = CANCEL_GLYPH;
    this.cancel.addEventListener("click", () => {
      const key = this.currentKey;
      if (key !== null) onCancel(key);
    });
    this.more.className = "partner-more";
    this.row.append(this.track, this.cancel);
    this.root.append(this.head, this.label, this.row, this.more);
  }

  /** Called every sim tick: show the first job, hide while free. */
  refresh(sim: Sim | null): void {
    const jobs = sim?.partnerJobs() ?? [];
    const first = jobs[0] ?? null;
    if (first === null) {
      this.root.hidden = true;
      this.currentKey = null;
      return;
    }
    this.root.hidden = false;
    this.currentKey = first.key;
    this.head.textContent = sayLine("Partner");
    this.label.textContent = sayLine(`${partnerJobLabel(first)} - ${first.remaining_s}s left`);
    const done = first.total_s <= 0 ? 1 : 1 - first.remaining_s / first.total_s;
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, done)) * 100)}%`;
    const title = sayLine("Cancel the partner task");
    this.cancel.title = title;
    this.cancel.setAttribute("aria-label", title);
    this.more.hidden = jobs.length < 2;
    this.more.textContent = jobs.length > 1 ? sayLine(`+${jobs.length - 1} more partner task${jobs.length > 2 ? "s" : ""}`) : "";
  }
}
