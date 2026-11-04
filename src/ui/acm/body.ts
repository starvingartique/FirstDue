// ACM center body image, implemented from scratch Nov 3. The same 15
// regions as the paper doll, drawn bigger to fill the column. Default
// orientation is patient-left on viewer-left (Carlos's choice); the ACE
// orientation setting mirrors the figure. Regions paint by state: the
// bleeding thigh uses the shared ACE blood scale live, examined findings
// use the damage scale, unexamined parts stay dark. Icons mirror engine
// state only: TQ bands with written time, belt, packing, dressing,
// pressure, lines, O2 mask, airway marker, SpO2 dot, and the wrapped
// outline.

import type { RegionId } from "../../patient/regions";
import { REGION_IDS, REGION_LABELS } from "../../patient/regions";
import type { Sim } from "../../sim/engine";
import { DOLL_SHAPES, lineAnchor } from "../bodyDoll";

/** Local copy of the doll shape union (bodyDoll keeps its own private). */
type DollShape =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number };
import { sayLine } from "../wording";
import {
  bleedFillForRegion,
  bleedTierForRate,
  bloodStepColor,
  damageStepColor,
  fmtBandTime
} from "./format";
import { TRIAGE_LEVELS, type AcmExamState, type TriageLevel } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Damage step for examined findings. Minor rash low, spurting high. */
export function damageStepForFindings(findings: string[]): number {
  if (findings.length === 0) return 0;
  const text = findings.join(" ").toLowerCase();
  if (/no obvious injury|no wounds, no bleeding/.test(text)) return 0;
  if (/spurt|pulsatile|laceration/.test(text)) return 8;
  if (/gravel|rash|abras/.test(text)) return 3;
  if (/deformity|crepitus/.test(text)) return 4;
  return 5;
}

export interface AcmBodyHost {
  sim: Sim;
  exam: AcmExamState;
  selected: RegionId | null;
  /** ACE orientation: mirror so the patient faces the viewer. */
  mirrored: boolean;
  triage: TriageLevel;
  onSelect: (region: RegionId) => void;
  onTriage: (level: TriageLevel) => void;
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
  return r;
}

function titleEl(text: string): SVGTitleElement {
  const t = document.createElementNS(SVG_NS, "title");
  t.textContent = sayLine(text);
  return t;
}

/**
 * Region fill: the shared bleed scale while bleeding, else damage/base.
 * Bleeding is visible without an exam (same as the 3D wound pulse and the
 * pool hint), so the bleed branch is ungated; examined findings still
 * need an Inspect before they paint the damage scale.
 */
function regionFill(
  host: AcmBodyHost,
  region: RegionId,
  rate_mL_per_min: number
): string {
  const bleed = bleedFillForRegion(rate_mL_per_min, region);
  if (bleed !== null) return bleed;
  if (host.exam.inspected.has(region)) {
    return damageStepColor(damageStepForFindings(host.exam.findings.get(region) ?? []));
  }
  return bloodStepColor(0);
}

