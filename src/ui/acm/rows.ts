// ACM action row builders, implemented from scratch Nov 3. Each row is
// icon, action name, duration chip, stock chip, and state badge; selects
// and number inputs live in an expander under the row. Control values
// persist in run state across re-renders. Rows never pre-disable for a
// wrong choice (ACM rule): the click runs, and the engine refusal, when
// there is one, says why in the activity log, exactly as today.

import type { RegionId } from "../../patient/regions";
import type { Sim } from "../../sim/engine";
import { sayLine } from "../wording";
import { stockLabel } from "./format";
import type { AcmRunState } from "./types";

export interface AcmSelectDef {
  id: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface AcmNumberDef {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit: string;
}

export interface AcmBadge {
  text: string;
  cls: "on" | "set" | "in" | "running" | "check" | "done" | "warn";
}

export interface AcmRowDef {
  /** Stable row id for the expander toggle. */
  id: string;
  glyph: string;
  name: string;
  /** Duration chip, e.g. "30s". Omit for instant actions. */
  duration?: string;
  /** Stock item id for the bag/truck chip. Omit when no item matters. */
  stock?: string;
  badge?: AcmBadge | null;
  selects?: AcmSelectDef[];
  numbers?: AcmNumberDef[];
  run: () => { ok: boolean; reason?: string };
  after?: () => void;
}

export interface AcmRowHost {
  sim: Sim;
  state: AcmRunState;
  /** Re-render the overlay after a run. */
  rerender: () => void;
  /** Append engine refusals to the activity log path. */
  onCannot: (label: string, reason: string) => void;
  /** A run succeeded: clear any shown refusal. */
  onOk?: () => void;
  /** Inspect-style rows record findings instead of logging. */
  onFindings?: (region: RegionId, items: string[], kind: "inspect" | "palpate") => void;
}

function controlValue(host: AcmRowHost, id: string, def: string): string {
  return host.state.controls.get(id) ?? def;
}

export function buildSelect(
  host: AcmRowHost,
  def: AcmSelectDef,
  onPick?: () => void
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "acm-field";
  const caption = document.createElement("span");
  caption.className = "acm-field-cap";
  caption.textContent = sayLine(def.label);
  const sel = document.createElement("select");
  sel.className = "acm-select";
  sel.setAttribute("aria-label", def.label);
  const current = controlValue(host, def.id, def.options[0]?.value ?? "");
  for (const o of def.options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = sayLine(o.label);
    if (o.value === current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    host.state.controls.set(def.id, sel.value);
    onPick?.();
    host.rerender();
  });
  sel.addEventListener("keydown", (event) => event.stopPropagation());
  wrap.append(caption, sel);
  return wrap;
}

export function buildNumber(host: AcmRowHost, def: AcmNumberDef): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "acm-field";
  const caption = document.createElement("span");
  caption.className = "acm-field-cap";
  caption.textContent = sayLine(`${def.label} (${def.unit})`);
  const input = document.createElement("input");
  input.className = "acm-number";
  input.type = "number";
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step);
  input.value = controlValue(host, def.id, String(def.def));
  input.setAttribute("aria-label", def.label);
  input.addEventListener("change", () => {
    host.state.controls.set(def.id, input.value);
  });
  input.addEventListener("keydown", (event) => event.stopPropagation());
  input.addEventListener("click", (event) => event.stopPropagation());
  wrap.append(caption, input);
  return wrap;
}

export function readNumber(host: AcmRowHost, def: AcmNumberDef): number {
  const raw = Number(controlValue(host, def.id, String(def.def)));
  if (!Number.isFinite(raw)) return def.def;
  return Math.min(def.max, Math.max(def.min, raw));
}

/** Build one action row plus its expander. Appends to parent. */
export function buildRow(host: AcmRowHost, parent: HTMLElement, def: AcmRowDef): void {
  const row = document.createElement("div");
  row.className = "acm-row";
  row.dataset["row"] = def.id;
  const glyph = document.createElement("span");
  glyph.className = "acm-ico";
  glyph.textContent = def.glyph;
  const name = document.createElement("button");
  name.type = "button";
  name.className = "acm-name";
  name.textContent = sayLine(def.name);
  name.addEventListener("click", () => {
    const res = def.run();
    if (!res.ok) host.onCannot(def.name, res.reason ?? "It did not work.");
    else host.onOk?.();
    def.after?.();
    host.rerender();
  });
  row.append(glyph, name);
  if (def.duration !== undefined) {
    const chip = document.createElement("span");
    chip.className = "acm-chip";
    chip.textContent = def.duration;
    row.appendChild(chip);
  }
  if (def.stock !== undefined) {
    const stock = stockLabel(host.sim, def.stock);
    const chip = document.createElement("span");
    chip.className = `acm-stock${stock.empty ? " acm-stock-empty" : ""}`;
    chip.textContent = stock.text;
    row.appendChild(chip);
  }
  if (def.badge !== undefined && def.badge !== null) {
    const badge = document.createElement("span");
    badge.className = `acm-badge acm-badge-${def.badge.cls}`;
    badge.textContent = sayLine(def.badge.text);
    row.appendChild(badge);
  }
  const hasControls = (def.selects?.length ?? 0) > 0 || (def.numbers?.length ?? 0) > 0;
  if (hasControls) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "acm-expand";
    const open = host.state.expanded.has(def.id);
    toggle.textContent = open ? "^" : "v";
    toggle.title = sayLine("Options");
    toggle.setAttribute("aria-label", `Options for ${def.name}`);
    toggle.addEventListener("click", () => {
      if (host.state.expanded.has(def.id)) host.state.expanded.delete(def.id);
      else host.state.expanded.add(def.id);
      host.rerender();
    });
    row.appendChild(toggle);
  }
  parent.appendChild(row);
  if (hasControls && host.state.expanded.has(def.id)) {
    const exp = document.createElement("div");
    exp.className = "acm-expander";
    for (const s of def.selects ?? []) exp.appendChild(buildSelect(host, s));
    for (const n of def.numbers ?? []) exp.appendChild(buildNumber(host, n));
    parent.appendChild(exp);
  }
}

/** Small section heading inside a column. */
export function acmSection(parent: HTMLElement, label: string): void {
  const h = document.createElement("div");
  h.className = "acm-h";
  h.textContent = sayLine(label).toUpperCase();
  parent.appendChild(h);
}

/** Dim note line inside a column. */
export function acmNote(parent: HTMLElement, text: string): void {
  const div = document.createElement("div");
  div.className = "acm-note";
  div.textContent = sayLine(text);
  parent.appendChild(div);
}
