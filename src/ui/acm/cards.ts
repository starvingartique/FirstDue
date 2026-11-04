// ACM line cards, meds draw-up card, and triage card. Implemented from
// scratch Nov 3. Same Sim calls as today: line cards carry hang,
// pressure bag, Y prime, blood hang, Y replace, and pull for their line;
// the draw-up card shows drug, vial strength, dose to mL math, syringe,
// route and line, and pushes through the same prepPush call. Drug display
// uses the existing reference data, TODO_CLINICAL where missing.

import type { Sim } from "../../sim/engine";
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
} from "../../sim/drugs";
import type { Drug } from "../../data/types";
import { gttPerMin } from "../../sim/airway";
import { sayLine } from "../wording";
import { acmNote, acmSection, buildNumber, buildRow, buildSelect, readNumber, type AcmRowHost } from "./rows";
import { TRIAGE_LEVELS, type AcmRunState, type TriageLevel } from "./types";

export interface AcmCardHost extends AcmRowHost {
  state: AcmRunState;
  triage: TriageLevel;
  onTriage: (level: TriageLevel) => void;
}

function running(sim: Sim, id: string): boolean {
  return sim.pending?.id === id;
}

export function buildLineCards(host: AcmCardHost, parent: HTMLElement): void {
  const { sim } = host;
  acmSection(parent, "Lines");
  if (sim.fluids.lines.length === 0) {
    acmNote(parent, "No lines yet. In shock, IO beats IV: 95 percent in 30 s.");
    return;
  }
  for (const line of sim.fluids.lines) {
    const card = document.createElement("div");
    card.className = "acm-card";
    const head = document.createElement("div");
    head.className = "acm-card-head";
    const device = line.gauge !== undefined
      ? ` ${line.gauge}g`
      : line.site === "sternal"
        ? " (FAST1)"
        : ` ${line.needle_mm}mm`;
    head.textContent = sayLine(`LINE ${line.id}: ${line.kind} ${line.site}${device}`).toUpperCase();
    card.appendChild(head);
    const bag = line.bag === null
      ? "no bag"
      : `${line.bag.fluid} ${Math.round(line.bag.volumeLeft_mL)}/${line.bag.volumeTotal_mL} mL (${line.bag.drip})`;
    const gtt = line.bag === null
      ? ""
      : ` ${Math.round(gttPerMin(line.flow_mL_per_min * 60, line.bag.drip === "micro60" ? 60 : 15))} gtt/min ref`;
    acmNote(
      card,
      `${line.infiltrated ? "INFILTRATED " : ""}${line.pressureBag ? "+pressure bag " : ""}` +
        `${line.dripSetOn ? "+drip set " : ""}` +
        (line.ySet === null
          ? ""
          : `Y set ${line.ySet.unitsHung}/4 units, NS ${Math.round(line.ySet.nsLeft_mL)} mL${line.warmerOn ? ", warmer 38 C" : ""} `) +
        `${Math.round(line.flow_mL_per_min)} mL/min, ${bag}.${gtt}`
    );
    const usable = line.patent && !line.infiltrated;
    if (usable) {
      buildRow(host, card, {
        id: `line-${line.id}-hang`,
        glyph: "HG",
        name: "Hang bag (30s, 20s on a set line)",
        duration: "30s",
        badge: running(sim, "hang") ? { text: "RUNNING", cls: "running" } : null,
        selects: [
          {
            id: `acm-hang-fluid-${line.id}`,
            label: "Bag",
            options: [
              { value: "ns", label: `NS 1 L (have ${sim.atPatient("ns_1000ml")})` },
              { value: "lr", label: `LR 1 L (have ${sim.atPatient("lr_1000ml")})` }
            ]
          },
          {
            id: `acm-hang-drip-${line.id}`,
            label: "Set",
            options: [
              { value: "macro15", label: "Macro 15" },
              { value: "macro10", label: "Macro 10" },
              { value: "macro20", label: "Macro 20" },
              { value: "micro60", label: "Micro 60" }
            ]
          }
        ],
        run: () =>
          sim.hangFluids(
            line.id,
            ((host.state.controls.get(`acm-hang-fluid-${line.id}`) ?? "ns") as "ns" | "lr"),
            host.state.controls.get(`acm-hang-drip-${line.id}`) ?? "macro15"
          )
      });
      buildRow(host, card, {
        id: `line-${line.id}-pb`,
        glyph: "PB",
        name: "Apply pressure bag (300 mmHg)",
        badge: line.pressureBag ? { text: "ON", cls: "on" } : null,
        run: () => sim.applyPressureBag(line.id)
      });
      buildRow(host, card, {
        id: `line-${line.id}-prime`,
        glyph: "Y+",
        name: "Prime Y tubing + warmer (45s)",
        duration: "45s",
        badge: running(sim, "y_prime")
          ? { text: "RUNNING", cls: "running" }
          : line.ySet !== null
            ? { text: "SET", cls: "set" }
            : null,
        run: () => sim.primeYSet(line.id)
      });
      buildRow(host, card, {
        id: `line-${line.id}-blood`,
        glyph: "BL",
        name: "Hang blood (30s)",
        duration: "30s",
        badge: running(sim, "hang_blood") ? { text: "RUNNING", cls: "running" } : null,
        selects: [
          {
            id: `acm-blood-units-${line.id}`,
            label: "Units",
            options: [
              { value: "1", label: "1 unit (500 mL)" },
              { value: "2", label: "2 units back to back (1,000 mL)" }
            ]
          }
        ],
        run: () =>
          sim.hangBloodUnits(line.id, (host.state.controls.get(`acm-blood-units-${line.id}`) ?? "1") === "2" ? 2 : 1)
      });
      buildRow(host, card, {
        id: `line-${line.id}-yrepl`,
        glyph: "Y%",
        name: "Replace the Y set (45s)",
        duration: "45s",
        run: () => sim.replaceYSet(line.id)
      });
    }
    buildRow(host, card, {
      id: `line-${line.id}-pull`,
      glyph: "PL",
      name: "Pull line (stops its bag)",
      run: () => sim.pullLine(line.id)
    });
    parent.appendChild(card);
  }
  if (!sim.stagedBoxes.has("box_blood_kit")) {
    buildRow(host, parent, {
      id: "bloodkit",
      glyph: "BX",
      name: "Partner: bring the Blood kit (50s)",
      duration: "50s",
      run: () => sim.stageBox("box_blood_kit")
    });
  }
}