export function buildAcmBody(host: AcmBodyHost): HTMLElement {
  const { sim } = host;
  const wrap = document.createElement("div");
  wrap.className = "acm-body-wrap";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 120 240");
  svg.setAttribute("class", "acm-body");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", sayLine("Body regions. Click to select."));
  const mx = (x: number): number => (host.mirrored ? 120 - x : x);

  const canvas = document.createElementNS(SVG_NS, "g");
  if (host.mirrored) canvas.setAttribute("transform", "translate(120 0) scale(-1 1)");
  svg.appendChild(canvas);

  const rate = sim.bleedRate_mL_per_min();
  const tier = bleedTierForRate(rate);

  for (const id of REGION_IDS) {
    if (id === "back") continue;
    const shapes = DOLL_SHAPES[id];
    for (const shape of shapes) {
      const node = shapeEl(shape);
      node.setAttribute("class", `acm-part${host.selected === id ? " acm-part-sel" : ""}`);
      node.setAttribute("fill", regionFill(host, id, rate));
      node.appendChild(titleEl(REGION_LABELS[id]));
      node.addEventListener("click", () => host.onSelect(id));
      canvas.appendChild(node);
    }
  }

  // Blood pool hint under the thigh: the only pre-exam bleeding sign.
  if (tier !== "none") {
    const pool = document.createElementNS(SVG_NS, "ellipse");
    pool.setAttribute("cx", "49");
    pool.setAttribute("cy", "236");
    pool.setAttribute("rx", "16");
    pool.setAttribute("ry", "4");
    pool.setAttribute("class", "acm-pool");
    pool.appendChild(titleEl("Blood pool under the thigh"));
    canvas.appendChild(pool);
  }

  // TQ bands with written time. Time text is amber when not written.
  if (sim.tq.applied) {
    const band = document.createElementNS(SVG_NS, "rect");
    band.setAttribute("x", "39");
    band.setAttribute("y", "137");
    band.setAttribute("width", "20");
    band.setAttribute("height", "5");
    band.setAttribute("class", "acm-tq");
    band.appendChild(titleEl(`Tourniquet, ${sim.tq.placement}`));
    canvas.appendChild(band);
  }
  if (sim.tq.secondApplied) {
    const band2 = document.createElementNS(SVG_NS, "rect");
    band2.setAttribute("x", "39");
    band2.setAttribute("y", "127");
    band2.setAttribute("width", "20");
    band2.setAttribute("height", "5");
    band2.setAttribute("class", "acm-tq");
    band2.appendChild(titleEl("Second tourniquet"));
    canvas.appendChild(band2);
  }
  if (sim.beltTrap) {
    const belt = document.createElementNS(SVG_NS, "rect");
    belt.setAttribute("x", "39");
    belt.setAttribute("y", "168");
    belt.setAttribute("width", "20");
    belt.setAttribute("height", "5");
    belt.setAttribute("class", "acm-belt");
    belt.appendChild(titleEl("Bystander belt on the thigh"));
    canvas.appendChild(belt);
  }
  if (sim.packing.stage === "packed_pending_hold" || sim.packing.stage === "holding" || sim.packing.stage === "set") {
    const pack = document.createElementNS(SVG_NS, "rect");
    pack.setAttribute("x", "43");
    pack.setAttribute("y", "148");
    pack.setAttribute("width", "12");
    pack.setAttribute("height", "9");
    pack.setAttribute("class", "acm-pack");
    pack.appendChild(titleEl(`Packing (${sim.packing.stage})`));
    canvas.appendChild(pack);
  }
  if (sim.dressing.applied) {
    const dress = document.createElementNS(SVG_NS, "rect");
    dress.setAttribute("x", "39");
    dress.setAttribute("y", "125");
    dress.setAttribute("width", "20");
    dress.setAttribute("height", "55");
    dress.setAttribute("class", "acm-dress");
    dress.appendChild(titleEl("Pressure dressing"));
    canvas.appendChild(dress);
  }
  if (sim.pressure.active) {
    const hand = document.createElementNS(SVG_NS, "circle");
    hand.setAttribute("cx", "56");
    hand.setAttribute("cy", "150");
    hand.setAttribute("r", "4");
    hand.setAttribute("class", "acm-hand");
    hand.appendChild(titleEl(`Direct pressure held by ${sim.pressure.holder}`));
    canvas.appendChild(hand);
  }

  // Lines: IV dots, IO diamonds, Y dashed ring, warmer orange ring.
  for (const line of sim.fluids.lines) {
    const anchor = line.kind === "io" && line.site === "sternal" ? { x: 60, y: 48 } : lineAnchor(line.site);
    if (line.kind === "io") {
      const dia = document.createElementNS(SVG_NS, "polygon");
      dia.setAttribute(
        "points",
        `${anchor.x},${anchor.y - 4} ${anchor.x + 4},${anchor.y} ${anchor.x},${anchor.y + 4} ${anchor.x - 4},${anchor.y}`
      );
      dia.setAttribute("class", "acm-io");
      dia.appendChild(titleEl(`IO ${line.site}`));
      canvas.appendChild(dia);
    } else {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(anchor.x));
      dot.setAttribute("cy", String(anchor.y));
      dot.setAttribute("r", "3.5");
      dot.setAttribute("class", "acm-iv");
      dot.appendChild(titleEl(`IV ${line.site}`));
      canvas.appendChild(dot);
    }
    if (line.ySet !== null) {
      const ring = document.createElementNS(SVG_NS, "circle");
      ring.setAttribute("cx", String(anchor.x));
      ring.setAttribute("cy", String(anchor.y));
      ring.setAttribute("r", "6.5");
      ring.setAttribute("class", "acm-yset");
      ring.appendChild(titleEl("Y set"));
      canvas.appendChild(ring);
    }
    if (line.warmerOn) {
      const ring = document.createElementNS(SVG_NS, "circle");
      ring.setAttribute("cx", String(anchor.x));
      ring.setAttribute("cy", String(anchor.y));
      ring.setAttribute("r", "8.5");
      ring.setAttribute("class", "acm-warmer");
      ring.appendChild(titleEl("Warmer running"));
      canvas.appendChild(ring);
    }
  }

  // O2 mask outline, airway marker, SpO2 dot, wrapped outline.
  if (sim.o2.device !== "none") {
    const mask = document.createElementNS(SVG_NS, "ellipse");
    mask.setAttribute("cx", "60");
    mask.setAttribute("cy", "17");
    mask.setAttribute("rx", "9");
    mask.setAttribute("ry", "11");
    mask.setAttribute("class", "acm-mask");
    mask.appendChild(titleEl(`Oxygen: ${sim.o2.device}`));
    canvas.appendChild(mask);
  }
  if (sim.airway.ett !== null || sim.airway.adjunct !== null) {
    const marker = document.createElementNS(SVG_NS, "polygon");
    marker.setAttribute("points", "60,28 56,36 64,36");
    marker.setAttribute("class", "acm-airway");
    marker.appendChild(titleEl(sim.airway.ett !== null ? "Breathing tube" : "Airway adjunct"));
    canvas.appendChild(marker);
  }
  if (sim.monitor.spo2Attached) {
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", "94");
    dot.setAttribute("cy", "104");
    dot.setAttribute("r", "3");
    dot.setAttribute("class", "acm-spo2");
    dot.appendChild(titleEl("SpO2 probe"));
    canvas.appendChild(dot);
  }
  if (sim.wrapped) {
    const outline = document.createElementNS(SVG_NS, "rect");
    outline.setAttribute("x", "5");
    outline.setAttribute("y", "2");
    outline.setAttribute("width", "110");
    outline.setAttribute("height", "236");
    outline.setAttribute("class", "acm-wrapped");
    outline.appendChild(titleEl("Wrapped for hypothermia"));
    canvas.appendChild(outline);
  }

  // Text stays unmirrored: place at mirror-aware coordinates instead.
  const text = (x: number, y: number, cls: string, content: string, label: string): void => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", String(mx(x)));
    t.setAttribute("y", String(y));
    t.setAttribute("class", cls);
    t.setAttribute("text-anchor", "middle");
    t.textContent = content;
    t.appendChild(titleEl(label));
    svg.appendChild(t);
  };
  text(8, 120, "acm-side", "L", "Patient left");
  text(112, 120, "acm-side", "R", "Patient right");
  if (sim.tq.applied) {
    text(49, 134, sim.tq.timeWritten ? "acm-tqtime" : "acm-tqtime acm-tqtime-nowrite", fmtBandTime(sim.tq.appliedAt_s), "Tourniquet time");
  }
  wrap.appendChild(svg);

  const back = document.createElement("button");
  back.type = "button";
  back.className = "acm-back";
  back.textContent = sayLine("Back (log roll to expose)");
  back.addEventListener("click", () => host.onSelect("back"));
  wrap.appendChild(back);

  // Triage strip: player's call only, stored for the run report.
  const strip = document.createElement("div");
  strip.className = "acm-triage";
  const current = TRIAGE_LEVELS.find((t) => t.id === host.triage) ?? TRIAGE_LEVELS[0];
  const show = document.createElement("button");
  show.type = "button";
  show.className = `acm-triage-show acm-triage-${host.triage}`;
  show.textContent = sayLine(`Triage: ${current?.label ?? "None"}`);
  const picker = document.createElement("div");
  picker.className = "acm-triage-picker";
  picker.hidden = true;
  show.addEventListener("click", () => {
    picker.hidden = !picker.hidden;
  });
  for (const level of TRIAGE_LEVELS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `acm-triage-opt acm-triage-${level.id}`;
    b.textContent = sayLine(level.label);
    const id = level.id;
    b.addEventListener("click", () => host.onTriage(id));
    picker.appendChild(b);
  }
  strip.append(show, picker);
  wrap.appendChild(strip);
  return wrap;
}
