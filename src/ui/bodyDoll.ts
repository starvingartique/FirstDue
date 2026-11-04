// Paper doll body view, implemented from scratch Nov 2, flipped Nov 3. A
// small patient outline for the upper-right rail, a complement to the 3D
// scene, never a replacement. Clicking a doll region opens that region's
// menu, exactly like the scene click and the chips. The patient's left is
// on the viewer's left, matching the default 3D view where the left-thigh
// wound reads on the left; L and R tags mark the patient's own sides.
// The bleeding thigh paints the shared ACE blood scale, same as the menu
// doll; markers sit on top of that fill. Markers mirror engine state
// only: TQ, packing and dressing sit on the left thigh, the same side
// the 3D wound marker uses. The engine tracks no laterality for lines,
// so limb line sites sit on the right by convention and the caption says
// so. Sternal sits on the chest center. A Y set draws a dashed ring
// around its line dot, a running warmer an orange ring.

import { REGION_IDS, REGION_LABELS, type RegionId } from "../patient/regions";
import type { Sim } from "../sim/engine";
import { bleedFillForRegion } from "./acm/format";
import { sayLine } from "./wording";

const SVG_NS = "http://www.w3.org/2000/svg";

type DollShape =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number };

/**
 * Patient's left on the viewer's left (x < 60), patient's right on the
 * viewer's right, matching the default 3D view. viewBox 0 0 120 240. Back
 * has no front-view shape; it gets a button.
 */
export const DOLL_SHAPES: Record<Exclude<RegionId, "back">, DollShape[]> = {
  head: [{ kind: "circle", cx: 60, cy: 15, r: 13 }],
  face: [{ kind: "ellipse", cx: 60, cy: 17, rx: 7, ry: 9 }],
  neck: [{ kind: "rect", x: 54, y: 28, w: 12, h: 9 }],
  chest_right: [{ kind: "rect", x: 61, y: 37, w: 22, h: 34 }],
  chest_left: [{ kind: "rect", x: 37, y: 37, w: 22, h: 34 }],
  abd_ruq: [{ kind: "rect", x: 61, y: 71, w: 22, h: 16 }],
  abd_luq: [{ kind: "rect", x: 37, y: 71, w: 22, h: 16 }],
  abd_rlq: [{ kind: "rect", x: 61, y: 87, w: 22, h: 16 }],
  abd_llq: [{ kind: "rect", x: 37, y: 87, w: 22, h: 16 }],
  pelvis: [{ kind: "rect", x: 41, y: 103, w: 38, h: 22 }],
  arm_right: [{ kind: "rect", x: 87, y: 39, w: 14, h: 62 }],
  arm_left: [{ kind: "rect", x: 19, y: 39, w: 14, h: 62 }],
  leg_right: [
    { kind: "rect", x: 62, y: 125, w: 18, h: 55 },
    { kind: "rect", x: 62, y: 180, w: 18, h: 52 }
  ],
  leg_left: [
    { kind: "rect", x: 40, y: 125, w: 18, h: 55 },
    { kind: "rect", x: 40, y: 180, w: 18, h: 52 }
  ]
};

/** Every region id has a doll target: a shape, or the back button. */
export function dollCovers(region: RegionId): boolean {
  return region === "back" || DOLL_SHAPES[region] !== undefined;
}

export type DollMarkerKind = "tq" | "packing" | "dressing" | "iv" | "io";

export interface DollMarker {
  kind: DollMarkerKind;
  x: number;
  y: number;
  /** Authored Medical label; worded at render. */
  label: string;
  ySet: boolean;
  warmer: boolean;
}

/** Anchor per line site. Limb sites sit on the right by convention. */
export function lineAnchor(site: string): { x: number; y: number } {
  if (site === "sternal") return { x: 60, y: 48 };
  if (site === "humeral") return { x: 94, y: 46 };
  if (site === "tibial") return { x: 71, y: 202 };
  if (site === "ac") return { x: 94, y: 72 };
  if (site === "forearm") return { x: 94, y: 90 };
  if (site === "hand") return { x: 94, y: 104 };
  return { x: 94, y: 90 };
}

/**
 * Markers from engine state only. TQ, packing and dressing target the
 * femoral bleed, drawn on the left thigh to match the 3D wound marker.
 */
export function markersFor(sim: Sim): DollMarker[] {
  const out: DollMarker[] = [];
  if (sim.tq.applied) {
    out.push({ kind: "tq", x: 49, y: 140, label: "TQ left thigh", ySet: false, warmer: false });
    if (sim.tq.secondApplied) {
      out.push({ kind: "tq", x: 49, y: 130, label: "2nd TQ left thigh", ySet: false, warmer: false });
    }
  }
  if (sim.packing.stage === "packed_pending_hold" || sim.packing.stage === "holding" || sim.packing.stage === "set") {
    out.push({ kind: "packing", x: 49, y: 152, label: "Packing left thigh", ySet: false, warmer: false });
  }
  if (sim.dressing.applied) {
    out.push({ kind: "dressing", x: 49, y: 162, label: "Dressing left thigh", ySet: false, warmer: false });
  }
  const anchorUse = new Map<string, number>();
  for (const line of sim.fluids.lines) {
    const anchor = lineAnchor(line.site);
    const key = `${anchor.x},${anchor.y}`;
    const n = anchorUse.get(key) ?? 0;
    anchorUse.set(key, n + 1);
    out.push({
      kind: line.kind === "io" ? "io" : "iv",
      x: anchor.x - (n % 2 === 0 ? 0 : 9) + (n > 1 ? 4 : 0),
      y: anchor.y,
      label: `Line ${line.id}: ${line.kind} ${line.site}`,
      ySet: line.ySet !== null,
      warmer: line.warmerOn
    });
  }
  return out;
}

