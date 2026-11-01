// Kit item labels and the static foreground preview. Labels are small HTML
// pills anchored to the 3D items, visible only in the kit spot, so they can
// never cover the patient, the wound, or region clicks in other spots.
// Clicking an item or its label opens that item's existing menu tab and shows
// a static preview card: label, a visual-only description, and a button that
// jumps to the linked menu section. No tweens, no motion: the card appears
// and dismisses instantly. Label wording runs through the Medical / Plain
// terminology layer, same as the panel. This module opens existing tabs and
// sections only; it never runs a procedure or invents an action.

import * as THREE from "three";
import type { SpotId } from "../engine/camera";
import { KIT_ANCHORS, type KitItemId } from "../engine/kit";
import type { Tab } from "./medicalMenu";
import { applyTerms } from "./terms";
import type { Sim } from "../sim/engine";

/** Stash id behind each kit item, for the at-patient count. */
const KIT_STASH: Partial<Record<KitItemId, string>> = {
  cat: "cat_tourniquet",
  kerlix: "plain_gauze_roll_kerlix",
  zfold: "hemostatic_gauze_zfold",
  dressing: "pressure_bandage_6in",
  nrb: "non_rebreather",
  ns: "ns_1000ml",
  blanket: "hypothermia_wrap_blanket"
};

/** "In use" from what the player has applied. */
function kitInUse(id: KitItemId, s: Sim): boolean {
  switch (id) {
    case "cat":
      return s.tq.applied;
    case "kerlix":
      return s.packing.stage !== "none" && s.packing.gauze === "plain";
    case "zfold":
      return s.packing.stage !== "none" && s.packing.gauze === "hemostatic";
    case "dressing":
      return s.dressing.applied;
    case "nrb":
      return s.o2.device === "non_rebreather";
    case "o2":
      return s.o2.device !== "none";
    case "ns":
      return s.fluids.lines.some((l) => l.bag?.fluid === "ns");
    case "blanket":
      return s.wrapped;
    case "airway":
      return s.airway.adjunct !== null || s.airway.ett !== null;
    case "drugs":
      return s.drugs.active.length > 0;
    default:
      return false;
  }
}

export const KIT_ITEM_IDS: KitItemId[] = [
  "cat",
  "kerlix",
  "zfold",
  "dressing",
  "gloves",
  "nrb",
  "o2",
  "ns",
  "blanket",
  "airway",
  "drugs"
];

/** Medical wording. Plain mode rewrites known terms via applyTerms. */
export const KIT_LABELS: Record<KitItemId, string> = {
  cat: "CAT",
  kerlix: "Kerlix",
  zfold: "z-fold packing",
  dressing: "Pressure dressing",
  gloves: "Gloves - BSI (visual only)",
  nrb: "Non-rebreather",
  o2: "O2 D cylinder",
  ns: "NS IV bag and line",
  blanket: "Hypothermia blanket",
  airway: "Airway pouch",
  drugs: "Drug box"
};

/** Visual-only descriptions. No clinical values, no instructions. */
const KIT_BLURBS: Record<KitItemId, string> = {
  cat: "Strap loop, orange windlass and white time band on the tarp.",
  kerlix: "Rolled gauze on the tarp.",
  zfold: "Tan packet with a red stripe on the tarp.",
  dressing: "Elastic roll, flat pad and pressure bar on the tarp.",
  gloves: "Pair of purple gloves on the tarp. Visual only, no menu action.",
  nrb: "Clear mask with strap, green reservoir bag and O2 line.",
  o2: "Green D cylinder with valve, regulator and gauge.",
  ns: "Clear bag with label, port, drip chamber and coiled line.",
  blanket: "Folded silver and gold stack on the tarp.",
  airway: "Dark pouch with a reflective stripe behind the jump bag.",
  drugs: "White box with a red cross, latched shut."
};

export interface KitLink {
  tab: Tab;
  /** Existing menu section title, or null for a tab-only link. */
  section: string | null;
  button: string;
}

/**
 * Label-to-action mapping. Every target is an existing tab and section in
 * the ACM menu; gloves have no action and link nowhere.
 */
export const KIT_LINKS: Record<KitItemId, KitLink | null> = {
  cat: { tab: "circulation", section: "Tourniquet (CAT)", button: "Open Circulation: Tourniquet" },
  kerlix: { tab: "circulation", section: "Packing + 3 min pressure", button: "Open Circulation: Packing" },
  zfold: { tab: "circulation", section: "Packing + 3 min pressure", button: "Open Circulation: Packing" },
  dressing: { tab: "circulation", section: "Pressure dressing", button: "Open Circulation: Pressure dressing" },
  gloves: null,
  nrb: { tab: "breathing", section: "Oxygen", button: "Open Breathing: O2 delivery" },
  o2: { tab: "breathing", section: "Oxygen", button: "Open Breathing: O2 delivery" },
  ns: { tab: "lines", section: "Start IV (75s)", button: "Open Lines: IV" },
  blanket: { tab: "examine", section: "Whole patient", button: "Open Examine: Wrap" },
  airway: { tab: "airway", section: null, button: "Open Airway tab" },
  drugs: { tab: "meds", section: "Drug box: pick, prep, push", button: "Open Meds: Drug box" }
};

export interface KitLabelHandlers {
  /** Item or label clicked: open its existing menu tab. */
  onSelect: (id: KitItemId) => void;
  /** Preview menu button: jump to the linked section, then dismiss. */
  onOpenAction: (id: KitItemId) => void;
}