export function buildMeds(host: AcmCardHost, parent: HTMLElement): void {
  const { sim } = host;
  const catalog = drugCatalog();
  acmSection(parent, "Draw up");
  // Control picks sync into run state before resolving (drug switch resets vial).
  const pickedId = host.state.controls.get("acm-drug-id");
  if (pickedId !== undefined && pickedId !== host.state.drugId) {
    host.state.drugId = pickedId;
    host.state.controls.set("acm-drug-pres", "0");
  }
  if (!host.state.controls.has("acm-drug-id")) host.state.controls.set("acm-drug-id", host.state.drugId);
  if (!host.state.controls.has("acm-drug-pres")) host.state.controls.set("acm-drug-pres", "0");
  const usable = catalog.usable.find((u) => u.drug.id === host.state.drugId) ?? catalog.usable[0];
  if (usable === undefined) {
    acmNote(parent, "No usable drugs in this build.");
    return;
  }
  if (usable.drug.id !== host.state.drugId) host.state.drugId = usable.drug.id;
  const card = document.createElement("div");
  card.className = "acm-card";
  const presIdx = Number(host.state.controls.get("acm-drug-pres") ?? "0");
  const presEntry = usable.presentations.find((p) => p.index === presIdx) ?? usable.presentations[0];
  if (presEntry === undefined) {
    acmNote(parent, "No computable presentation.");
    return;
  }
  card.appendChild(
    buildSelect(host, {
      id: "acm-drug-id",
      label: "Drug",
      options: catalog.usable.map((u) => {
        const box = drugBoxFor(u.drug.location);
        return { value: u.drug.id, label: box === null ? u.drug.name : `${u.drug.name} (in ${box.label})` };
      })
    })
  );
  card.appendChild(
    buildSelect(host, {
      id: "acm-drug-pres",
      label: "Vial",
      options: usable.presentations.map((p) => ({
        value: String(p.index),
        label: usable.drug.presentations[p.index]?.label ?? `presentation ${p.index}`
      }))
    })
  );
  const presentation = usable.drug.presentations[presEntry.index];
  const math = presentation === undefined ? null : presentationMath(presentation);
  const defaultAmount = math === null ? 0 : Math.round((usable.standard.mcg / math.mcgPer) * 100) / 100;
  acmNote(
    card,
    `Vial reads: ${presentation?.label ?? "?"}. Protocol standard: ${formatDose(usable.standard.mcg)} ` +
      `${usable.standard.route} (${usable.standard.indication}). Peak in ${usable.pk_s[1]}s.`
  );
  acmNote(
    card,
    math === null
      ? "Dose to mL: TODO_CLINICAL: vial math missing."
      : `Dose to mL: 1x = ${defaultAmount} ${math.unitLabel} (${math.mcgPer} mcg per ${math.unitLabel}).`
  );
  const amountDef = { id: "acm-drug-amount", label: "Draw", min: 0, max: 100, step: 0.1, def: defaultAmount, unit: math?.unitLabel ?? "mL" };
  card.appendChild(buildNumber(host, amountDef));
  const needsLine = usable.standard.route.toUpperCase().startsWith("IV") || usable.standard.route.toUpperCase().startsWith("IO");
  const runningLines = sim.fluids.lines.filter((l) => l.patent && !l.infiltrated);
  if (needsLine) {
    card.appendChild(
      buildSelect(host, {
        id: "acm-drug-line",
        label: "Push through",
        options: runningLines.length > 0
          ? runningLines.map((l) => ({ value: String(l.id), label: `Line ${l.id} (${l.kind} ${l.site})` }))
          : [{ value: "-1", label: "No patent line: start one first" }]
      })
    );
  }
  card.appendChild(
    buildSelect(host, {
      id: "acm-drug-syr",
      label: "Syringe",
      options: [
        { value: "syringe_3ml", label: `3 mL (have ${sim.atPatient("syringe_3ml")})` },
        { value: "syringe_10ml", label: `10 mL (have ${sim.atPatient("syringe_10ml")})` },
        { value: "syringe_20ml", label: `20 mL (have ${sim.atPatient("syringe_20ml")})` }
      ]
    })
  );
  buildRow(host, card, {
    id: "push",
    glyph: "Rx",
    name: "Prep and push (45s)",
    duration: "45s",
    badge: running(sim, "drug") ? { text: "RUNNING", cls: "running" } : null,
    run: () => {
      const lineId = !needsLine ? null : Number(host.state.controls.get("acm-drug-line") ?? "-1");
      return sim.prepPush(
        usable.drug.id,
        presEntry.index,
        readNumber(host, amountDef),
        host.state.controls.get("acm-drug-syr") ?? "syringe_10ml",
        lineId
      );
    }
  });
  const needBox = drugBoxFor(usable.drug.location);
  if (needBox !== null && !sim.stagedBoxes.has(needBox.id)) {
    buildRow(host, card, {
      id: "drugbox",
      glyph: "BX",
      name: `Partner: bring the ${needBox.label} (50s)`,
      duration: "50s",
      run: () => sim.stageBox(needBox.id)
    });
  }
  parent.appendChild(card);

  acmSection(parent, "On board");
  if (sim.drugs.active.length === 0) acmNote(parent, "No active drugs.");
  for (const d of sim.drugs.active) {
    acmNote(parent, `${d.drugId} ${d.ratio_to_standard}x ${d.route}, peak ${d.peak_s}s, ${d.toxic ? "TOXIC" : "in range"}.`);
  }
  for (const flag of sim.drugs.flags) acmNote(parent, `TOXICITY: ${flag}.`);
  acmNote(
    parent,
    `${catalog.noDose.length + catalog.noMapping.length} of 104 drugs are unusable in this build (no single standard dose or no token mapping). Listed in TODO_CLINICAL, never guessed.`
  );

  acmSection(parent, "Before every push");
  const checks = pushChecks();
  for (const item of checks.checks) acmNote(parent, `Check: ${item}`);
  acmNote(parent, checks.note);

  acmSection(parent, "Drug reference: this drug");
  drugRefCard(parent, usable.drug);

  acmSection(parent, "Drug reference: all 104");
  const all = allDrugs();
  const refPick = host.state.controls.get("acm-ref-drug");
  if (refPick !== undefined) host.state.refDrug = refPick;
  if (!host.state.controls.has("acm-ref-drug")) host.state.controls.set("acm-ref-drug", host.state.refDrug);
  const ref = all.find((d) => d.id === host.state.refDrug) ?? usable.drug;
  if (ref.id !== host.state.refDrug) {
    host.state.refDrug = ref.id;
    host.state.controls.set("acm-ref-drug", ref.id);
  }
  parent.appendChild(
    buildSelect(host, {
      id: "acm-ref-drug",
      label: "Look up",
      options: all.map((d) => ({ value: d.id, label: d.name }))
    })
  );
  drugRefCard(parent, ref);
}

