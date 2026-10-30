// ACM medical menu, Oct 29 slice: Examine, Airway, Breathing, Circulation,
// Medications, Lines/Fluids, Monitor and Talk tabs work. Procedures and Log
// tabs land later. ACM rules hold: everything is present, nothing is greyed
// out for being wrong, consequences are modeled instead of locks. Gameplay
// UI never shows true engine vitals (F1 only) or the patient weight.

import type { RegionId } from "../patient/regions";
import { REGION_LABELS } from "../patient/regions";
import { loadOct28Conditions, loadTraumaLibrary } from "../data/loaders";
import type { Sim } from "../sim/engine";
import type { Holder } from "../sim/types";
import type { CuffFit } from "../sim/exams";
import { drugCatalog, formatDose, presentationMath } from "../sim/drugs";
import { bvmRatePerMin, gttPerMin, tankMinutesLeft } from "../sim/airway";
import { TalkClient } from "./talk";

type Tab = "examine" | "airway" | "breathing" | "circulation" | "meds" | "lines" | "monitor" | "talk";

const TAB_LABELS: Record<Tab, string> = {
  examine: "Examine",
  airway: "Airway",
  breathing: "Breathing",
  circulation: "Circulation",
  meds: "Meds",
  lines: "Lines",
  monitor: "Monitor",
  talk: "Talk"
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
  private logBox = el("menu-log");
  private readonly talkClient: TalkClient;
  private drugId = "fentanyl";
  private drugPres = 0;

  constructor(private readonly sim: Sim) {
    this.talkClient = new TalkClient(sim);
    this.tabsNav.innerHTML = "";
    for (const tab of Object.keys(TAB_LABELS) as Tab[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab-btn";
      button.textContent = TAB_LABELS[tab];
      button.addEventListener("click", () => {
        this.tab = tab;
        this.render(true);
      });
      this.tabsNav.appendChild(button);
    }
    this.render(true);
  }

  setRegion(region: RegionId | null): void {
    this.region = region;
    this.render(true);
  }

  /** V key: open Talk and focus the line to Josh. */
  openTalk(): void {
    this.tab = "talk";
    this.render(true);
    document.getElementById("talk-input")?.focus();
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
      s.fluids.lines.map((l) => `${l.id}:${l.kind}:${l.infiltrated}:${Math.round(l.bag?.volumeLeft_mL ?? -1)}`).join(","),
      s.drugs.active.length, s.drugs.flags.length,
      Object.keys(s.observed).length,
      s.monitor.spo2Attached, s.monitor.etco2Attached,
      s.level, this.talkClient.turns.length, this.talkClient.sending,
      this.drugId, this.drugPres
    ].join("|");
  }

  private render(force: boolean): void {
    void force;
    this.signature = this.stateSignature();
    for (const btn of this.tabsNav.querySelectorAll(".tab-btn")) {
      btn.classList.toggle("active", btn.textContent === TAB_LABELS[this.tab]);
    }
    this.body.innerHTML = "";
    if (this.tab === "examine") this.renderExamine();
    else if (this.tab === "airway") this.renderAirway();
    else if (this.tab === "breathing") this.renderBreathing();
    else if (this.tab === "circulation") this.renderCirculation();
    else if (this.tab === "meds") this.renderMeds();
    else if (this.tab === "lines") this.renderLines();
    else if (this.tab === "monitor") this.renderMonitor();
    else this.renderTalk();
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
    const tail = s.log.slice(-3);
    this.logBox.innerHTML = "";
    for (const e of tail) {
      const div = document.createElement("div");
      div.textContent = `T+${fmtClock(e.t_s)} [${e.kind}] ${e.text}`;
      this.logBox.appendChild(div);
    }
  }

  // - shared widgets -

  private section(title: string): HTMLElement {
    const h = document.createElement("h3");
    h.className = "menu-h";
    h.textContent = title;
    this.body.appendChild(h);
    return h;
  }

  private note(text: string): void {
    const p = document.createElement("p");
    p.className = "menu-note";
    p.textContent = text;
    this.body.appendChild(p);
  }

  private findingList(items: string[]): void {
    const ul = document.createElement("ul");
    ul.className = "menu-findings";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    this.body.appendChild(ul);
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
    this.section(region ? `Examine: ${REGION_LABELS[region]}` : "Examine");

    if (region === null) {
      this.note("Select a body region (click the patient or use the chips).");
    } else if (region === "leg_left") {
      this.action("Inspect the thigh", () => {
        this.findingList([
          "Bright red pulsatile spurting, timed to the pulse",
          "Blood pool expanding under the thigh",
          "Soaked jeans over the left thigh",
          s.beltTrap ? "Belt cinched mid-thigh, leg purple and swollen below it" : "No belt on the thigh"
        ]);
        return { ok: true };
      });
      this.action("Expose with shears (10s)", () => s.exposeWound());
      if (s.exposed) {
        this.findingList(["Partial femoral laceration, anterior thigh, spurting arterial blood."]);
      }
      this.action("Palpate distal pulse", () => {
        const gone = (s.tq.applied && s.tq.occluded) || s.vitals.radial === "Absent";
        this.findingList([
          gone ? "No distal pulse palpable." : "Distal pulse present (bleed NOT controlled).",
          s.legCongested() ? "Limb engorged, congested." : "No venous congestion."
        ]);
        return { ok: true };
      });
    } else if (region === "back") {
      this.note("Supine patient: log roll with your partner to check the back.");
      this.action("Log roll with partner, check the back", () => {
        const res = s.movePatient("log_roll");
        if (res.ok) this.findingList(["Back exposed: no wounds, no bleeding found. Spine non-tender."]);
        return res;
      });
    } else if (region === "arm_right") {
      this.action("Inspect the arm", () => {
        this.findingList(["Large abraded area with embedded gravel (road rash), oozing."]);
        return { ok: true };
      });
    } else {
      const found = this.regionConditions(region);
      this.action(`Inspect ${REGION_LABELS[region]}`, () => {
        this.findingList(found.inspect.length > 0 ? found.inspect : ["No obvious injury on inspection."]);
        return { ok: true };
      });
      this.action(`Palpate ${REGION_LABELS[region]}`, () => {
        this.findingList(["No deformity, no crepitus, non-tender except as noted."]);
        return { ok: true };
      });
    }

    this.section("Whole patient");
    this.note("Skin, temp, cap refill, pulse, lungs and GCS are timed procedures on the Monitor tab. F1 is debug only.");
    if (s.pressure.bystanderShirt) {
      this.action("Take over from the bystander", () => s.takeOverFromBystander());
    }
    this.action("Remove wet clothing (45s)", () => s.removeWetClothing());
    this.action(`Wrap for hypothermia (30s, blankets: ${s.atPatient("hypothermia_wrap_blanket")})`, () => s.applyWrap());
    this.note("Talk to Josh on the Talk tab (V). Airway sizing, O2, lines and drugs live in their tabs.");
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
    this.note("No midface or basilar skull trauma on Josh: NPA not contraindicated.");

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
          { value: "whole_blood_unit", label: "Whole blood" },
          { value: "blood_tubing_filter", label: "Blood tubing" },
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
        options: catalog.usable.map((u) => ({ value: u.drug.id, label: u.drug.name })),
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

    this.section("On board");
    if (s.drugs.active.length === 0) this.note("No active drugs.");
    for (const d of s.drugs.active) {
      this.note(`${d.drugId} ${d.ratio_to_standard}x ${d.route}, peak ${d.peak_s}s, ${d.toxic ? "TOXIC" : "in range"}.`);
    }
    for (const flag of s.drugs.flags) this.note(`TOXICITY: ${flag}.`);
    this.note(`${catalog.noDose.length + catalog.noMapping.length} of 104 drugs are unusable in this build (no single standard dose or no token mapping). Listed in TODO_CLINICAL, never guessed.`);
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
      this.note(
        `Line ${line.id}: ${line.kind} ${line.site}${line.gauge !== undefined ? ` ${line.gauge}g` : ` ${line.needle_mm}mm`}` +
          `${line.infiltrated ? " INFILTRATED" : ""}${line.pressureBag ? " +pressure bag" : ""}, ` +
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
    this.note("Josh: 25 mm tibial, 45 mm humeral. No fracture, burn, prior IO or prosthesis at either site.");
    const ioSel = this.selects([
      {
        id: "site", label: "Site", options: [
          { value: "tibial", label: "Tibial" },
          { value: "humeral", label: "Humeral" }
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
    this.action("Drill IO", () =>
      s.startIo(
        (ioSel.get("site")?.value ?? "tibial") as "tibial" | "humeral",
        Number(ioSel.get("needle")?.value ?? "25"),
        ioSel.get("lido")?.value === "yes"
      )
    );

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
            { value: "lr", label: `LR 1 L (have ${s.atPatient("lr_1000ml")})` },
            { value: "blood", label: `Whole blood (truck ${s.cabinetLeft("whole_blood_unit")})` }
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
      this.action("Hang bag (30s)", () =>
        s.hangFluids(
          Number(hangSel.get("line")?.value ?? "-1"),
          (hangSel.get("fluid")?.value ?? "ns") as "ns" | "lr" | "blood",
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
    this.note("Blood needs blood tubing with a filter plus the warmer at 38 C (both truck fetch). Crystal: +1 L now, ~250 mL at 60 min.");
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
    this.action("NIBP auto cycle (40s)", () => s.runNibp());

    this.section("Manual vitals");
    this.action("Pulse: radial/carotid (20s, 60s if irregular)", () => s.checkPulse());
    this.action("RR: watch chest (30s, do not announce)", () => s.checkRR());
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

  // - Talking patient -

  private renderTalk(): void {
    const client = this.talkClient;
    this.section("Talk to Josh (V)");
    this.note("Short questions get short answers. Speech follows his state: pain, tourniquet, breathing, confusion.");
    const box = document.createElement("div");
    box.className = "talk-log";
    if (client.turns.length === 0) {
      const empty = document.createElement("div");
      empty.className = "talk-empty";
      empty.textContent = "He is watching you work. Say something.";
      box.appendChild(empty);
    }
    for (const turn of client.turns.slice(-10)) {
      const div = document.createElement("div");
      div.className = turn.from === "player" ? "talk-player" : "talk-josh";
      div.textContent = `${turn.from === "player" ? "You" : "Josh"}: ${turn.text}`;
      box.appendChild(div);
    }
    if (client.sending) {
      const typing = document.createElement("div");
      typing.className = "talk-josh talk-typing";
      typing.textContent = "Josh: ...";
      box.appendChild(typing);
    }
    this.body.appendChild(box);

    const row = document.createElement("div");
    row.className = "talk-row";
    const input = document.createElement("input");
    input.id = "talk-input";
    input.type = "text";
    input.maxLength = 300;
    input.placeholder = "What happened? How bad is the pain?";
    input.autocomplete = "off";
    const send = document.createElement("button");
    send.type = "button";
    send.className = "talk-send";
    send.textContent = "Ask";
    const submit = (): void => {
      const text = input.value;
      if (text.trim() === "") return;
      input.value = "";
      void client.send(text).then(() => {
        if (this.tab === "talk") this.render(true);
      });
      this.render(true);
    };
    send.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
      event.stopPropagation();
    });
    row.append(input, send);
    this.body.appendChild(row);
    this.note("Counting his breaths right after talking reads +4: he knows you are watching.");
  }
}
