// ACM medical menu, Oct 29 slice: Examine, Airway, Breathing, Circulation,
// Medications, Lines/Fluids and Monitor tabs work; Talk moved to the bottom
// chat dock. Procedures and Log tabs land later. ACM rules hold: everything
// is present, nothing is greyed
// out for being wrong, consequences are modeled instead of locks. Gameplay
// UI never shows true engine vitals (F1 only) or the patient weight.

import type { RegionId } from "../patient/regions";
import { REGION_LABELS } from "../patient/regions";
import { loadOct28Conditions, loadTraumaLibrary } from "../data/loaders";
import type { Sim } from "../sim/engine";
import { TRUCK_BOXES } from "../sim/engine";
import type { Holder } from "../sim/types";
import type { CuffFit } from "../sim/exams";
import {
  allDrugs,
  doseLine,
  drugBoxFor,
  drugCatalog,
  drugEffectWords,
  formatDose,
  joshWorkedDose,
  presentationMath,
  pushChecks
} from "../sim/drugs";
import type { Drug } from "../data/types";
import { bvmRatePerMin, gttPerMin, tankMinutesLeft } from "../sim/airway";
import { sayLine, word } from "./wording";
import { defibMonitorLine } from "./monitorWords";

export type Tab = "examine" | "airway" | "breathing" | "circulation" | "meds" | "lines" | "monitor";

export interface MedicalMenuHooks {
  /** Fires on every user-driven tab open (clicks and kit jumps). */
  onTab?: (tab: Tab) => void;
  /** Paper doll region pick. Wired to the same path as scene and chips. */
  onSelectRegion?: (region: RegionId) => void;
}

