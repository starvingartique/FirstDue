// Patient card, ACE-style: a front body diagram with clickable regions and
// markers for everything applied to the patient (tourniquets, packing,
// pressure, lines, airway, O2, probes, wrap), plus an "On patient" list.
//
// Hidden-truth rule: the card shows only what the player could see or has
// done. Wounds appear after the region is examined or exposed. "Bleeding" is
// the visible spurt the 3D wound already shows (same 30 mL/min cut the
// render loop uses), never a number. No vitals, no weight.

import type { Sim } from "../sim/engine";
import { REGION_LABELS, type RegionId } from "../patient/regions";
import { applyTerms, termText } from "./terms";
import { ICONS, type IconName } from "./icons";

const NS = "http://www.w3.org/2000/svg";

// Shapes are authored as a front view (patient's left on the viewer's right),
// then the whole figure is mirrored so the patient's LEFT sits on the
// viewer's LEFT, the way the player reads it. Text is counter-flipped.
const REGION_SHAPES: { id: RegionId; d: string }[] = [
  { id: "head", d: "M100 8c15 0 25 11 25 27s-9 30-25 30-25-14-25-30 10-27 25-27z" },
  { id: "face", d: "M88 34h24c2 0 3 1 3 3v12c0 7-7 13-15 13s-15-6-15-13V37c0-2 1-3 3-3z" },
  { id: "neck", d: "M90 64h20v15H90z" },
  { id: "chest_right", d: "M60 82l39-3v61H64c-3-20-5-40-4-58z" },
  { id: "chest_left", d: "M140 82l-39-3v61h35c3-20 5-40 4-58z" },
  { id: "abd_ruq", d: "M64 142h35v34H66z" },
  { id: "abd_luq", d: "M101 142h35l-2 34h-33z" },
  { id: "abd_rlq", d: "M66 178h33v30H67z" },
  { id: "abd_llq", d: "M101 178h33l-1 30h-32z" },
  { id: "pelvis", d: "M67 210h66l3 30H64z" },
  { id: "arm_right", d: "M58 84l-14 4-14 82-6 76 12 2 10-76 13-60z" },
  { id: "arm_left", d: "M142 84l14 4 14 82 6 76-12 2-10-76-13-60z" },
  { id: "leg_right", d: "M64 242h35l-3 88-4 76H74l-4-76z" },
  { id: "leg_left", d: "M136 242h-35l3 88 4 76h18l4-76z" }
];

// Marker anchors (viewBox units).
const P = {
  thighWound: [118, 288],
  tqHigh: 256,
  tqKnee: 332,
  tqBelt: 276,
  tq2Proximal: 248,
  tq2Distal: 300,
  roadRash: [37, 182],
  ivAc: [161, 166],
  ivForearm: [166, 202],
  ivHand: [170, 240],
  ioHumeral: [149, 98],
  ioTibial: [83, 352],
  mouth: [100, 52],
  nose: [100, 45],
  spo2: [30, 248]
} as const;

/** Visible spurt threshold, same cut the render loop uses for the wound pulse. */
const VISIBLE_BLEED = 30;

interface OnItem {
  icon: IconName;
  text: string;
  state: "ok" | "warn" | "bad" | "run";
}

