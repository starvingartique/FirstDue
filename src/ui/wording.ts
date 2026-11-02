// Shina wording layer, clean rebuild Nov 2. Medical / Plain display words,
// own implementation: a small whole-word table over freshly built DOM plus a
// pure string helper for single lines. Medical mode shows strings exactly as
// authored. Plain mode swaps known clinical words for everyday ones. No
// tooltips and no annotation: the Medical wording stays on screen in Medical
// mode instead. Remembered in localStorage under fd.wording.

export type WordingMode = "medical" | "plain";

const STORE_KEY = "fd.wording";

/**
 * Lowercase medical word first, everyday words second. Own short list for
 * the words the flow, the menu, and the kit labels actually show. Plain
 * values never contain a medical key, so a second sweep is harmless.
 */
const WORDS: Array<[string, string]> = [
  ["tourniquets", "leg bands"],
  ["tourniquet", "leg band"],
  ["hemorrhage", "heavy bleeding"],
  ["laceration", "deep cut"],
  ["arterial", "artery"],
  ["femoral", "thigh"],
  ["occluded", "clamped shut"],
  ["patency", "openness"],
  ["patent", "open"],
  ["auscultation", "stethoscope exam"],
  ["auscultated", "with stethoscope"],
  ["palpated", "felt for"],
  ["systolic", "upper"],
  ["diastolic", "lower"],
  ["spo2", "oxygen level"],
  ["cats", "leg bands"],
  ["cat", "leg band"],
  ["tq", "leg band"],
  ["kerlix", "gauze roll"],
  ["drug", "medicine"],
  ["drugs", "medicines"],
  ["bsi", "infection protection"],
  ["o2", "oxygen"],
  ["gcs", "alertness score"],
  ["sbp", "upper pressure"],
  ["dbp", "lower pressure"],
  ["hr", "pulse"],
  ["rr", "breathing rate"],
  ["temp", "temperature"],
  ["glucose", "blood sugar"]
];

/**
 * Whole-phrase swaps, matched before the word table. Lowercase match first,
 * everyday words second. Own short list for kit labels that read as units.
 */
const PHRASES: Array<[string, string]> = [
  ["ns iv bag and line", "saline drip bag and line"],
  ["hypothermia blanket", "warming blanket"],
  ["non-rebreather", "oxygen mask"],
  ["o2 d cylinder", "oxygen tank"],
  ["airway pouch", "breathing kit pouch"]
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let current: WordingMode = (() => {
  try {
    return localStorage.getItem(STORE_KEY) === "plain" ? "plain" : "medical";
  } catch {
    return "medical";
  }
})();

export function getWording(): WordingMode {
  return current;
}

export function setWording(mode: WordingMode): void {
  current = mode;
  try {
    localStorage.setItem(STORE_KEY, mode);
  } catch {
    // Storage blocked: lasts for this session only.
  }
}

function plainFor(token: string): string | null {
  const lower = token.toLowerCase();
  for (const [medical, plain] of WORDS) {
    if (medical === lower) return plain;
  }
  return null;
}

/** Plain-mode rendering of one authored line. Pure string map, no DOM. */
export function sayLine(line: string): string {
  if (current !== "plain") return line;
  let out = line;
  for (const [medical, plain] of PHRASES) {
    const re = new RegExp(escapeRegExp(medical), "gi");
    out = out.replace(re, (match) =>
      /^[A-Z]/.test(match) ? plain.charAt(0).toUpperCase() + plain.slice(1) : plain
    );
  }
  return out
    .split(/(\W+)/)
    .map((tok) => {
      if (!/^[A-Za-z0-9]+$/.test(tok)) return tok;
      const plain = plainFor(tok);
      if (plain === null) return tok;
      return /^[A-Z]/.test(tok) ? plain.charAt(0).toUpperCase() + plain.slice(1) : plain;
    })
    .join("");
}

/**
 * Word one freshly built subtree for the current mode. Medical mode is a
 * no-op by construction. Player-typed fields, selects, and anything under
 * data-no-word (player and nurse talk lines) are never rewritten.
 */
export function word(root: Element): void {
  if (current !== "plain") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node = walker.nextNode();
  while (node !== null) {
    if (node instanceof Text) {
      const el = node.parentElement;
      if (el !== null && el.closest("input, textarea, select, option, script, [data-no-word]") === null) {
        targets.push(node);
      }
    }
    node = walker.nextNode();
  }
  for (const text of targets) {
    text.data = sayLine(text.data);
  }
}
