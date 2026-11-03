// MARCH strip, reimplemented from scratch. Steps light up from what the
// player has actually DONE, read from the event log only: step names come
// from data/medical/march_paws.json (M A R C H plus the P A W S extension),
// and the next undone step in order gets the priority highlight. Talk
// lines never count, engine-automatic lines never count, and the strip
// never says which option is right: traps stay traps.

import type { Sim } from "../sim/engine";
import type { LogEvent } from "../sim/types";
import { word } from "./wording";

export interface MarchStep {
  id: string;
  /** One-word chip label. */
  label: string;
  /** Full step name, shown as the chip tooltip. */
  name: string;
}

export const MARCH_STEPS: MarchStep[] = [
  { id: "M", label: "Bleed", name: "Massive hemorrhage" },
  { id: "A", label: "Airway", name: "Airway" },
  { id: "R", label: "Breath", name: "Respiration" },
  { id: "C", label: "Circ", name: "Circulation" },
  { id: "H", label: "Hypo", name: "Hypothermia + Head injury" },
  { id: "P", label: "Pain", name: "Pain" },
  { id: "A2", label: "Abx", name: "Antibiotics" },
  { id: "W", label: "Wound", name: "Wounds" },
  { id: "S2", label: "Splint", name: "Splinting" }
];

/** Engine-automatic or run-marker lines: never count as player-done. */
const AUTO_LINES =
  /tank at reserve|bag empty|Shock class|Shock index|Re-bleed|re-bleed scare|Call start|Run over|PEA arrest|aspirates|fetched from the truck|balled-up shirt/i;

const STEP_MATCH: Record<string, RegExp> = {
  M: /tourniquet|\bTQ\b|packed|packing|direct pressure|pressure dressing|take over|lets go|belt removed|second TQ|junctional/i,
  A: /\bOPA\b|\bNPA\b|supraglottic|i-?gel|\bking\b|intubat|\bETT\b|esophageal|tracheal|mainstem|suction|jaw thrust|recovery position|airway patent/i,
  R: /\bBVM\b|\bO2\b|oxygen|ventil|reservoir|chest seal|needle|decompress|thoracost|SpO2 probe|EtCO2 attached|mask/i,
  C: /\bIV\b|\bIO\b|\bline\b|catheter|fluid|LR\b|saline|TXA|pelvic|binder|calcium|radial|cap refill/i,
  H: /wet clothing|wrapped|wrap|hypothermia|blanket|\bGCS\b|pupil/i,
  P: /fentanyl|ketamine|morphine|analgesi|acetaminophen|meloxicam|ondansetron|lidocaine|pushed|\bmg\b|\bmcg\b|bolus/i,
  A2: /antibiotic|cefadroxil|cephalexin|ceftriaxone|ertapenem|tetanus|cefazolin/i,
  W: /log roll|dress|wound (packed|dressed|irrigat|closed|sutured|care)|irrigat|burn|eye shield|\brings?\b|jewelry|secondary|evisceration|deglov/i,
  S2: /splint|traction|spinal|motion restriction|fracture|dislocation|realign/i
};

export interface MarchProgress {
  steps: (MarchStep & { done: boolean })[];
  /** First undone step in order, or null when every step is done. */
  next: string | null;
}

export function marchProgress(log: LogEvent[]): MarchProgress {
  const done = new Set<string>();
  for (const event of log) {
    if (event.kind === "talk" || event.t_s <= 0) continue;
    // Refusals are not done actions: "Cannot: Place IO - 15 mm is the
    // wrong needle" must not light R.
    if (event.text.startsWith("Cannot: ")) continue;
    if (AUTO_LINES.test(event.text)) continue;
    for (const step of MARCH_STEPS) {
      if (STEP_MATCH[step.id]?.test(event.text) === true) done.add(step.id);
    }
  }
  const steps = MARCH_STEPS.map((s) => ({ ...s, done: done.has(s.id) }));
  return { steps, next: steps.find((s) => !s.done)?.id ?? null };
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

export class MarchStrip {
  private readonly root = el("march-strip");
  private sim: Sim | null = null;
  private signature = "";

  /** Bind to a fresh sim on dispatch accept. Null hides the strip. */
  bind(sim: Sim | null): void {
    this.sim = sim;
    this.signature = "";
    this.root.hidden = sim === null;
    this.refresh();
  }

  /** Called every sim tick: re-render only when done-bits change. */
  refresh(): void {
    const sim = this.sim;
    if (sim === null || this.root.hidden) return;
    const progress = marchProgress(sim.log);
    const sig = progress.steps.map((s) => (s.done ? "1" : "0")).join("") + progress.next;
    if (sig === this.signature) return;
    this.signature = sig;
    this.root.innerHTML = "";
    for (const step of progress.steps) {
      const chip = document.createElement("div");
      chip.className = "march-step";
      if (step.done) chip.classList.add("done");
      if (step.id === progress.next) chip.classList.add("next");
      chip.title = step.name;
      const letter = document.createElement("span");
      letter.className = "march-letter";
      letter.textContent = step.id;
      const label = document.createElement("span");
      label.className = "march-label";
      label.textContent = step.label;
      chip.append(letter, label);
      this.root.appendChild(chip);
    }
    word(this.root);
  }
}