export class KitLabels {
  private layer: HTMLDivElement;
  private preview: HTMLDivElement;
  private buttons = new Map<KitItemId, HTMLButtonElement>();
  private spot: SpotId = "patient";
  private selected: KitItemId | null = null;
  private readonly anchors = new Map<KitItemId, THREE.Vector3>();
  private readonly tmp = new THREE.Vector3();
  private readonly toAnchor = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();

  constructor(private readonly handlers: KitLabelHandlers) {
    const app = document.getElementById("app");
    const overlay = document.getElementById("flow-overlay");
    if (app === null || overlay === null) throw new Error("missing #app or #flow-overlay in index.html");
    for (const id of KIT_ITEM_IDS) {
      const [x, y, z] = KIT_ANCHORS[id];
      this.anchors.set(id, new THREE.Vector3(x, y, z));
    }

    this.layer = document.createElement("div");
    this.layer.id = "kit-labels";
    this.layer.style.display = "none";
    for (const id of KIT_ITEM_IDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kit-label";
      button.dataset["kitItem"] = id;
      button.textContent = KIT_LABELS[id];
      button.addEventListener("click", () => this.select(id));
      this.layer.appendChild(button);
      this.buttons.set(id, button);
    }
    applyTerms(this.layer);

    this.preview = document.createElement("div");
    this.preview.id = "kit-preview";
    this.preview.hidden = true;

    // Before the flow overlay: the modal and the panel stay on top.
    app.insertBefore(this.layer, overlay);
    app.insertBefore(this.preview, overlay);
  }

  getSelected(): KitItemId | null {
    return this.selected;
  }

  /** Labels show only in the kit spot. Leaving it dismisses the preview. */
  setSpot(spot: SpotId): void {
    this.spot = spot;
    this.layer.style.display = spot === "kit" ? "block" : "none";
    if (spot !== "kit") this.hidePreview();
  }

  private usageSig = "";
  private lastSim: Sim | null = null;

  /** Count and IN USE tags on each label. Cheap; only redraws on change. */
  updateUsage(s: Sim): void {
    this.lastSim = s;
    const sig = [...this.buttons.keys()]
      .map((id) => `${KIT_STASH[id] !== undefined ? s.atPatient(KIT_STASH[id] as string) : "-"}${kitInUse(id, s) ? "u" : ""}`)
      .join(",");
    if (sig === this.usageSig) return;
    this.usageSig = sig;
    for (const [id, button] of this.buttons) {
      button.querySelector(".kit-tag")?.remove();
      button.querySelector(".kit-count")?.remove();
      const stash = KIT_STASH[id];
      if (stash !== undefined) {
        const n = s.atPatient(stash);
        const c = document.createElement("span");
        c.className = `kit-count${n === 0 ? " empty" : ""}`;
        c.textContent = `x${n}`;
        button.appendChild(c);
      }
      const used = kitInUse(id, s);
      button.classList.toggle("in-use", used);
      if (used) {
        const t = document.createElement("span");
        t.className = "kit-tag";
        t.textContent = "IN USE";
        button.appendChild(t);
      }
    }
  }

  /** Medical / Plain toggle changed: rebuild every string from source. */
  retranslate(): void {
    for (const [id, button] of this.buttons) button.textContent = KIT_LABELS[id];
    applyTerms(this.layer);
    this.usageSig = "";
    if (this.lastSim !== null) this.updateUsage(this.lastSim);
    if (this.selected !== null) this.renderPreview(this.selected);
  }

  /**
   * Select an item (3D tap or label click). Clicking the selected item
   * again dismisses the preview. Opening the tab never runs a procedure.
   */
  select(id: KitItemId): void {
    if (this.selected === id) {
      this.hidePreview();
      return;
    }
    this.selected = id;
    for (const [key, button] of this.buttons) button.classList.toggle("active", key === id);
    this.handlers.onSelect(id);
    this.renderPreview(id);
    this.preview.hidden = false;
  }

  hidePreview(): void {
    this.selected = null;
    this.preview.hidden = true;
    for (const button of this.buttons.values()) button.classList.remove("active");
  }

  private renderPreview(id: KitItemId): void {
    const link = KIT_LINKS[id];
    this.preview.innerHTML = "";
    const title = document.createElement("div");
    title.className = "kit-preview-title";
    title.textContent = KIT_LABELS[id];
    const sub = document.createElement("div");
    sub.className = "kit-preview-sub";
    sub.textContent = KIT_BLURBS[id];
    const row = document.createElement("div");
    row.className = "kit-preview-row";
    if (link !== null) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "kit-preview-open";
      open.textContent = link.button;
      open.addEventListener("click", () => {
        this.handlers.onOpenAction(id);
        this.hidePreview();
      });
      row.appendChild(open);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "kit-preview-close";
    close.textContent = "Close";
    close.addEventListener("click", () => this.hidePreview());
    row.appendChild(close);
    this.preview.append(title, sub, row);
    applyTerms(this.preview);
  }

  /** Project each anchor to screen space. Called once per frame. */
  update(camera: THREE.Camera): void {
    if (this.spot !== "kit") return;
    camera.getWorldDirection(this.camDir);
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const [id, button] of this.buttons) {
      const anchor = this.anchors.get(id);
      if (anchor === undefined) continue;
      this.toAnchor.copy(anchor).sub(camera.position);
      this.tmp.copy(anchor).project(camera);
      const facing = this.toAnchor.dot(this.camDir) > 0 && this.tmp.z < 1;
      if (!facing) {
        button.style.display = "none";
        continue;
      }
      button.style.display = "block";
      button.style.left = `${((this.tmp.x * 0.5 + 0.5) * w).toFixed(1)}px`;
      button.style.top = `${((-this.tmp.y * 0.5 + 0.5) * h).toFixed(1)}px`;
    }
  }
}