function fmt(t_s: number): string {
  const m = Math.floor(t_s / 60);
  return `${m}:${String(t_s % 60).padStart(2, "0")}`;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export class BodyMap {
  private root: HTMLElement;
  private svgEl: SVGSVGElement;
  private shapes = new Map<RegionId, SVGPathElement>();
  private markers: SVGGElement;
  private outline: SVGGElement;
  private backBtn: HTMLButtonElement;
  private list: HTMLElement;
  private sig = "";

  constructor(root: HTMLElement, private readonly onPick: (region: RegionId) => void) {
    this.root = root;
    root.innerHTML = "";
    root.classList.add("pcard");

    const head = document.createElement("div");
    head.className = "pcard-h";
    head.textContent = "Patient";
    root.appendChild(head);

    this.svgEl = svg("svg", { viewBox: "0 0 200 412", class: "body-svg", role: "img", "aria-label": "Body diagram" });
    // Mirror group: everything inside is flipped left-right.
    const flip = svg("g", { transform: "translate(200 0) scale(-1 1)" });
    this.svgEl.appendChild(flip);
    this.outline = svg("g", { class: "body-outline" });
    flip.appendChild(this.outline);
    for (const { id, d } of REGION_SHAPES) {
      const path = svg("path", { d, class: "rg", "data-region": id, tabindex: 0 });
      const title = svg("title", {});
      title.textContent = REGION_LABELS[id];
      path.appendChild(title);
      path.addEventListener("click", () => this.onPick(id));
      path.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.onPick(id);
        }
      });
      flip.appendChild(path);
      this.shapes.set(id, path);
      // Wrap outline traces the same silhouette.
      this.outline.appendChild(svg("path", { d }));
    }
    this.markers = svg("g", { class: "markers" });
    flip.appendChild(this.markers);
    root.appendChild(this.svgEl);

    const sides = document.createElement("div");
    sides.className = "pcard-sides";
    const r = document.createElement("span");
    r.textContent = "L";
    this.backBtn = document.createElement("button");
    this.backBtn.type = "button";
    this.backBtn.className = "pcard-back";
    this.backBtn.textContent = "Back";
    this.backBtn.addEventListener("click", () => this.onPick("back"));
    const l = document.createElement("span");
    l.textContent = "R";
    sides.append(r, this.backBtn, l);
    root.appendChild(sides);

    const lh = document.createElement("div");
    lh.className = "pcard-h";
    lh.textContent = "On patient";
    root.appendChild(lh);
    this.list = document.createElement("div");
    this.list.className = "pcard-list";
    root.appendChild(this.list);
  }

  /** Force a full redraw (terminology change). */
  invalidate(): void {
    this.sig = "";
  }

  update(s: Sim, selected: RegionId | null, examined: Set<RegionId>): void {
    const bleeding = s.bleedRate_mL_per_min() > VISIBLE_BLEED;
    const legSeen = examined.has("leg_left") || s.exposed || s.tq.applied || s.packing.stage !== "none" || s.pressure.active || s.dressing.applied;

    // Region fills: cheap, every tick.
    for (const [id, path] of this.shapes) {
      path.classList.toggle("sel", id === selected);
      path.classList.toggle("seen", examined.has(id));
      path.classList.toggle("wound-bleed", id === "leg_left" && legSeen && bleeding);
      path.classList.toggle("wound-ok", id === "leg_left" && legSeen && !bleeding);
      path.classList.toggle("abrasion", id === "arm_right" && examined.has("arm_right"));
    }
    this.backBtn.classList.toggle("sel", selected === "back");
    this.backBtn.classList.toggle("seen", examined.has("back"));
    this.outline.classList.toggle("on", s.wrapped);

    const sig = [
      bleeding, legSeen, s.beltTrap, s.tq.applied, s.tq.placement, s.tq.timeWritten, s.tq.secondApplied, s.tq.secondPlacement,
      s.tq.loosened, s.packing.stage, Math.ceil(s.packing.holdRemaining_s / 10), s.pressure.active, s.pressure.bystanderShirt,
      s.pressure.holder, s.dressing.applied, s.dressing.tightness, s.legCongested(),
      s.fluids.lines.map((l) => `${l.id}${l.kind}${l.site}${l.infiltrated}${l.pressureBag}${Math.round((l.bag?.volumeLeft_mL ?? -1) / 25)}`).join(","),
      s.airway.adjunct?.kind, s.airway.ett?.placement, s.airway.ett?.secured, s.airway.soiled,
      s.o2.device, s.o2.flow_L_per_min, Math.round(s.o2.tankPsi / 100), s.monitor.spo2Attached, s.monitor.etco2Attached,
      s.wrapped, s.wetClothing, s.drugs.active.length, examined.has("arm_right"), s.fetches.length, s.arrested
    ].join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    this.drawMarkers(s, legSeen, bleeding, examined);
    this.drawList(s, legSeen, bleeding);
  }

  // - markers on the diagram -

  private drawMarkers(s: Sim, legSeen: boolean, bleeding: boolean, examined: Set<RegionId>): void {
    const g = this.markers;
    g.innerHTML = "";
    const band = (y: number, cls: string, label?: string): void => {
      // Band across the left thigh; slight taper with the leg.
      const half = 17 - (y - 242) * 0.02;
      g.appendChild(svg("rect", { x: 118 - half, y: y - 3, width: half * 2, height: 6, rx: 1, class: `mk-band ${cls}` }));
      g.appendChild(svg("rect", { x: 134 - (y - 242) * 0.02, y: y - 5, width: 4, height: 10, rx: 1, class: `mk-windlass ${cls}` }));
      if (label !== undefined) {
        const t = svg("text", { x: -142, y: y + 3, transform: "scale(-1 1)", "text-anchor": "end", class: `mk-label ${cls}` });
        t.textContent = label;
        g.appendChild(t);
      }
    };

    // Congested limb below a too-tight wrap or loose band: visible as purple.
    if (s.legCongested()) {
      g.appendChild(svg("path", { d: "M104 268h30l-4 62-4 76h-18l-4-76z", class: "mk-congested" }));
    }
    if (legSeen) {
      const [x, y] = P.thighWound;
      g.appendChild(svg("circle", { cx: x, cy: y, r: 6, class: `mk-wound${bleeding ? " bleeding" : ""}` }));
    } else {
      // Blood pool is visible at the scene before anyone looks closer.
      g.appendChild(svg("circle", { cx: 118, cy: 300, r: 3, class: "mk-hint" }));
    }
    if (s.beltTrap) band(P.tqBelt, "belt", "belt");
    if (s.tq.applied) {
      const y = s.tq.placement === "knee" ? P.tqKnee : P.tqHigh;
      const cls = s.tq.placement === "high_thigh" && !s.tq.loosened ? "ok" : "warn";
      band(y, cls, s.tq.timeWritten ? `T ${fmt(s.tq.appliedAt_s)}` : "no time");
    }
    if (s.tq.secondApplied) {
      const y = s.tq.secondPlacement === "proximal" || s.tq.secondPlacement === "overlapping" || s.tq.secondPlacement === "loose" ? P.tq2Proximal : P.tq2Distal;
      band(y, s.tq.secondPlacement === "proximal" ? "ok" : "warn");
    }
    if (s.packing.stage !== "none") {
      const [x, y] = P.thighWound;
      g.appendChild(svg("rect", { x: x - 5, y: y - 5, width: 10, height: 10, class: `mk-pack ${s.packing.stage === "set" ? "ok" : s.packing.stage === "failed" ? "bad" : "run"}` }));
    }
    if (s.dressing.applied) {
      const [, y] = P.thighWound;
      g.appendChild(svg("rect", { x: 103, y: y - 8, width: 30, height: 16, rx: 3, class: `mk-dress ${s.dressing.tightness === "correct" ? "ok" : "warn"}` }));
    }
    if (s.pressure.active || s.pressure.bystanderShirt) {
      const [x, y] = P.thighWound;
      g.appendChild(svg("circle", { cx: x + 12, cy: y + 10, r: 5, class: "mk-press" }));
    }
    if (examined.has("arm_right")) {
      const [x, y] = P.roadRash;
      g.appendChild(svg("ellipse", { cx: x, cy: y, rx: 6, ry: 10, class: "mk-rash" }));
    }
    for (const line of s.fluids.lines) {
      const pos =
        line.kind === "io"
          ? line.site === "humeral" ? P.ioHumeral : P.ioTibial
          : line.site === "hand" ? P.ivHand : line.site === "forearm" ? P.ivForearm : P.ivAc;
      const cls = line.infiltrated ? "bad" : line.bag !== null ? "run" : "ok";
      g.appendChild(svg(line.kind === "io" ? "rect" : "circle", line.kind === "io"
        ? { x: pos[0] - 4, y: pos[1] - 4, width: 8, height: 8, transform: `rotate(45 ${pos[0]} ${pos[1]})`, class: `mk-line ${cls}` }
        : { cx: pos[0], cy: pos[1], r: 4, class: `mk-line ${cls}` }));
    }
    if (s.airway.adjunct !== null || s.airway.ett !== null) {
      const [x, y] = P.mouth;
      g.appendChild(svg("rect", { x: x - 6, y: y - 2, width: 12, height: 5, rx: 2, class: `mk-airway ${s.airway.soiled ? "bad" : "ok"}` }));
    }
    if (s.o2.device !== "none") {
      g.appendChild(svg("path", { d: "M86 40c0-4 6-7 14-7s14 3 14 7-3 16-14 16-14-12-14-16z", class: "mk-o2" }));
    }
    if (s.monitor.spo2Attached) {
      const [x, y] = P.spo2;
      g.appendChild(svg("rect", { x: x - 4, y: y - 3, width: 8, height: 6, rx: 2, class: "mk-probe" }));
    }
    if (s.monitor.etco2Attached) {
      const [x, y] = P.nose;
      g.appendChild(svg("circle", { cx: x, cy: y, r: 2.5, class: "mk-probe" }));
    }
    if (s.drugs.active.length > 0) {
      g.appendChild(svg("rect", { x: 160, y: 10, width: 34, height: 16, rx: 8, class: "mk-drugs" }));
      const t = svg("text", { x: -177, y: 22, transform: "scale(-1 1)", class: "mk-drugs-t" });
      t.textContent = `Rx ${s.drugs.active.length}`;
      g.appendChild(t);
    }
  }

  // - "On patient" list -

  private drawList(s: Sim, legSeen: boolean, bleeding: boolean): void {
    const items: OnItem[] = [];
    if (legSeen) {
      items.push({ icon: "circulation", text: bleeding ? "L thigh wound: bleeding" : "L thigh wound: no visible bleeding", state: bleeding ? "bad" : "ok" });
    }
    if (s.beltTrap) items.push({ icon: "tourniquet", text: "Bystander belt on L thigh", state: "warn" });
    if (s.tq.applied) {
      const where = s.tq.placement === "knee" ? "over knee" : "high thigh";
      const how = s.tq.placement === "venous_loose" ? "too loose" : s.tq.placement === "knee" ? "ineffective" : s.tq.loosened ? "reassess" : "occluded";
      const ok = s.tq.placement === "high_thigh" && !s.tq.loosened;
      items.push({ icon: "tourniquet", text: `CAT ${where}, ${how}${s.tq.timeWritten ? `, T+${fmt(s.tq.appliedAt_s)}` : ", no time written"}`, state: ok ? "ok" : "warn" });
    }
    if (s.tq.secondApplied) {
      const txt = s.tq.secondPlacement === "proximal" ? "proximal, clamped" : s.tq.secondPlacement === "loose" ? "too loose" : s.tq.secondPlacement === "overlapping" ? "overlapping" : "below/over wound";
      items.push({ icon: "tourniquet", text: `2nd CAT ${txt}`, state: s.tq.secondPlacement === "proximal" ? "ok" : "warn" });
    }
    if (s.packing.stage !== "none") {
      const st = s.packing.stage;
      const txt =
        st === "holding" ? `Packing: holding${s.packing.holdRemaining_s > 0 ? ` ${fmt(s.packing.holdRemaining_s)}` : ""}`
        : st === "packed_pending_hold" ? "Packing: needs 3 min hold"
        : st === "set" ? `Packing set${s.packing.loosened ? ", reassess" : ""}`
        : "Packing failed: repack";
      items.push({ icon: "gauze", text: txt, state: st === "set" && !s.packing.loosened ? "ok" : st === "failed" ? "bad" : st === "holding" ? "run" : "warn" });
    }
    if (s.pressure.bystanderShirt) items.push({ icon: "hand", text: "Bystander holding shirt on wound", state: "warn" });
    if (s.pressure.active) items.push({ icon: "hand", text: `Direct pressure: ${s.pressure.holder ?? "?"}`, state: "run" });
    if (s.dressing.applied) {
      items.push({ icon: "bandage", text: `Pressure dressing${s.dressing.tightness !== "correct" ? ` (${s.dressing.tightness === "loose" ? "too loose" : "too tight"})` : ""}`, state: s.dressing.tightness === "correct" ? "ok" : "warn" });
    }
    for (const line of s.fluids.lines) {
      const where = line.kind === "io" ? `IO ${line.site}${line.needle_mm !== undefined ? ` ${line.needle_mm} mm` : ""}` : `${line.gauge ?? ""}g IV ${line.site}`;
      const bag = line.bag === null ? "" : `, ${line.bag.fluid === "blood" ? "blood" : line.bag.fluid.toUpperCase()} ${Math.round(line.bag.volumeLeft_mL)} mL left${line.pressureBag ? " +PB" : ""}`;
      items.push({ icon: line.bag !== null ? "drop" : "lines", text: `${where}${line.infiltrated ? " INFILTRATED" : ""}${bag}`, state: line.infiltrated ? "bad" : line.bag !== null ? "run" : "ok" });
    }
    if (s.airway.ett !== null) {
      items.push({ icon: "airway", text: `ETT ${s.airway.ett.size_mm} at ${s.airway.ett.depth_cm} cm${s.airway.ett.secured ? ", secured" : ", unsecured"}`, state: s.airway.ett.secured ? "ok" : "warn" });
    } else if (s.airway.adjunct !== null) {
      items.push({ icon: "airway", text: `${s.airway.adjunct.kind.toUpperCase()} ${s.airway.adjunct.size}`, state: "ok" });
    }
    if (s.airway.soiled) items.push({ icon: "suction", text: "Airway soiled: suction", state: "bad" });
    if (s.o2.device !== "none") {
      const name = s.o2.device.replaceAll("_", " ");
      items.push({ icon: "mask", text: `O2 ${name} ${s.o2.device === "cpap" ? "" : `${s.o2.flow_L_per_min} L/min`}, ${Math.round(s.o2.tankPsi)} psi`, state: s.o2.tankPsi <= 200 ? "bad" : "ok" });
    }
    if (s.monitor.spo2Attached) items.push({ icon: "vitals", text: "SpO2 probe on", state: "ok" });
    if (s.monitor.etco2Attached) items.push({ icon: "vitals", text: "EtCO2 on", state: "ok" });
    for (const d of s.drugs.active) items.push({ icon: "syringe", text: `${d.drugId} ${d.route}`, state: d.toxic ? "bad" : "ok" });
    if (!s.wetClothing) items.push({ icon: "blanket", text: "Wet clothing off", state: "ok" });
    if (s.wrapped) items.push({ icon: "blanket", text: "Wrapped for hypothermia", state: "ok" });
    if (s.fetches.length > 0) {
      const back = Math.max(...s.fetches.map((f) => f.remaining_s));
      items.push({ icon: "truck", text: `Partner at truck: ${s.fetches.length} item${s.fetches.length > 1 ? "s" : ""}, ${back}s`, state: "run" });
    }

    this.list.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pcard-empty";
      empty.textContent = "Nothing applied yet.";
      this.list.appendChild(empty);
    }
    for (const it of items) {
      const row = document.createElement("div");
      row.className = `on-row ${it.state}`;
      const ic = document.createElement("span");
      ic.className = "on-ic";
      ic.innerHTML = ICONS[it.icon];
      const tx = document.createElement("span");
      tx.textContent = it.text;
      row.append(ic, tx);
      this.list.appendChild(row);
    }
    applyTerms(this.list);
    for (const [id, path] of this.shapes) {
      const title = path.querySelector("title");
      if (title !== null) title.textContent = termText(REGION_LABELS[id]);
    }
    applyTerms(this.root.querySelector(".pcard-h") as HTMLElement);
  }
}