function drugRefCard(parent: HTMLElement, drug: Drug): void {
  const head = drug.class === undefined ? drug.name : `${drug.name} (${drug.class})`;
  acmNote(parent, head);
  const first = drug.dosing[0];
  if (first === undefined) {
    acmNote(parent, "Dose: TODO_CLINICAL: no dosing protocol in data.");
  } else {
    acmNote(parent, `Use: ${first.indication}. Dose: ${doseLine(first)}. Route: ${first.route.join(", ") || "TODO_CLINICAL"}.`);
    acmNote(parent, `Repeat: ${first.repeat ?? "TODO_CLINICAL: no repeat in data"}. Max: ${first.max ?? "TODO_CLINICAL: no max in data"}.`);
    if (first.notes !== undefined) acmNote(parent, first.notes);
    if (drug.dosing.length > 1) {
      acmNote(parent, `Plus ${drug.dosing.length - 1} more protocol(s): ${drug.dosing.slice(1).map((d) => d.indication).join("; ")}.`);
    }
  }
  const onset = Object.entries(drug.onset ?? {});
  acmNote(
    parent,
    onset.length === 0
      ? "Onset: TODO_CLINICAL: none listed in data."
      : `Onset: ${onset.map(([route, when]) => `${route} ${when}`).join("; ")}.`
  );
  const lasts = Object.entries(drug.duration ?? {});
  acmNote(
    parent,
    lasts.length === 0
      ? "Lasts: TODO_CLINICAL: none listed in data."
      : `Lasts: ${lasts.map(([route, when]) => `${route} ${when}`).join("; ")}.`
  );
  const effects = drugEffectWords(drug);
  acmNote(
    parent,
    effects.length === 0
      ? "Does to the body: TODO_CLINICAL: no effects in data."
      : `Does to the body: ${effects.join("; ")}.`
  );
  acmNote(
    parent,
    (drug.dangers ?? []).length === 0
      ? "Too much: TODO_CLINICAL: no dangers in data."
      : `Too much: ${drug.dangers?.join("; ")}.`
  );
  acmNote(
    parent,
    (drug.contraindications ?? []).length === 0
      ? "Do not give if: TODO_CLINICAL: none listed in data."
      : `Do not give if: ${drug.contraindications?.join("; ")}.`
  );
  acmNote(parent, joshWorkedDose(drug));
  acmNote(parent, `Kept in: ${drug.location}.`);
}

export function buildTriage(host: AcmCardHost, parent: HTMLElement): void {
  const { sim } = host;
  acmSection(parent, "Triage card");
  acmNote(parent, "Player's call only. Stored for the run report. No engine effect.");
  for (const level of TRIAGE_LEVELS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `acm-triage-opt acm-triage-${level.id}${host.triage === level.id ? " acm-triage-sel" : ""}`;
    b.textContent = sayLine(level.label);
    const id = level.id;
    b.addEventListener("click", () => host.onTriage(id));
    parent.appendChild(b);
  }
  acmSection(parent, "Run facts");
  const mins = Math.floor(sim.t_s / 60);
  const secs = sim.t_s % 60;
  acmNote(parent, `Elapsed: T+${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}. Level: L${sim.level}.`);
  acmNote(parent, `Shock: class ${sim.vitals.atlsClass}. Bleeding control: reassess on the leg.`);
}