function shapeEl(shape: DollShape): SVGElement {
  if (shape.kind === "circle") {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", String(shape.cx));
    c.setAttribute("cy", String(shape.cy));
    c.setAttribute("r", String(shape.r));
    return c;
  }
  if (shape.kind === "ellipse") {
    const e = document.createElementNS(SVG_NS, "ellipse");
    e.setAttribute("cx", String(shape.cx));
    e.setAttribute("cy", String(shape.cy));
    e.setAttribute("rx", String(shape.rx));
    e.setAttribute("ry", String(shape.ry));
    return e;
  }
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", String(shape.x));
  r.setAttribute("y", String(shape.y));
  r.setAttribute("width", String(shape.w));
  r.setAttribute("height", String(shape.h));
  r.setAttribute("rx", "2");
  return r;
}

function dot(x: number, y: number, r: number, cls: string, label: string): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", String(x));
  c.setAttribute("cy", String(y));
  c.setAttribute("r", String(r));
  c.setAttribute("class", cls);
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = sayLine(label);
  c.appendChild(title);
  return c;
}

function markerEls(marker: DollMarker): SVGElement[] {
  const els: SVGElement[] = [];
  if (marker.kind === "tq") {
    els.push(dot(marker.x, marker.y, 6, "doll-tq", marker.label));
  } else if (marker.kind === "packing") {
    const s = document.createElementNS(SVG_NS, "rect");
    s.setAttribute("x", String(marker.x - 5));
    s.setAttribute("y", String(marker.y - 5));
    s.setAttribute("width", "10");
    s.setAttribute("height", "10");
    s.setAttribute("class", "doll-packing");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = sayLine(marker.label);
    s.appendChild(title);
    els.push(s);
  } else if (marker.kind === "dressing") {
    els.push(dot(marker.x, marker.y, 5, "doll-dressing", marker.label));
  } else {
    els.push(dot(marker.x, marker.y, 4, marker.kind === "io" ? "doll-io" : "doll-iv", marker.label));
    if (marker.ySet) els.push(dot(marker.x, marker.y, 7.5, "doll-yset", `${marker.label}, Y set on`));
    if (marker.warmer) els.push(dot(marker.x, marker.y, 11, "doll-warmer", `${marker.label}, warmer on`));
  }
  return els;
}

/**
 * Build the doll for the upper-right rail. Regions with shapes render in
 * the SVG in REGION_IDS order so face paints above head; back renders as
 * a button under the figure. L and R tags mark the patient's own left and
 * right. Pure DOM, no engine writes.
 */
function sideTag(x: number, y: number, letter: string, label: string): SVGTextElement {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("class", "doll-side");
  t.textContent = letter;
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = label;
  t.appendChild(title);
  return t;
}
export function buildDoll(
  sim: Sim,
  selected: RegionId | null,
  onSelect: (region: RegionId) => void
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "doll-wrap";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 120 240");
  svg.setAttribute("class", "doll-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", sayLine("Body view. Pick a region to examine it."));
  const name = document.createElement("div");
  name.className = "doll-name";
  name.textContent = selected === null ? sayLine("Pick a region") : sayLine(REGION_LABELS[selected]);
  // Live bleed rate once per build: the fill attribute on each shape
  // beats the inherited CSS fill, so bleeding regions paint over the
  // dark base while selection still shows through the stroke.
  const rate = sim.bleedRate_mL_per_min();
  for (const region of REGION_IDS) {
    if (region === "back") continue;
    const shapes = DOLL_SHAPES[region];
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", `doll-region${region === selected ? " selected" : ""}`);
    g.setAttribute("data-region", region);
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", sayLine(REGION_LABELS[region]));
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = sayLine(REGION_LABELS[region]);
    g.appendChild(title);
    const fill = bleedFillForRegion(rate, region);
    for (const shape of shapes) {
      const node = shapeEl(shape);
      if (fill !== null) node.setAttribute("fill", fill);
      g.appendChild(node);
    }
    g.addEventListener("click", () => onSelect(region));
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        onSelect(region);
      }
    });
    g.addEventListener("mouseenter", () => {
      name.textContent = sayLine(REGION_LABELS[region]);
    });
    g.addEventListener("mouseleave", () => {
      name.textContent = selected === null ? sayLine("Pick a region") : sayLine(REGION_LABELS[selected]);
    });
    svg.appendChild(g);
  }
  svg.appendChild(sideTag(8, 120, "L", "Patient left"));
  svg.appendChild(sideTag(108, 120, "R", "Patient right"));
  for (const marker of markersFor(sim)) {
    for (const mEl of markerEls(marker)) svg.appendChild(mEl);
  }
  const back = document.createElement("button");
  back.type = "button";
  back.className = "menu-btn doll-back";
  back.textContent = sayLine("Back");
  back.setAttribute("aria-label", sayLine("Back. Log roll to check it."));
  back.addEventListener("click", () => onSelect("back"));
  const note = document.createElement("p");
  note.className = "menu-note";
  note.textContent = sayLine("Dots and rings show kit already on the patient. Line side is not tracked, so limb lines sit on the right by convention.");
  wrap.append(svg, name, back);
  wrap.appendChild(note);
  return wrap;
}