const TAB_LABELS: Record<Tab, string> = {
  examine: "Examine",
  airway: "Airway",
  breathing: "Breathing",
  circulation: "Circulation",
  meds: "Meds",
  lines: "Lines",
  monitor: "Monitor"
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

function fmtClock(t_s: number): string {
  const m = Math.floor(t_s / 60);
  const s = t_s % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** First hemorrhage-control marker in the event log, own marker list. */
function firstHandsText(s: Sim): string {
  const marks = [/TQ time written/i, /Wound packed/i, /Direct pressure/i, /pressure dressing/i, /Take over from/i, /packing pressure/i];
  for (const e of s.log) {
    if (e.t_s > 0 && marks.some((re) => re.test(e.text))) {
      return `T+${fmtClock(e.t_s)}`;
    }
  }
  return "none yet";
}

interface SelectSpec {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  current?: string;
  onPick?: (value: string) => void;
}

export class MedicalMenu {
  private tab: Tab = "examine";
  private region: RegionId | null = null;
  private signature = "";
  private tabsNav = el("menu-tabs");
  private body = el("menu-body");
  private status = el("action-status");
  private drugId = "fentanyl";
  private drugPres = 0;
  private refDrug = "";
  // Oct 30 run context for the report rows. Set by the phase flow.
  private runLevel = "not chosen";
  private runDestination = "not chosen";
  private runOutcome = "run in progress";
  // Kit side pass: section jumped to from a kit preview, static highlight.
  private kitFocus: string | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly hooks: MedicalMenuHooks = {}
  ) {
    this.tabsNav.innerHTML = "";
    for (const tab of Object.keys(TAB_LABELS) as Tab[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab-btn";
      button.dataset["tab"] = tab;
      button.textContent = sayLine(TAB_LABELS[tab]);
      button.addEventListener("click", () => {
        this.setTab(tab);
      });
      this.tabsNav.appendChild(button);
    }
    this.render(true);
  }

  get currentTab(): Tab {
    return this.tab;
  }

  setRegion(region: RegionId | null): void {
    this.region = region;
    this.render(true);
  }

  /** Kit side pass: open a tab. Instant, no animation. */
  setTab(tab: Tab): void {
    this.tab = tab;
    this.render(true);
    this.hooks.onTab?.(tab);
  }

  /**
   * Kit side pass: open a tab and jump to one of its existing sections.
   * Instant scroll, static highlight, no animation. Never runs a procedure.
   */
  openKitAction(tab: Tab, section: string | null): void {
    this.kitFocus = section === null ? null : `${tab}|${section}`;
    this.setTab(tab);
    if (section === null) return;
    const head = [...this.body.querySelectorAll<HTMLHeadingElement>(".menu-h")].find(
      (h) => h.dataset["kitSection"] === section
    );
    head?.scrollIntoView({ block: "start" });
  }

  /** Oct 30 run context for the report rows. Updated by the phase flow. */
  setRunInfo(info: { level: string; destination: string; outcome: string }): void {
    this.runLevel = info.level;
    this.runDestination = info.destination;
    this.runOutcome = info.outcome;
  }

  /** Wording mode changed: rebuild everything from engine strings. */
  reword(): void {
    this.render(true);
  }

  /**
   * The run report as a standalone element for the end screen. Returned
   * unworded: the flow overlay words it at show time, so toggling wording
   * on the end screen rewords both directions instead of sticking.
   */
  reportElement(): HTMLElement {
    return this.buildReport();
  }

  /**
   * Clean-rebuild run report, own implementation. Live engine state plus a
   * scan of the event log: no extra bookkeeping, no history tracking.
   */
  private buildReport(): HTMLElement {
    const s = this.sim;
    const rate = s.bleedRate_mL_per_min();
    const wrap = document.createElement("div");
    const table = document.createElement("dl");
    table.className = "flow-cad";
    const rows: [string, string][] = [
      ["Clock", `T+${fmtClock(s.t_s)}`],
      ["Level", this.runLevel],
      ["Destination", this.runDestination],
      ["Outcome", this.runOutcome],
      ["Blood lost", `${Math.round(s.loss_mL)} mL`],
      ["Bleed rate now", `${Math.round(rate)} mL/min${rate < 30 ? " (controlled)" : " (NOT controlled)"}`],
      ["Shock class", s.arrested ? "arrested" : s.vitals.atlsClass],
      ["First hands on the bleed", firstHandsText(s)],
      ["Blood sweep", s.sweepReport ?? "not done"]
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.className = "flow-dt";
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.className = "flow-dd";
      dd.textContent = v;
      table.append(dt, dd);
    }
    wrap.appendChild(table);
    const traps = s.log.filter((e) => e.kind === "trap" && e.t_s > 0);
    const head = document.createElement("div");
    head.className = "flow-h";
    head.textContent = traps.length === 0 ? "Traps sprung: none" : `Traps sprung: ${traps.length}`;
    wrap.appendChild(head);
    for (const e of traps.slice(0, 6)) {
      const line = document.createElement("div");
      line.className = "flow-note";
      line.textContent = `T+${fmtClock(e.t_s)} - ${e.text}`;
      wrap.appendChild(line);
    }
    return wrap;
  }

  /** Called every sim tick: cheap status refresh, full re-render on change. */
  refresh(): void {
    const sig = this.stateSignature();
    if (sig !== this.signature) this.render(false);
    this.renderStatus();
  }

  private stateSignature(): string {
    const s = this.sim;
    return [
      this.tab,
      this.region ?? "none",
      s.tq.applied, s.tq.occluded, s.tq.placement, s.tq.secondApplied, s.tq.loosened, s.tq.failedSlack,
      s.packing.stage, s.packing.loosened,
      s.pressure.active, s.pressure.bystanderShirt,
      s.dressing.applied, s.dressing.loosened,
      s.exposed, s.beltTrap, s.wetClothing, s.wrapped,
      s.pending?.id ?? "idle",
      s.atPatient("cat_tourniquet"), s.cabinetLeft("cat_tourniquet"),
      s.vitals.atlsClass, s.arrested,
      s.airway.adjunct?.kind ?? "noadj", s.airway.adjunct?.size ?? "", s.airway.ett?.placement ?? "noett",
      s.airway.ett?.secured ?? false, s.airway.soiled, s.airway.vomited,
      s.o2.device, Math.round(s.o2.tankPsi / 50), s.o2.reservoirInflated,
      s.bvm.breaths.length, Math.round(s.bvm.gastric_0_to_10),
      s.fluids.lines.map((l) => `${l.id}:${l.kind}:${l.infiltrated}:${Math.round(l.bag?.volumeLeft_mL ?? -1)}:${l.ySet === null ? "noy" : `y${l.ySet.unitsHung}/${Math.round(l.ySet.nsLeft_mL)}`}:${l.warmerOn}:${l.dripSetOn}`).join(","),
      [...s.stagedBoxes].sort().join(","),
      s.boxTrips.map((t) => `${t.boxes.join("+")}:${t.remaining_s}`).join(","),
      s.drugs.active.length, s.drugs.flags.length,
      Object.keys(s.observed).length,
      s.monitor.spo2Attached, s.monitor.etco2Attached, s.defibPadsOn,
      s.level,
      this.drugId, this.drugPres, this.refDrug
    ].join("|");
  }

  private render(force: boolean): void {
    void force;
    this.signature = this.stateSignature();
    for (const btn of this.tabsNav.querySelectorAll<HTMLElement>(".tab-btn")) {
      const id = btn.dataset["tab"] as Tab | undefined;
      if (id !== undefined) btn.textContent = sayLine(TAB_LABELS[id]);
      btn.classList.toggle("active", id === this.tab);
    }
    this.body.innerHTML = "";
    if (this.tab === "examine") this.renderExamine();
    else if (this.tab === "airway") this.renderAirway();
    else if (this.tab === "breathing") this.renderBreathing();
    else if (this.tab === "circulation") this.renderCirculation();
    else if (this.tab === "meds") this.renderMeds();
    else if (this.tab === "lines") this.renderLines();
    else this.renderMonitor();
    this.renderStatus();
  }

  private renderStatus(): void {
    const s = this.sim;
    const bits = [`T+${fmtClock(s.t_s)}`, s.busy ? s.pendingLabel : "Hands free"];
    if (s.tq.applied && s.tq.loosened) bits.push("TQ: REASSESS");
    if (s.packing.loosened) bits.push("Packing: REASSESS");
    if (s.dressing.applied && s.dressing.loosened) bits.push("Dressing: REASSESS");
    if (s.airway.soiled) bits.push("AIRWAY: SUCTION");
    if (s.o2.tankPsi <= 200 && s.o2.device !== "none") bits.push("O2: TANK EMPTY");
    this.status.textContent = bits.join(" - ");
    word(this.status);
  }

  // - shared widgets -

  private section(title: string): HTMLElement {
    const h = document.createElement("h3");
    h.className = "menu-h";
    h.textContent = title;
    h.dataset["kitSection"] = title;
    if (this.kitFocus === `${this.tab}|${title}`) h.classList.add("kit-focus");
    this.body.appendChild(h);
    word(h);
    return h;
  }

  private note(text: string): void {
    const p = document.createElement("p");
    p.className = "menu-note";
    p.textContent = text;
    this.body.appendChild(p);
    word(p);
  }

  /** Exam findings per region. Actions re-render the menu, so findings
   * persist here and re-append on every Examine render; otherwise every
   * Inspect click would wipe its own results. Monitor rows pass no region
   * and rebuild from engine state instead. */
  private examFindings = new Map<RegionId, string[]>();

  private findingList(items: string[], stickyRegion?: RegionId | null): void {
    const ul = document.createElement("ul");
    ul.className = "menu-findings";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    this.body.appendChild(ul);
    word(ul);
    if (stickyRegion !== undefined && stickyRegion !== null) {
      const kept = this.examFindings.get(stickyRegion) ?? [];
      kept.push(...items);
      this.examFindings.set(stickyRegion, kept);
    }
  }

  /** Re-append cached findings for the open region, without re-caching. */
  private replayFindings(region: RegionId): void {
    const kept = this.examFindings.get(region);
    if (kept === undefined || kept.length === 0) return;
    const ul = document.createElement("ul");
    ul.className = "menu-findings";
    for (const item of kept) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    this.body.appendChild(ul);
    word(ul);
  }

  private selects(specs: SelectSpec[]): Map<string, HTMLSelectElement> {
    const map = new Map<string, HTMLSelectElement>();
    for (const spec of specs) {
      const wrap = document.createElement("label");
      wrap.className = "menu-opt";
      const caption = document.createElement("span");
      caption.textContent = spec.label;
      const select = document.createElement("select");
      for (const o of spec.options) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (spec.current !== undefined && o.value === spec.current) opt.selected = true;
        select.appendChild(opt);
      }
      if (spec.onPick !== undefined) {
        const pick = spec.onPick;
        select.addEventListener("change", () => {
          pick(select.value);
          this.render(true);
        });
      }
      wrap.append(caption, select);
      this.body.appendChild(wrap);
      word(wrap);
      map.set(spec.id, select);
    }
    return map;
  }

  private numberField(id: string, label: string, value: string, step: string): HTMLInputElement {
    const wrap = document.createElement("label");
    wrap.className = "menu-opt";
    const caption = document.createElement("span");
    caption.textContent = label;
    const input = document.createElement("input");
    input.id = id;
    input.type = "number";
    input.min = "0";
    input.step = step;
    input.value = value;
    input.className = "menu-num";
    wrap.append(caption, input);
    this.body.appendChild(wrap);
    word(wrap);
    return input;
  }

  private action(label: string, run: () => { ok: boolean; reason?: string }): void {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-btn";
    button.textContent = label;
    button.addEventListener("click", () => {
      const res = run();
      if (!res.ok && res.reason) {
        this.sim.addLog("info", `Cannot: ${label} - ${res.reason}`);
      }
      this.render(true);
    });
    this.body.appendChild(button);
    word(button);
  }

  // - Examine -

  private regionConditions(region: RegionId): { inspect: string[]; expose: string[] } {
    const out = { inspect: [] as string[], expose: [] as string[] };
    try {
      const oct = loadOct28Conditions();
      for (const c of oct.conditions) {
        if (c.region === region || (c.region === "systemic" && region === "chest_left")) {
          out.inspect.push(...(c.findings["inspect"] ?? []));
          out.expose.push(...(c.findings["expose"] ?? []));
        }
      }
      void loadTraumaLibrary();
    } catch {
      // Data errors already fail loudly at boot; the menu never hard-crashes.
    }
    return out;
  }

  private renderExamine(): void {
    const s = this.sim;
    const region = this.region;
    this.note("Body view lives at the upper right now. Click a doll region to open it here.");
    this.section("Blood sweep");
    this.note("A fast 12-second look for immediate wounds, bleeding and tenderness. Region exams still find the rest.");
    this.action("Blood sweep (12s)", () => s.bloodSweep());
    this.section(region ? `Examine: ${REGION_LABELS[region]}` : "Examine");

    if (region === null) {
      this.note("Select a body region (click the patient or use the chips).");
    } else if (region === "leg_left") {
      this.action("Inspect the thigh", () => {
        this.findingList(
          [
            "Bright red pulsatile spurting, timed to the pulse",
            "Blood pool expanding under the thigh",
            "Soaked jeans over the left thigh",
            s.beltTrap ? "Belt cinched mid-thigh, leg purple and swollen below it" : "No belt on the thigh"
          ],
          region
        );
        return { ok: true };
      });
      this.action("Expose with shears (10s)", () => s.exposeWound());
      if (s.exposed) {
        // State-derived, rebuilt every render: never cached, or it doubles.
        this.findingList(["Partial femoral laceration, anterior thigh, spurting arterial blood."]);
      }
      this.action("Palpate distal pulse", () => {
        const gone = (s.tq.applied && s.tq.occluded) || s.vitals.radial === "Absent";
        this.findingList(
          [
            gone ? "No distal pulse palpable." : "Distal pulse present (bleed NOT controlled).",
            s.legCongested() ? "Limb engorged, congested." : "No venous congestion."
          ],
          region
        );
        return { ok: true };
      });
    } else if (region === "back") {
      this.note("Supine patient: log roll with your partner to check the back.");
      this.action("Log roll with partner, check the back", () => {
        const res = s.movePatient("log_roll");
        if (res.ok) this.findingList(["Back exposed: no wounds, no bleeding found. Spine non-tender."], region);
        return res;
      });
    } else if (region === "arm_right") {
      this.action("Inspect the arm", () => {
        this.findingList(["Large abraded area with embedded gravel (road rash), oozing."], region);
        return { ok: true };
      });
    } else {
      const found = this.regionConditions(region);
      this.action(`Inspect ${REGION_LABELS[region]}`, () => {
        this.findingList(found.inspect.length > 0 ? found.inspect : ["No obvious injury on inspection."], region);
        return { ok: true };
      });
      this.action(`Palpate ${REGION_LABELS[region]}`, () => {
        this.findingList(["No deformity, no crepitus, non-tender except as noted."], region);
        return { ok: true };
      });
    }
    if (region !== null) this.replayFindings(region);

    this.section("Whole patient");
    this.note("Skin, temp, cap refill, pulse, lungs and GCS are timed procedures on the Monitor tab. F1 is debug only.");
    if (s.pressure.bystanderShirt) {
      this.action("Take over from the bystander", () => s.takeOverFromBystander());
    }
    this.action("Remove wet clothing (45s)", () => s.removeWetClothing());
    this.action(`Wrap for hypothermia (30s, blankets: ${s.atPatient("hypothermia_wrap_blanket")})`, () => s.applyWrap());
    this.note(`Talk to ${s.patientName} in the chat dock (V). Airway sizing, O2, lines and drugs live in their tabs.`);
  }

  // - Airway -

  private renderAirway(): void {
    const s = this.sim;
    const aw = s.airway;
    this.section("Airway status");
    const device = aw.ett !== null
      ? `ETT ${aw.ett.size_mm} at ${aw.ett.depth_cm} cm (${aw.ett.placement}${aw.ett.secured ? ", secured" : ", UNSECURED"}${aw.ett.cuffLeak ? ", CUFF LEAK" : ""})`
      : aw.adjunct !== null
        ? `${aw.adjunct.kind} ${aw.adjunct.size} (${aw.adjunct.fit})`
        : "no adjunct";
    this.note(
      `${device}. Gag ${aw.gagIntact ? "intact (OPA contraindicated)" : "absent"}.` +
        `${aw.soiled ? " SOILED: suction." : ""}${aw.aspirated ? " ASPIRATED." : ""}` +
        `${aw.epistaxis ? " Epistaxis." : ""}${aw.dislodged ? " Tube dislodged earlier." : ""}`
    );
    this.note(`No midface or basilar skull trauma on ${s.patientName}: NPA not contraindicated.`);

    this.section("OPA / NPA");
    const basicSel = this.selects([
      {
        id: "opa", label: "OPA size", options: [
          { value: "80", label: "80 mm" },
          { value: "90", label: "90 mm" },
          { value: "100", label: "100 mm" }
        ]
      },
      {
        id: "npa", label: "NPA size", options: ["26", "28", "30", "32", "34"].map((n) => ({ value: n, label: `${n} Fr` }))
      }
    ]);
    this.action("Insert OPA (15s)", () => s.insertOpa(Number(basicSel.get("opa")?.value ?? "100")));
    this.action("Insert NPA (15s)", () => s.insertNpa(Number(basicSel.get("npa")?.value ?? "30")));

    this.section("Supraglottic");
    const sgaSel = this.selects([
      {
        id: "sgakind", label: "Device", options: [
          { value: "igel", label: "i-gel" },
          { value: "kinglt", label: "King LT" }
        ]
      },
      {
        id: "sgasize", label: "Size", options: [
          { value: "3", label: "#3" },
          { value: "4", label: "#4" },
          { value: "5", label: "#5" }
        ]
      }
    ]);
    this.action("Place supraglottic (25s)", () =>
      s.placeSupraglottic(
        (sgaSel.get("sgakind")?.value ?? "igel") as "igel" | "kinglt",
        Number(sgaSel.get("sgasize")?.value ?? "4")
      )
    );

    this.section("Intubation");
    const ettSel = this.selects([
      {
        id: "size", label: "Tube", options: ["6.0", "6.5", "7.0", "7.5", "8.0", "8.5"].map((n) => ({ value: n, label: `${n} mm` }))
      },
      {
        id: "depth", label: "Depth", options: ["20", "21", "22", "23", "24", "25"].map((n) => ({ value: n, label: `${n} cm` }))
      },
      {
        id: "view", label: "Cord view", options: [
          { value: "full", label: "Cords visualized" },
          { value: "blind", label: "No view (blind)" }
        ]
      },
      {
        id: "cuff", label: "Cuff", options: [
          { value: "15", label: "15 cmH2O" },
          { value: "25", label: "25 cmH2O" },
          { value: "40", label: "40 cmH2O" }
        ]
      }
    ]);
    this.action(`Intubate (60s, tubes: ${s.atPatient("ett_set")})`, () =>
      s.intubate(
        Number(ettSel.get("size")?.value ?? "7.5"),
        Number(ettSel.get("depth")?.value ?? "22"),
        ettSel.get("view")?.value === "blind",
        Number(ettSel.get("cuff")?.value ?? "25")
      )
    );
    this.action("Secure the tube (15s)", () => s.secureTube());
    this.action("Check tube on EtCO2", () => s.checkTube());
    this.action("Remove airway device", () => s.removeAirwayDevice());

    this.section("Suction (max 10-15 s per pass)");
    const sucSel = this.selects([
      {
        id: "site", label: "Site", options: [
          { value: "mouth", label: "Mouth (Yankauer)" },
          { value: "ett", label: "ETT (14 Fr)" }
        ]
      },
      {
        id: "secs", label: "Seconds", options: [
          { value: "10", label: "10 s" },
          { value: "12", label: "12 s" },
          { value: "15", label: "15 s" }
        ]
      }
    ]);
    this.action("Suction now", () =>
      s.suctionAirway(
        (sucSel.get("site")?.value ?? "mouth") as "mouth" | "ett",
        Number(sucSel.get("secs")?.value ?? "12")
      )
    );
  }

  // - Breathing -

  private renderBreathing(): void {
    const s = this.sim;
    this.section("Oxygen");
    const mins = s.o2.device === "none" ? 0 : tankMinutesLeft(s.o2.tankPsi, s.o2.tankFactor, s.o2.device === "cpap" ? 10 : s.o2.flow_L_per_min);
    const minsText = s.o2.device === "none" ? "-" : Number.isFinite(mins) ? `${Math.floor(mins)} min left` : "-";
    this.note(
      `Device: ${s.o2.device}${s.o2.device === "non_rebreather" && !s.o2.reservoirInflated ? " (RESERVOIR DEFLATED)" : ""}. ` +
        `Tank: ${Math.round(s.o2.tankPsi)} psi, ${minsText}.`
    );
    const o2Sel = this.selects([
      {
        id: "dev", label: "Device", options: [
          { value: "nasal_cannula", label: "Nasal cannula" },
          { value: "simple_mask", label: "Simple mask" },
          { value: "non_rebreather", label: "Non-rebreather" },
          { value: "bvm_reservoir", label: "BVM + reservoir" },
          { value: "cpap", label: "CPAP (cabinet)" }
        ]
      },
      {
        id: "flow", label: "Flow", options: ["1", "2", "4", "6", "10", "15"].map((n) => ({ value: n, label: `${n} L/min` }))
      },
      {
        id: "res", label: "NRB reservoir", options: [
          { value: "yes", label: "Pre-inflated" },
          { value: "no", label: "Deflated" }
        ]
      },
      {
        id: "peep", label: "CPAP", options: [
          { value: "5", label: "5 cmH2O" },
          { value: "7.5", label: "7.5 cmH2O" },
          { value: "10", label: "10 cmH2O" }
        ]
      }
    ]);
    this.action("Apply O2 (20s)", () =>
      s.applyO2(
        (o2Sel.get("dev")?.value ?? "nasal_cannula") as "nasal_cannula" | "simple_mask" | "non_rebreather" | "bvm_reservoir" | "cpap",
        Number(o2Sel.get("flow")?.value ?? "4"),
        o2Sel.get("res")?.value === "yes",
        Number(o2Sel.get("peep")?.value ?? "5"),
        0.5
      )
    );
    this.action("Pre-inflate NRB reservoir", () => s.preinflateReservoir());
    this.action("Remove O2 device", () => s.removeO2());
    this.action(`Swap to M cylinder (30s, truck: ${s.cabinetLeft("o2_tank_m")})`, () => s.swapTank());

    this.section("BVM (1 breath every 6 s, 500-600 mL)");
    const rate = bvmRatePerMin(s.bvm, s.t_s);
    this.note(`Mask: ${s.bvm.maskSize}. Rate last 60 s: ${rate}/min. Overvent breaths: ${s.bvm.overventBreaths}.`);
    const maskSel = this.selects([
      {
        id: "mask", label: "Mask", options: [
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" }
        ]
      }
    ]);
    this.action("Fit mask", () => s.setBvmMask((maskSel.get("mask")?.value ?? "large") as "small" | "medium" | "large"));
    this.action("Squeeze: third (~550 mL, correct)", () => s.squeezeBvm(550));
    this.action("Squeeze: gentle (~400 mL, shallow)", () => s.squeezeBvm(400));
    this.action("Squeeze: half (~800 mL, too big)", () => s.squeezeBvm(800));
    this.action("Squeeze: full (~1200 mL, way too big)", () => s.squeezeBvm(1200));
  }

  // - Circulation -

  private renderCirculation(): void {
    const s = this.sim;
    this.section("Hemorrhage status");
    const tqText = !s.tq.applied
      ? "Tourniquet: none on"
      : s.tq.placement === "venous_loose"
        ? "Tourniquet: VENOUS (too loose), bleed worse"
        : s.tq.placement === "knee"
          ? "Tourniquet: over the knee, ineffective"
          : s.tq.residualFlow_0_to_1 > 0 && !s.tq.secondApplied
            ? `Tourniquet: occluded, ${Math.round(s.tq.residualFlow_0_to_1 * 100)}% residual (2nd TQ?)`
            : "Tourniquet: occluded";
    this.note(
      `${tqText}${s.tq.applied && s.tq.loosened ? " - LOOSENED, reassess" : ""}. ` +
        `Packing: ${s.packing.stage}${s.packing.loosened ? " - LOOSENED" : ""}. ` +
        `Pressure: ${s.pressure.bystanderShirt ? "bystander shirt" : s.pressure.active ? `held (${s.pressure.holder})` : "none"}. ` +
        `Dressing: ${s.dressing.applied ? s.dressing.tightness : "none"}${s.dressing.soaked ? " (SOAKED)" : ""}.`
    );
    if (s.beltTrap) this.note("Belt trap still on the thigh: x1.3 bleed, leg purple and swollen.");

    this.section("Tourniquet (CAT)");
    const tqSel = this.selects([
      { id: "strap", label: "Strap pull", options: [{ value: "tight", label: "Pulled tight" }, { value: "slack", label: "Left slack" }] },
      { id: "place", label: "Placement", options: [{ value: "high_thigh", label: "High thigh, groin crease" }, { value: "knee", label: "Over the knee" }] },
      {
        id: "turns", label: "Half-turns", options: ["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: `${n} half-turns` }))
      },
      { id: "time", label: "Write time", options: [{ value: "yes", label: "Write the time" }, { value: "no", label: "Skip it" }] }
    ]);
    this.action(`Apply CAT high and tight (30s, have ${s.atPatient("cat_tourniquet")})`, () =>
      s.applyTQ({
        strapTight: tqSel.get("strap")?.value === "tight",
        placement: tqSel.get("place")?.value === "knee" ? "knee" : "high_thigh",
        halfTurns: Number(tqSel.get("turns")?.value ?? "3"),
        writeTime: tqSel.get("time")?.value === "yes"
      })
    );

    this.section("Second tourniquet");
    const tq2Sel = this.selects([
      {
        id: "place2", label: "Placement", options: [
          { value: "proximal", label: "Proximal to first, side by side" },
          { value: "distal", label: "Below the first" },
          { value: "over_wound", label: "Over the wound" },
          { value: "overlapping", label: "Overlapping windlasses" }
        ]
      },
      { id: "loosen", label: "First TQ", options: [{ value: "keep", label: "Leave tight" }, { value: "loosen", label: "Loosen it to place" }] }
    ]);
    this.action(`Apply second CAT (30s, have ${s.atPatient("cat_tourniquet")})`, () =>
      s.applySecondTQ({
        placement: (tq2Sel.get("place2")?.value ?? "proximal") as "proximal" | "distal" | "over_wound" | "overlapping",
        loosenedFirst: tq2Sel.get("loosen")?.value === "loosen"
      })
    );

    this.section("Packing + 3 min pressure");
    const packSel = this.selects([
      { id: "tech", label: "Technique", options: [{ value: "packed", label: "Pack into wound" }, { value: "on_top", label: "Lay on top" }] },
      { id: "gauze", label: "Gauze", options: [{ value: "hemostatic", label: "Hemostatic" }, { value: "plain", label: "Plain Kerlix" }] }
    ]);
    const holdSel = this.selects([
      {
        id: "holder", label: "Hold by", options: [
          { value: "partner", label: "Partner (you stay free)" },
          { value: "player", label: "You (3 min tied up)" },
          { value: "bystander", label: "Bystander" }
        ]
      }
    ]);
    this.action("Pack the wound (60s)", () =>
      s.packWound({
        technique: packSel.get("tech")?.value === "on_top" ? "on_top" : "packed",
        gauze: packSel.get("gauze")?.value === "plain" ? "plain" : "hemostatic"
      })
    );
    this.action("Hold pressure 3 min", () => s.holdPacking((holdSel.get("holder")?.value ?? "partner") as Holder));
    if (s.packing.stage === "holding" || s.packing.stage === "packed_pending_hold") {
      this.action("Release pressure early (risky)", () => s.releasePackingEarly());
    }
    if (s.packing.stage === "set" || s.packing.stage === "holding") {
      this.action("Lift the edge to peek (risky)", () => s.peekPacking());
    }

    this.section("Direct pressure");
    const pressSel = this.selects([
      {
        id: "qual", label: "Quality", options: [
          { value: "firm", label: "Firm, bodyweight" },
          { value: "light", label: "Light" },
          { value: "off_source", label: "Off the source" }
        ]
      },
      {
        id: "pholder", label: "Holder", options: [
          { value: "player", label: "You" },
          { value: "partner", label: "Partner" },
          { value: "bystander", label: "Bystander" }
        ]
      }
    ]);
    this.action("Start direct pressure (3s)", () =>
      s.startPressure({
        quality: (pressSel.get("qual")?.value ?? "firm") as "firm" | "light" | "off_source",
        holder: (pressSel.get("pholder")?.value ?? "player") as Holder
      })
    );
    if (s.pressure.active) {
      this.action("Release pressure", () => s.releasePressure());
      this.action("Swap holder (reset fatigue)", () =>
        s.swapPressureHolder(s.pressure.holder === "partner" ? "player" : "partner")
      );
    }

    this.section("Pressure dressing");
    const dressSel = this.selects([
      {
        id: "tight", label: "Tightness", options: [
          { value: "correct", label: "Correct" },
          { value: "loose", label: "Too loose" },
          { value: "tight", label: "Too tight" }
        ]
      }
    ]);
    this.action("Apply pressure dressing (65s)", () =>
      s.applyDressing((dressSel.get("tight")?.value ?? "correct") as "correct" | "loose" | "tight")
    );
    if (s.dressing.applied) this.action("Remove dressing", () => s.removeDressing());

    this.section("Trap + reassessment");
    if (s.beltTrap) this.action("Remove the bystander belt (5s)", () => s.removeBelt());
    this.action("Reassess hemorrhage control (15s)", () => s.reassessBleeding());

    this.section("Kit: jump bag is at the patient");
    this.note(
      `CAT: ${s.atPatient("cat_tourniquet")} here (cabinet ${s.cabinetLeft("cat_tourniquet")}). ` +
        `Hemostatic: ${s.atPatient("hemostatic_gauze_zfold")} here (cabinet ${s.cabinetLeft("hemostatic_gauze_zfold")}). ` +
        `6in bandage: ${s.atPatient("pressure_bandage_6in")} here (cabinet ${s.cabinetLeft("pressure_bandage_6in")}).`
    );
    const fetchSel = this.selects([
      {
        id: "item", label: "Fetch", options: [
          { value: "cat_tourniquet", label: "CAT" },
          { value: "hemostatic_gauze_zfold", label: "Hemostatic gauze" },
          { value: "pressure_bandage_6in", label: "6 in bandage" },
          { value: "softt_wide_tourniquet", label: "SOF-T" },
          { value: "junctional_tourniquet_samjt", label: "SAM JT" },
          { value: "hypothermia_wrap_blanket", label: "Wrap blanket" },
          { value: "o2_tank_m", label: "O2 M cylinder" },
          { value: "whole_blood_unit", label: `Whole blood (here ${s.atPatient("whole_blood_unit")}, truck ${s.cabinetLeft("whole_blood_unit")})` },
          { value: "y_tubing_blood", label: `Y tubing (here ${s.atPatient("y_tubing_blood")}, truck ${s.cabinetLeft("y_tubing_blood")})` },
          { value: "fluid_warmer", label: "Fluid warmer" },
          { value: "cpap_unit", label: "CPAP" }
        ]
      },
      {
        id: "runner", label: "Runner", options: [
          { value: "partner", label: "Partner (you stay free)" },
          { value: "player", label: "You (50s)" }
        ]
      }
    ]);
    this.action("Fetch from the truck (50s round trip)", () =>
      s.fetchFromTruck(fetchSel.get("item")?.value ?? "cat_tourniquet", (fetchSel.get("runner")?.value ?? "partner") as Holder)
    );

    this.section("Truck: stage boxes at the patient");
    this.note("One partner trip (50s) brings the whole box. A box joins a trip already running. Narc, RSI, and critical care drugs stay locked until their box stages.");
    for (const trip of s.boxTrips) {
      const labels = trip.boxes.map((id) => TRUCK_BOXES.find((b) => b.id === id)?.label ?? id).join(", ");
      this.note(`Partner trip running: ${labels} (${trip.remaining_s}s left).`);
    }
    for (const box of TRUCK_BOXES) {
      if (s.stagedBoxes.has(box.id)) {
        this.note(`${box.label}: staged at the patient.`);
      } else if (s.boxTrips.some((t) => t.boxes.includes(box.id))) {
        this.note(`${box.label}: on the way.`);
      } else {
        this.action(`Partner: bring the ${box.label} (50s)`, () => s.stageBox(box.id));
      }
    }
  }

  // - Medications (minimal prep loop) -

  private renderMeds(): void {
    const s = this.sim;
    const catalog = drugCatalog();
    this.section("Drug box: pick, prep, push");
    const usable = catalog.usable.find((u) => u.drug.id === this.drugId) ?? catalog.usable[0];
    if (usable === undefined) {
      this.note("No usable drugs in this build.");
      return;
    }
    if (usable.drug.id !== this.drugId) this.drugId = usable.drug.id;
    const presEntry = usable.presentations.find((p) => p.index === this.drugPres) ?? usable.presentations[0];
    if (presEntry === undefined) {
      this.note("No computable presentation.");
      return;
    }
    if (presEntry.index !== this.drugPres) this.drugPres = presEntry.index;
    const presentation = usable.drug.presentations[presEntry.index];
    this.selects([
      {
        id: "drug", label: "Drug", current: this.drugId,
        options: catalog.usable.map((u) => {
          const box = drugBoxFor(u.drug.location);
          return { value: u.drug.id, label: box === null ? u.drug.name : `${u.drug.name} (in ${box.label})` };
        }),
        onPick: (value) => {
          this.drugId = value;
          this.drugPres = 0;
        }
      },
      {
        id: "pres", label: "Vial", current: String(this.drugPres),
        options: usable.presentations.map((p) => ({
          value: String(p.index),
          label: usable.drug.presentations[p.index]?.label ?? `presentation ${p.index}`
        })),
        onPick: (value) => {
          this.drugPres = Number(value);
        }
      }
    ]);
    this.note(
      `Vial reads: ${presentation?.label ?? "?"}. ` +
        `Protocol standard: ${formatDose(usable.standard.mcg)} ${usable.standard.route} ` +
        `(${usable.standard.indication}). Peak in ${usable.pk_s[1]}s.`
    );
    const math = presentation === undefined ? null : presentationMath(presentation);
    const defaultAmount = math === null ? 0 : Math.round((usable.standard.mcg / math.mcgPer) * 100) / 100;
    const amountInput = this.numberField("drug-amount", `Draw (${math?.unitLabel ?? "mL"}, 1x = ${defaultAmount})`, String(defaultAmount), "0.1");
    const needsLine = usable.standard.route.toUpperCase().startsWith("IV") || usable.standard.route.toUpperCase().startsWith("IO");
    const running = s.fluids.lines.filter((l) => l.patent && !l.infiltrated);
    let lineSel: Map<string, HTMLSelectElement> | null = null;
    if (needsLine) {
      lineSel = this.selects([
        {
          id: "line", label: "Push through", options: running.length > 0
            ? running.map((l) => ({ value: String(l.id), label: `Line ${l.id} (${l.kind} ${l.site})` }))
            : [{ value: "-1", label: "No patent line: start one first" }]
        }
      ]);
    }
    const syrSel = this.selects([
      {
        id: "syr", label: "Syringe", options: [
          { value: "syringe_3ml", label: `3 mL (have ${s.atPatient("syringe_3ml")})` },
          { value: "syringe_10ml", label: `10 mL (have ${s.atPatient("syringe_10ml")})` },
          { value: "syringe_20ml", label: `20 mL (have ${s.atPatient("syringe_20ml")})` }
        ]
      }
    ]);
    const lineMap = lineSel;
    this.action("Prep and push (45s)", () => {
      const lineId = lineMap === null ? null : Number(lineMap.get("line")?.value ?? "-1");
      return s.prepPush(usable.drug.id, presEntry.index, Number(amountInput.value), syrSel.get("syr")?.value ?? "syringe_10ml", lineId);
    });
    const needBox = drugBoxFor(usable.drug.location);
    if (needBox !== null && !s.stagedBoxes.has(needBox.id)) {
      this.action(`Partner: bring the ${needBox.label} (50s)`, () => s.stageBox(needBox.id));
    }

    this.section("On board");
    if (s.drugs.active.length === 0) this.note("No active drugs.");
    for (const d of s.drugs.active) {
      this.note(`${d.drugId} ${d.ratio_to_standard}x ${d.route}, peak ${d.peak_s}s, ${d.toxic ? "TOXIC" : "in range"}.`);
    }
    for (const flag of s.drugs.flags) this.note(`TOXICITY: ${flag}.`);
    this.note(`${catalog.noDose.length + catalog.noMapping.length} of 104 drugs are unusable in this build (no single standard dose or no token mapping). Listed in TODO_CLINICAL, never guessed.`);

    this.section("Before every push");
    const checks = pushChecks();
    for (const item of checks.checks) this.note(`Check: ${item}`);
    this.note(checks.note);

    this.section("Drug reference: this drug");
    this.drugRefCard(usable.drug);

    this.section("Drug reference: all 104");
    const all = allDrugs();
    const ref = all.find((d) => d.id === this.refDrug) ?? usable.drug;
    if (ref.id !== this.refDrug) this.refDrug = ref.id;
    this.selects([
      {
        id: "refdrug", label: "Look up", current: this.refDrug,
        options: all.map((d) => ({ value: d.id, label: d.name })),
        onPick: (value) => {
          this.refDrug = value;
        }
      }
    ]);
    this.drugRefCard(ref);
  }

  /**
   * Full reference card for one drug, from the existing drug data only:
   * dose, route, repeat, onset and lasts, body effects, too-much dangers,
   * do-not-give-if, and the Josh 80 kg worked dose. Any field missing in
   * the data reads TODO_CLINICAL: never invented, never taken from the
   * advisor PDF into a data value. Wording only at render.
   */
  private drugRefCard(drug: Drug): void {
    const head = drug.class === undefined ? drug.name : `${drug.name} (${drug.class})`;
    this.note(head);
    const first = drug.dosing[0];
    if (first === undefined) {
      this.note("Dose: TODO_CLINICAL: no dosing protocol in data.");
    } else {
      this.note(`Use: ${first.indication}. Dose: ${doseLine(first)}. Route: ${first.route.join(", ") || "TODO_CLINICAL"}.`);
      this.note(`Repeat: ${first.repeat ?? "TODO_CLINICAL: no repeat in data"}. Max: ${first.max ?? "TODO_CLINICAL: no max in data"}.`);
      if (first.notes !== undefined) this.note(first.notes);
      if (drug.dosing.length > 1) {
        this.note(`Plus ${drug.dosing.length - 1} more protocol(s): ${drug.dosing.slice(1).map((d) => d.indication).join("; ")}.`);
      }
    }
    const onset = Object.entries(drug.onset ?? {});
    this.note(
      onset.length === 0
        ? "Onset: TODO_CLINICAL: no onset in data."
        : `Onset: ${onset.map(([route, when]) => `${route} ${when}`).join("; ")}.`
    );
    const lasts = Object.entries(drug.duration ?? {});
    this.note(
      lasts.length === 0
        ? "Lasts: TODO_CLINICAL: no duration in data."
        : `Lasts: ${lasts.map(([route, when]) => `${route} ${when}`).join("; ")}.`
    );
    const effects = drugEffectWords(drug);
    if (effects.length === 0) this.note("Does to the body: TODO_CLINICAL: no effects in data.");
    else this.findingList([`Does to the body: ${effects.join("; ")}.`]);
    if ((drug.dangers ?? []).length === 0) this.note("Too much: TODO_CLINICAL: no dangers in data.");
    else this.findingList([`Too much: ${drug.dangers?.join("; ")}.`]);
    if ((drug.contraindications ?? []).length === 0) this.note("Do not give if: TODO_CLINICAL: no contraindications in data.");
    else this.findingList([`Do not give if: ${drug.contraindications?.join("; ")}.`]);
    this.note(joshWorkedDose(drug));
    this.note(`Kept in: ${drug.location}.`);
  }

  // - Lines and fluids -

  private renderLines(): void {
    const s = this.sim;
    this.section("Lines");
    if (s.fluids.lines.length === 0) this.note("No lines yet. In shock, IO beats IV: 95 percent in 30 s.");
    for (const line of s.fluids.lines) {
      const bag = line.bag === null
        ? "no bag"
        : `${line.bag.fluid} ${Math.round(line.bag.volumeLeft_mL)}/${line.bag.volumeTotal_mL} mL (${line.bag.drip})`;
      const gtt = line.bag === null ? "" : ` ${Math.round(gttPerMin(line.flow_mL_per_min * 60, line.bag.drip === "micro60" ? 60 : 15))} gtt/min ref`;
      const device = line.gauge !== undefined
        ? ` ${line.gauge}g`
        : line.site === "sternal"
          ? " (FAST1)"
          : ` ${line.needle_mm}mm`;
      const ySet = line.ySet === null
        ? ""
        : `, Y set ${line.ySet.unitsHung}/4 units, NS ${Math.round(line.ySet.nsLeft_mL)} mL` +
          `${line.warmerOn ? ", warmer 38 C" : ""}`;
      this.note(
        `Line ${line.id}: ${line.kind} ${line.site}${device}` +
          `${line.infiltrated ? " INFILTRATED" : ""}${line.pressureBag ? " +pressure bag" : ""}` +
          `${line.dripSetOn ? " +drip set" : ""}${ySet}, ` +
          `${Math.round(line.flow_mL_per_min)} mL/min, ${bag}.${gtt}`
      );
    }

    this.section("Start IV (75s)");
    const ivSel = this.selects([
      {
        id: "site", label: "Site", options: [
          { value: "ac", label: "AC (trauma pick)" },
          { value: "forearm", label: "Forearm" },
          { value: "hand", label: "Hand" }
        ]
      },
      {
        id: "gauge", label: "Catheter", options: [14, 16, 18, 20, 22, 24].map((g) => ({
          value: String(g),
          label: `${g}g (have ${s.atPatient(`iv_cath_${g}g`)})`
        }))
      }
    ]);
    this.action("Attempt IV", () =>
      s.startIv(
        (ivSel.get("site")?.value ?? "ac") as "ac" | "forearm" | "hand",
        Number(ivSel.get("gauge")?.value ?? "18")
      )
    );

    this.section("Start IO (30s, 95 percent)");
    this.note(`${s.patientName}: 25 mm tibial, 45 mm humeral. No fracture, burn, prior IO or prosthesis at either site.`);
    this.note(`Sternal: FAST1, no drill, device sets depth, one attempt per patient (have ${s.atPatient("io_fast1")}). Sternal values are TUNE and need medic sign-off.`);
    const ioSel = this.selects([
      {
        id: "site", label: "Site", options: [
          { value: "tibial", label: "Tibial" },
          { value: "humeral", label: "Humeral" },
          { value: "sternal", label: "Sternal (FAST1)" }
        ]
      },
      {
        id: "needle", label: "Needle", options: ["15", "25", "45"].map((n) => ({
          value: n,
          label: `${n} mm (have ${s.atPatient(`io_needle_${n}mm`)})`
        }))
      },
      {
        id: "lido", label: "Lidocaine", options: [
          { value: "yes", label: "40 mg IO first" },
          { value: "no", label: "Skip it (pain 10/10)" }
        ]
      }
    ]);
    this.action("Place IO", () => {
      const site = ioSel.get("site")?.value ?? "tibial";
      if (site === "sternal") return s.startSternalIo(ioSel.get("lido")?.value === "yes");
      return s.startIo(
        site as "tibial" | "humeral",
        Number(ioSel.get("needle")?.value ?? "25"),
        ioSel.get("lido")?.value === "yes"
      );
    });

    this.section("Fluids (explicit volumes)");
    const running = s.fluids.lines.filter((l) => l.patent && !l.infiltrated);
    if (running.length === 0) {
      this.note("Hang a bag once a line is in.");
    } else {
      const hangSel = this.selects([
        {
          id: "line", label: "Line", options: running.map((l) => ({ value: String(l.id), label: `Line ${l.id}` }))
        },
        {
          id: "fluid", label: "Bag", options: [
            { value: "ns", label: `NS 1 L (have ${s.atPatient("ns_1000ml")})` },
            { value: "lr", label: `LR 1 L (have ${s.atPatient("lr_1000ml")})` }
          ]
        },
        {
          id: "drip", label: "Set", options: [
            { value: "macro15", label: "Macro 15" },
            { value: "macro10", label: "Macro 10" },
            { value: "macro20", label: "Macro 20" },
            { value: "micro60", label: "Micro 60" }
          ]
        }
      ]);
      this.action("Hang bag (30s, 20s on a set line)", () =>
        s.hangFluids(
          Number(hangSel.get("line")?.value ?? "-1"),
          (hangSel.get("fluid")?.value ?? "ns") as "ns" | "lr",
          hangSel.get("drip")?.value ?? "macro15"
        )
      );
      const pbSel = this.selects([
        {
          id: "line", label: "Pressure bag on", options: running.map((l) => ({ value: String(l.id), label: `Line ${l.id}` }))
        }
      ]);
      this.action("Apply pressure bag (300 mmHg)", () => s.applyPressureBag(Number(pbSel.get("line")?.value ?? "-1")));
    }
    this.note("First bag on a line spikes the drip set; later bags reuse it and hang in 20 s. Crystal: +1 L now, ~250 mL at 60 min.");

    this.section("Blood (Y tubing + warmer)");
    this.note(
      `Prime needs a Y set (here ${s.atPatient("y_tubing_blood")}, truck ${s.cabinetLeft("y_tubing_blood")}), ` +
        `NS 250 (have ${s.atPatient("ns_250ml")}, else NS 1 L), and the warmer. ` +
        `Whole blood: here ${s.atPatient("whole_blood_unit")}, truck ${s.cabinetLeft("whole_blood_unit")}. ` +
        `Set stays on the line: up to 4 units or 4 h (TUNE), then replace it. Only NS and blood run on a Y line.`
    );
    if (running.length === 0) {
      this.note("Prime and hang once a line is in.");
    } else {
      const bloodSel = this.selects([
        {
          id: "line", label: "Line", options: running.map((l) => ({ value: String(l.id), label: `Line ${l.id}` }))
        },
        {
          id: "units", label: "Units", options: [
            { value: "1", label: "1 unit (500 mL)" },
            { value: "2", label: "2 units back to back (1,000 mL)" }
          ]
        }
      ]);
      const bloodLine = (): number => Number(bloodSel.get("line")?.value ?? "-1");
      this.action("Prime Y tubing + warmer (45s)", () => s.primeYSet(bloodLine()));
      this.action("Hang blood (30s)", () =>
        s.hangBloodUnits(bloodLine(), bloodSel.get("units")?.value === "2" ? 2 : 1)
      );
      this.action("Replace the Y set (45s)", () => s.replaceYSet(bloodLine()));
      if (!s.stagedBoxes.has("box_blood_kit")) {
        this.action("Partner: bring the Blood kit (50s)", () => s.stageBox("box_blood_kit"));
      }
    }
    if (s.fluids.lines.length > 0) {
      const pullSel = this.selects([
        {
          id: "line", label: "Pull", options: s.fluids.lines.map((l) => ({ value: String(l.id), label: `Line ${l.id}` }))
        }
      ]);
      this.action("Pull line (stops its bag)", () => s.pullLine(Number(pullSel.get("line")?.value ?? "-1")));
    }
  }

  // - Monitor and manual vitals -

  private renderMonitor(): void {
    const s = this.sim;
    this.section(`Monitor (L${s.level})`);
    if (s.level === 1) {
      const v = s.vitals;
      this.findingList([
        `HR ${v.hr_bpm}  SBP/DBP ${v.sbp_mmhg}/${v.dbp_mmhg}  RR ${v.rr_per_min}`,
        `SpO2 ${v.spo2_pct}  EtCO2 ${v.etco2_mmhg}${v.etco2Waveform ? " (waveform)" : ""}  GCS ${v.gcs_text}`,
        `Temp ${v.temp_C} C  Glucose ${v.glucose_mg_per_dL}  Pain ${v.pain_0_to_10}/10`
      ]);
      this.action("Switch to L2 (manual vitals)", () => {
        s.setLevel(2);
        return { ok: true };
      });
      return;
    }
    this.action("Switch to L1 (auto vitals)", () => {
      s.setLevel(1);
      return { ok: true };
    });
    const o = s.observed;
    const rows: string[] = [];
    const show = (label: string, v: { value: string; t_s: number; method: string } | undefined): void => {
      rows.push(v === undefined ? `${label}: not measured` : `${label}: ${v.value} (T+${fmtClock(v.t_s)}, ${v.method})`);
    };
    show("HR", o.hr);
    show("RR", o.rr);
    show("SBP", o.sbp);
    show("DBP", o.dbp);
    show("SpO2", o.spo2);
    show("Temp", o.temp);
    show("Glucose", o.glucose);
    show("Pupils", o.pupils);
    show("Skin", o.skin);
    show("Lungs", o.lungs);
    show("GCS", o.gcs);
    show("Cap refill", o.capRefill);
    this.findingList(rows);

    this.section("Live monitor");
    const spo2 = s.monitorSpo2();
    this.note(
      spo2 === null
        ? "SpO2 probe off."
        : "none" in spo2
          ? `SpO2: ${spo2.none}`
          : `SpO2: ${spo2.value} (${spo2.note})`
    );
    const etco2 = s.monitorEtco2();
    this.note(
      etco2 === null
        ? "EtCO2 off."
        : etco2.waveform
          ? `EtCO2: waveform present, ${etco2.value} mmHg.`
          : `EtCO2: NO waveform${s.airway.ett !== null ? " (tube problem until proven otherwise)" : ""}.`
    );
    this.action("Attach SpO2 probe", () => s.attachSpo2());
    this.action("Read SpO2 (15s)", () => s.readSpo2());
    this.action("Attach waveform EtCO2", () => s.attachEtco2());
    if (s.defibPadsOn) this.note(defibMonitorLine(s));
    this.action("Stick defib pads (monitor only)", () => s.attachDefibPads());
    this.action("NIBP auto cycle (40s)", () => s.runNibp());

    this.section("Manual vitals");
    this.action("Pulse: radial/carotid (20s, 60s if irregular)", () => s.checkPulse());
    this.action("RR: watch chest (30s, do not announce)", () => s.checkRR());
    this.note("Counting breaths right after talking reads +4: the patient knows you are watching.");
    const bpSel = this.selects([
      {
        id: "cuff", label: "Cuff", options: [
          { value: "correct", label: "Adult" },
          { value: "small", label: "Peds (too small)" },
          { value: "big", label: "Large (too big)" }
        ]
      },
      {
        id: "deflate", label: "Deflate", options: [
          { value: "slow", label: "2-3 mmHg/s" },
          { value: "fast", label: "Too fast" }
        ]
      }
    ]);
    this.action("BP auscultated (50s)", () =>
      s.checkBpAusc((bpSel.get("cuff")?.value ?? "correct") as CuffFit, bpSel.get("deflate")?.value === "fast")
    );
    this.action("BP palpated (30s, SBP only)", () => s.checkBpPalp());
    this.action("Cap refill (8s)", () => s.checkCapRefill());
    this.action("Pupils penlight (10s)", () => s.checkPupils());
    this.action("Glucose fingerstick (12s)", () => s.checkGlucose());
    const tempSel = this.selects([
      {
        id: "method", label: "Method", options: [
          { value: "tympanic", label: "Tympanic" },
          { value: "oral", label: "Oral" },
          { value: "temporal", label: "Temporal" }
        ]
      }
    ]);
    this.action("Temperature (15s)", () =>
      s.checkTemp((tempSel.get("method")?.value ?? "tympanic") as "tympanic" | "oral" | "temporal")
    );
    this.action("Skin look + touch (5s)", () => s.checkSkin());
    this.action("Lung sounds 4 sites (25s)", () => s.checkLungs());
    this.action("GCS eyes/verbal/motor (20s)", () => s.checkGcs());
  }

}
