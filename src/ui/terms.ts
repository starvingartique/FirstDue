// Terminology layer. The game is written in medical language (the default).
// Plain mode rewrites known terms into everyday words. Medical mode keeps the
// clinical wording and adds a hover tooltip with the plain meaning, so the
// glossary teaches instead of hiding the real terms.
//
// Applied as a DOM pass after each render: walks text nodes under a root and
// rewrites or annotates them. Engine strings, data files and the log stay in
// medical language; this is presentation only.

export type TermMode = "medical" | "plain";

/** [medical term, plain wording]. Longest first wins at the same position. */
const GLOSSARY: [string, string][] = [
  // Vitals and monitor
  ["ATLS class", "Shock stage"],
  ["Shock idx", "Shock score"],
  ["Shock index", "Shock score"],
  ["Pulse press.", "Pulse gap"],
  ["pulse pressure", "pulse gap"],
  ["SpO2", "Blood oxygen"],
  ["EtCO2", "Breathed-out CO2"],
  ["FiO2", "Oxygen fraction"],
  ["NIBP", "Auto BP cuff"],
  ["SBP/DBP", "BP top/bottom"],
  ["SBP", "Top BP number"],
  ["DBP", "Bottom BP number"],
  ["MAP", "Average BP"],
  ["GCS", "Alertness score"],
  ["Cap refill", "Color-return time"],
  ["cap refill", "color-return time"],
  ["Radial", "Wrist pulse"],
  ["radial", "wrist"],
  ["carotid", "neck"],
  ["Circ vol", "Blood left in body"],
  ["Eff loss", "Net blood lost"],
  ["Patency", "Airway openness"],
  ["sinus_tach", "fast regular heartbeat"],
  ["sinus tach", "fast regular heartbeat"],
  ["PEA arrest", "cardiac arrest (no pulse)"],
  ["PEA", "no-pulse arrest"],
  ["auscultated", "by stethoscope"],
  ["palpated", "by feel"],
  ["Tympanic", "Ear"],
  ["Temporal", "Forehead"],
  ["Glucose", "Blood sugar"],
  ["glucose", "blood sugar"],
  ["fingerstick", "finger prick"],
  ["Pupils penlight", "Check pupils with light"],
  ["Lung sounds", "Listen to lungs"],
  ["diaphoretic", "sweaty"],
  ["mottled", "blotchy"],
  ["ashen", "gray"],
  ["lethargic", "drowsy"],
  ["waveform", "breath wave"],
  // Bleeding control
  ["Hemorrhage", "Bleeding"],
  ["hemorrhage", "bleeding"],
  ["hemostatic", "clotting"],
  ["Hemostatic", "Clotting"],
  ["Kerlix", "roll gauze"],
  ["CAT", "strap tourniquet"],
  ["SOF-T", "wide tourniquet"],
  ["SAM JT", "groin tourniquet"],
  ["junctional", "groin/armpit"],
  ["TQ", "tourniquet"],
  ["VENOUS", "TOO LOOSE"],
  ["Venous tourniquet", "Too-loose tourniquet"],
  ["venous tourniquet", "too-loose tourniquet"],
  ["venous congestion", "blood backing up in the leg"],
  ["occluded", "fully clamped"],
  ["occlude", "fully clamp"],
  ["windlass", "twist rod"],
  ["windlasses", "twist rods"],
  ["Proximal", "Closer to the body"],
  ["proximal", "closer to the body"],
  ["distal", "below the injury"],
  ["Distal", "Below the injury"],
  ["femoral", "thigh-artery"],
  ["laceration", "cut"],
  ["arterial", "artery"],
  ["pulsatile", "pulsing"],
  ["engorged", "swollen"],
  ["exsanguination", "bleeding out"],
  // Lines, fluids, drugs
  ["Tourniquet (CAT)", "Tourniquet"],
  ["IO humeral", "bone needle in upper arm"],
  ["IO tibial", "bone needle in shin"],
  ["IO", "bone needle"],
  ["IV", "vein line"],
  ["Humeral", "Upper arm bone"],
  ["humeral", "upper arm bone"],
  ["Tibial", "Shin bone"],
  ["tibial", "shin bone"],
  ["AC (trauma pick)", "Inner elbow (trauma pick)"],
  ["infiltrated", "leaking under skin"],
  ["INFILTRATED", "LEAKING UNDER SKIN"],
  ["Crystal", "Salt water"],
  ["crystalloid", "salt water fluid"],
  ["NS 1 L", "Saline 1 L"],
  ["LR 1 L", "Ringer's 1 L"],
  ["gtt/min", "drops/min"],
  ["Lidocaine", "Numbing med"],
  ["lidocaine", "numbing med"],
  ["MIST", "handoff report"],
  // Airway and breathing
  ["OPA", "mouth airway"],
  ["NPA", "nose airway"],
  ["Supraglottic", "Throat airway device"],
  ["supraglottic", "throat airway device"],
  ["Intubation", "Breathing tube"],
  ["Intubate", "Place breathing tube"],
  ["ETT", "breathing tube"],
  ["BVM", "bag-mask"],
  ["NRB", "high-flow mask"],
  ["Non-rebreather", "High-flow mask"],
  ["Nasal cannula", "Nose prongs"],
  ["CPAP", "pressure mask"],
  ["cmH2O", "pressure units"],
  ["Epistaxis", "Nosebleed"],
  ["ASPIRATED", "INHALED VOMIT"],
  ["aspiration", "inhaled vomit"],
  ["contraindicated", "not allowed"],
  ["Gag", "Gag reflex"],
  ["Cord view", "Vocal cord view"],
  ["Yankauer", "rigid suction tip"],
  ["mainstem", "one-lung"],
  // Exam and general
  ["Log roll", "Roll onto side"],
  ["log roll", "roll onto side"],
  ["hypothermia", "getting cold"],
  ["Hypothermia", "Getting cold"],
  ["Abdomen RUQ", "Belly upper right"],
  ["Abdomen LUQ", "Belly upper left"],
  ["Abdomen RLQ", "Belly lower right"],
  ["Abdomen LLQ", "Belly lower left"],
  ["PMS", "pulse-movement-feeling"],
  ["Class IV", "stage 4 (worst)"],
  ["Class III", "stage 3"],
  ["Class II", "stage 2"]
];

