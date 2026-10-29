// ACM medical menu, Oct 28 slice: Examine and Circulation tabs work. Other
// tabs (Airway, Breathing, Medications, Lines/Fluids, Procedures, Monitor,
// Log) land Oct 29+. ACM rules hold: everything is present, nothing is
// greyed out for being wrong, consequences are modeled instead of locks.

import type { RegionId } from "../patient/regions";
import { REGION_LABELS } from "../patient/regions";
import { loadOct28Conditions, loadTraumaLibrary } from "../data/loaders";
import type { Sim } from "../sim/engine";
import type { Holder } from "../sim/types";

type Tab = "examine" | "circulation";

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
}

export class MedicalMenu {
  private tab: Tab = "examine";
  private region: RegionId | null = null;
  private signature = "";
  private tabsNav = el("menu-tabs");
  private body = el("menu-body");
  private status = el("action-status");
  private logBox = el("menu-log");

  constructor(private readonly sim: Sim) {
    this.tabsNav.innerHTML = "";
    for (const tab of ["examine", "circulation"] as Tab[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab-btn";
      button.textContent = tab === "examine" ? "Examine" : "Circulation";
      button.addEventListener("click", () => {
        this.tab = tab;
        this.render(true);
      });
      this.tabsNav.appendChild(button);
    }
    const parked = document.createElement("span");
    parked.className = "tabs-parked";
    parked.textContent = "Airway, Breathing, Meds, Lines, Monitor: Oct 29";
    this.tabsNav.appendChild(parked);
    this.render(true);
  }

  setRegion(region: RegionId | null): void {
    this.region = region;
    this.render(true);
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
      s.vitals.atlsClass, s.arrested
    ].join("|");
  }

  private render(force: boolean): void {
    void force;
    this.signature = this.stateSignature();
    for (const btn of this.tabsNav.querySelectorAll(".tab-btn")) {
      const isActive =
        (btn.textContent === "Examine" && this.tab === "examine") ||
        (btn.textContent === "Circulation" && this.tab === "circulation");
      btn.classList.toggle("active", isActive);
    }
    this.body.innerHTML = "";
    if (this.tab === "examine") this.renderExamine();
    else this.renderCirculation();
    this.renderStatus();
  }

  private renderStatus(): void {
    const s = this.sim;
    const bits = [`T+${fmtClock(s.t_s)}`, s.busy ? s.pendingLabel : "Hands free"];
    if (s.tq.applied && s.tq.loosened) bits.push("TQ: REASSESS");
    if (s.packing.loosened) bits.push("Packing: REASSESS");
    if (s.dressing.applied && s.dressing.loosened) bits.push("Dressing: REASSESS");
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
        select.appendChild(opt);
      }
      wrap.append(caption, select);
      this.body.appendChild(wrap);
      map.set(spec.id, select);
    }
    return map;
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
    this.action("Check skin + temperature", () => {
      this.findingList([
        `Skin: ${s.vitals.skin}`,
        `Core temp: ${s.vitals.temp_C} C${s.wetClothing ? " (wet clothing, still sliding)" : ""}`,
        `Cap refill: ${s.vitals.capRefill_text}`,
        `Radial pulse: ${s.vitals.radial}`
      ]);
      return { ok: true };
    });
    this.action("Auscultate lungs (4 sites)", () => {
      this.findingList(["Breath sounds equal bilateral, no wheeze. Roadside noise noted."]);
      return { ok: true };
    });
    if (s.pressure.bystanderShirt) {
      this.action("Take over from the bystander", () => s.takeOverFromBystander());
    }
    this.action("Remove wet clothing (45s)", () => s.removeWetClothing());
    this.action("Wrap for hypothermia (30s)", () => s.applyWrap());
    this.note("Talking patient voice, manual vitals and airway sizing land Oct 29.");
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
          { value: "junctional_tourniquet_samjt", label: "SAM JT" }
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
}