// Plain-mode meaning shown as a tooltip in medical mode.
const MEANING = new Map<string, string>(GLOSSARY);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Acronyms and capitalized tokens match case-sensitively on word boundaries
// so "IV" never hits "IVY" and "AC" never hits "ACtion".
const TERM_RE = new RegExp(
  [...GLOSSARY]
    .map(([k]) => k)
    .sort((a, b) => b.length - a.length)
    .map((k) => `(?<![A-Za-z0-9])${escapeRe(k)}(?![A-Za-z0-9])`)
    .join("|"),
  "g"
);

let mode: TermMode = readMode();

function readMode(): TermMode {
  try {
    return localStorage.getItem("fd.terms") === "plain" ? "plain" : "medical";
  } catch {
    return "medical";
  }
}

export function getTermMode(): TermMode {
  return mode;
}

export function setTermMode(next: TermMode): void {
  mode = next;
  try {
    localStorage.setItem("fd.terms", next);
  } catch {
    // Storage blocked: the choice lasts for this session only.
  }
}

/** Rewrite one string for the current mode (used where DOM passes do not reach). */
function plainFor(match: string, at: number, whole: string): string {
  const plain = MEANING.get(match) ?? match;
  // Keep sentence case: a term that opened a sentence still opens it.
  const before = whole.slice(0, at).trimEnd();
  const opens = before === "" || /[.!?]$/.test(before);
  return opens ? plain.charAt(0).toUpperCase() + plain.slice(1) : plain;
}

export function termText(text: string): string {
  if (mode === "medical") return text;
  return text.replace(TERM_RE, (m, at: number) => plainFor(m, at, text));
}

const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "ABBR"]);

/**
 * Apply the current mode under a root. Plain: rewrite text. Medical: wrap
 * terms in <abbr> with the plain meaning (not inside <option>, which cannot
 * hold markup, and not inside the talk log, which is Josh's own words).
 */
export function applyTerms(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent === null || SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(".talk-log, [data-no-terms]") !== null) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) nodes.push(n as Text);

  for (const node of nodes) {
    const text = node.data;
    TERM_RE.lastIndex = 0;
    if (!TERM_RE.test(text)) continue;
    TERM_RE.lastIndex = 0;
    const inOption = node.parentElement?.tagName === "OPTION";
    if (mode === "plain" || inOption) {
      if (mode === "plain") node.data = text.replace(TERM_RE, (m, at: number) => plainFor(m, at, text));
      continue;
    }
    // Medical mode: annotate with tooltips.
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(TERM_RE)) {
      const at = match.index ?? 0;
      if (at > last) frag.appendChild(document.createTextNode(text.slice(last, at)));
      const abbr = document.createElement("abbr");
      abbr.className = "term";
      abbr.textContent = match[0];
      abbr.title = MEANING.get(match[0]) ?? "";
      frag.appendChild(abbr);
      last = at + match[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.replaceWith(frag);
  }
}
