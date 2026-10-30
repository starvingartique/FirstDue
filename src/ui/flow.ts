// Oct 30 run flow: level select, dispatch, size-up, package and destination,
// transport skip, radio report, handoff. One phase at a time renders into
// #flow-overlay; care itself is the existing scene plus ACM menu with the
// overlay hidden. Pure helpers (handoff checks, hints, nurse truth summary)
// sit at the top so headless tests can import them without touching the DOM.

import type { FixedCall, DifficultyLevel } from "../data/types";
import type { Sim } from "../sim/engine";
import { applyTerms } from "./terms";

export type Phase = "level" | "dispatch" | "sizeup" | "care" | "package" | "transport" | "radio" | "end";
export type Destination = "trauma" | "stemi" | "stroke" | "ed";
export type Outcome = "win" | "lose";

/** Off-screen transport length in sim-seconds. Scenario param for Wyatt. */
export const TRANSPORT_SKIP_S = 300;

/** Controlled-bleed threshold, same 30 mL/min the run report uses. */
export const CONTROL_RATE_ML_PER_MIN = 30;

/** Airway bar for handoff. Chosen Oct 30, TODO_CLINICAL for Wyatt. */
export const HANDOFF_PATENCY_MIN = 0.8;

export interface RunRecord {
  level: 1 | 2 | null;
  levelLabel: string;
  sizeup: string[];
  destination: Destination | null;
  destinationLabel: string;
  outcome: Outcome | null;
  outcomeReason: string;
}

export function freshRecord(): RunRecord {
  return {
    level: null,
    levelLabel: "not chosen",
    sizeup: [],
    destination: null,
    destinationLabel: "not chosen",
    outcome: null,
    outcomeReason: ""
  };
}

export interface HandoffCheck {
  label: string;
  pass: boolean;
}

/**
 * Transport criteria at handoff. Only engine-tracked facts: alive, bleed
 * under the report threshold, airway patent with no esophageal tube. The
 * patency number and the airway rule are Oct 30 choices, TODO_CLINICAL.
 */
export function evaluateHandoff(sim: Sim): { win: boolean; checks: HandoffCheck[] } {
  const rate = sim.bleedRate_mL_per_min();
  const ett = sim.airway.ett;
  const checks: HandoffCheck[] = [
    { label: "Alive at handoff", pass: !sim.arrested },
    {
      label: `Hemorrhage controlled (bleed ${Math.round(rate)} mL/min, needs under ${CONTROL_RATE_ML_PER_MIN})`,
      pass: rate < CONTROL_RATE_ML_PER_MIN
    },
    {
      label: `Airway patent (patency ${HANDOFF_PATENCY_MIN}+, no esophageal tube)`,
      pass: sim.vitals.airwayPatency_0_to_1 >= HANDOFF_PATENCY_MIN && (ett === null || ett.placement === "tracheal")
    }
  ];
  return { win: checks.every((c) => c.pass), checks };
}

/** L1 partner hint from live state. L2 never calls this (no hints). */
export function hintFor(sim: Sim): string | null {
  if (sim.arrested) return null;
  const rate = sim.bleedRate_mL_per_min();
  if (!sim.exposed) return "Partner: check for bleeding - expose that thigh first.";
  if (sim.beltTrap) return "Partner: that belt on the thigh looks wrong - take a second look.";
  const nothingOn =
    !sim.tq.applied && sim.packing.stage === "none" && !sim.pressure.active && !sim.dressing.applied;
  if (rate >= CONTROL_RATE_ML_PER_MIN && nothingOn) {
    return "Partner: stop the bleeding - tourniquet, packing, or firm pressure.";
  }
  if (sim.tq.applied && !sim.tq.occluded) {
    return "Partner: crank the tourniquet until the bleeding stops and the pulse below is gone.";
  }
  if (sim.packing.stage === "holding") return "Partner: keep holding - full three minutes, no peeking.";
  if (sim.airway.soiled) return "Partner: his airway needs suction.";
  if (sim.o2.device === "none" && sim.vitals.spo2_pct < 94) {
    return "Partner: his oxygen is low - pick an oxygen device.";
  }
  if (sim.wetClothing && !sim.wrapped && sim.t_s > 180) {
    return "Partner: keep him warm - dry him off and wrap him.";
  }
  return "Partner: reassess MARCH - what is next?";
}

/** Compact truth summary so the nurse can grade report completeness. */
export function radioTruth(sim: Sim): string {
  const v = sim.vitals;
  const rx: string[] = [];
  if (sim.tq.applied) {
    const t = sim.log.find((e) => e.text.startsWith("TQ time written"));
    rx.push(`tourniquet on, ${sim.tq.occluded ? "occluded" : "NOT occluded"}${t ? ` (${t.text})` : " (no time written)"}`);
  }
  if (sim.packing.stage !== "none") rx.push(`packing ${sim.packing.stage}`);
  if (sim.pressure.active) rx.push("direct pressure held");
  if (sim.dressing.applied) rx.push("pressure dressing on");
  if (sim.airway.adjunct !== null) rx.push(`${sim.airway.adjunct.kind} in`);
  if (sim.airway.ett !== null) rx.push(`ETT ${sim.airway.ett.placement}`);
  if (sim.o2.device !== "none") rx.push(`${sim.o2.device} at ${sim.o2.flow_L_per_min} L/min`);
  for (const l of sim.fluids.lines) {
    rx.push(`${l.kind} line ${l.id} ${l.patent ? "patent" : "BAD"}${l.bag ? `, ${l.bag.fluid} running` : ""}`);
  }
  for (const d of sim.drugs.active) rx.push(`${d.drugId} on board`);
  if (sim.wrapped || !sim.wetClothing) rx.push("warm and dry");
  return [
    "Mechanism: motorcycle vs guardrail, rider down on the night roadside.",
    "Injuries: left thigh partial femoral arterial laceration with heavy bleeding, plus road rash.",
    `Signs now: HR ${v.hr_bpm}, BP ${v.sbp_mmhg}/${v.dbp_mmhg}, RR ${v.rr_per_min}, SpO2 ${v.spo2_pct}, ${v.gcs_text}, shock ${v.atlsClass}, blood lost ${Math.round(sim.loss_mL)} mL, pain ${v.pain_0_to_10}/10.`,
    `Treatment: ${rx.length === 0 ? "nothing yet" : rx.join("; ")}.`,
    `Clock: T+${Math.floor(sim.t_s / 60)}:${String(sim.t_s % 60).padStart(2, "0")}.`
  ].join(" ");
}

export interface SizeupItem {
  id: string;
  label: string;
  sub: string;
}

export const SIZEUP_ITEMS: SizeupItem[] = [
  { id: "safety", label: "Scene safety", sub: "Live traffic lane, darkness - cones out, watch the road." },
  { id: "ppe", label: "PPE", sub: "Gloves on before you touch blood." },
  { id: "mechanism", label: "Mechanism", sub: "Motorcycle vs guardrail at speed." },
  { id: "patients", label: "Number of patients", sub: "One rider down. Driver bystander is unhurt." },
  { id: "resources", label: "Request resources", sub: "Decide now if you need more than your crew." }
];

export interface DestinationOption {
  id: Destination;
  label: string;
  sub: string;
}

export const DESTINATION_OPTIONS: DestinationOption[] = [
  { id: "trauma", label: "Trauma center", sub: "Full trauma team and blood bank." },
  { id: "stemi", label: "STEMI center", sub: "Cath lab for heart attacks." },
  { id: "stroke", label: "Stroke center", sub: "Clot team for strokes." },
  { id: "ed", label: "Nearest ED", sub: "Closest emergency department." }
];

export const MIST_GUIDE: [string, string][] = [
  ["M - Mechanism", "What happened: bike vs guardrail, speed, details."],
  ["I - Injuries", "What you found: left thigh arterial bleed, other injuries."],
  ["S - Signs", "Vitals now: pulse, BP, breathing, oxygen, alertness, shock signs."],
  ["T - Treatment", "What you did: tourniquet, packing, airway, oxygen, lines, fluids, drugs."]
];

// Offline nurse fallback: keyword checks per MIST element.
const MIST_KEYS: { id: string; re: RegExp; ask: string }[] = [
  {
    id: "M",
    re: /motor|bike|guardrail|crash|mvc|mva|mechanism|truck|road/i,
    ask: "Copy. What was the mechanism - how did he crash?"
  },
  {
    id: "I",
    re: /femor|thigh|arter|bleed|lacer|injur|leg|wound/i,
    ask: "What injuries did you find?"
  },
  {
    id: "S",
    re: /vital|bp\b|pressure|pulse|\bhr\b|spo2|oxygen|rr\b|breath|shock|class|conscious|alert|gcs|mental/i,
    ask: "Give me current vitals - pulse, BP, breathing, oxygen, alertness."
  },
  {
    id: "T",
    re: /tourniquet|\btq\b|pack|pressure|dress|fluid|\biv\b|\bio\b|oxygen|nrb|treat|drug|med |wrap/i,
    ask: "What treatment have you given so far?"
  }
];

export function missingMist(playerText: string): string[] {
  return MIST_KEYS.filter((k) => !k.re.test(playerText)).map((k) => k.id);
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls !== "") node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtClock(t_s: number): string {
  return `${String(Math.floor(t_s / 60)).padStart(2, "0")}:${String(t_s % 60).padStart(2, "0")}`;
}

export interface RadioTurn {
  from: "player" | "nurse";
  text: string;
}

/**
 * Phase overlays for the Oct 30 end-to-end run. The sim is created on
 * dispatch accept, so the clock and the event log start there; before that
 * the 3D scene just renders behind the cards.
 */
export class RunFlow {
  phase: Phase = "level";
  readonly record = freshRecord();
  /** True before accept, during the transport skip, and after handoff. */
  tickingSuspended = true;
  private overlay: HTMLElement;
  private hintBar: HTMLElement;
  private transportTimer: number | null = null;
  private sizeupLogged = false;

  constructor() {
    const overlay = document.getElementById("flow-overlay");
    if (overlay === null) throw new Error("missing #flow-overlay in index.html");
    this.overlay = overlay;
    const hint = document.getElementById("partner-hint");
    if (hint === null) throw new Error("missing #partner-hint in index.html");
    this.hintBar = hint;
  }

  private show(node: HTMLElement): void {
    this.overlay.innerHTML = "";
    this.overlay.appendChild(node);
    this.overlay.hidden = false;
    applyTerms(this.overlay);
  }

  /** Care phase: overlay away so the scene and panel are fully usable. */
  hideOverlay(): void {
    this.phase = "care";
    this.overlay.hidden = true;
    this.overlay.innerHTML = "";
  }

  retranslate(): void {
    if (!this.overlay.hidden) applyTerms(this.overlay);
    applyTerms(this.hintBar);
  }

  // - level select -

  showLevel(levels: DifficultyLevel[], onPick: (level: 1 | 2) => void): void {
    this.phase = "level";
    const card = h("div", "flow-card");
    card.appendChild(h("div", "flow-kicker", "First Due - Bike down"));
    card.appendChild(h("h1", "flow-title", "Choose your level"));
    const row = h("div", "flow-row");
    for (const lv of levels.filter((l) => l.level === 1 || l.level === 2)) {
      const box = h("div", "flow-level");
      box.appendChild(h("div", "flow-level-name", `L${lv.level} - ${lv.role}`));
      const ul = h("ul", "flow-list");
      for (const line of [
        lv.vitalsDisplay === "auto" ? "Vitals auto-display" : "Manual vitals only",
        lv.hints ? "Partner gives hints" : "No hints",
        lv.deterioration === "slow" ? "Slow deterioration" : "Real deterioration",
        lv.notes
      ]) {
        const li = document.createElement("li");
        li.textContent = line;
        ul.appendChild(li);
      }
      box.appendChild(ul);
      const btn = h("button", "flow-btn", `Start as L${lv.level}`);
      btn.type = "button";
      btn.addEventListener("click", () => onPick(lv.level === 1 ? 1 : 2));
      box.appendChild(btn);
      row.appendChild(box);
    }
    card.appendChild(row);
    card.appendChild(h("div", "flow-note", "Same kit at both levels. L3, L4, and L5 stay parked."));
    this.show(card);
  }

  // - dispatch -

  showDispatch(call: FixedCall, onAccept: () => void): void {
    this.phase = "dispatch";
    const card = h("div", "flow-card");
    const head = h("div", "flow-dispatch-head");
    head.appendChild(h("span", "flow-tone", "(tone)"));
    head.appendChild(h("span", "flow-title", "DISPATCH"));
    head.appendChild(h("span", "flow-tone", "(tone)"));
    card.appendChild(head);
    const dl = h("dl", "flow-cad");
    const rows: [string, string][] = [
      ["Nature", call.dispatch.nature],
      ["Patient", `${call.patient.age}-year-old ${call.patient.sex === "M" ? "male" : "female"}`],
      ["CAD", call.dispatch.cadText ?? ""],
      ["Update", (call.dispatch.updates ?? []).join(" ")],
      ["Scene", `Night roadside - ${call.scene.description ?? ""}`.trim()]
    ];
    for (const [k, v] of rows) {
      if (v === "") continue;
      dl.appendChild(h("dt", "flow-dt", k));
      dl.appendChild(h("dd", "flow-dd", v));
    }
    card.appendChild(dl);
    const btn = h("button", "flow-btn flow-btn-big", "Accept call and arrive on scene");
    btn.type = "button";
    btn.addEventListener("click", onAccept);
    card.appendChild(btn);
    card.appendChild(h("div", "flow-note", "Accepting starts the clock and the event log."));
    this.show(card);
  }

  // - size-up -

  showSizeup(sim: Sim, onDone: () => void): void {
    this.phase = "sizeup";
    sim.addLog("info", "Arrived on scene. Night roadside, bike down.");
    const card = h("div", "flow-card");
    card.appendChild(h("div", "flow-kicker", "Arrival"));
    card.appendChild(h("h1", "flow-title", "Scene size-up"));
    card.appendChild(
      h("div", "flow-note", "Tick through the list. It costs no time and blocks nothing - it is logged for the debrief.")
    );
    const list = h("div", "flow-checks");
    for (const item of SIZEUP_ITEMS) {
      const label = h("label", "flow-check");
      const box = document.createElement("input");
      box.type = "checkbox";
      const text = h("span", "flow-check-text", `${item.label} - ${item.sub}`);
      box.addEventListener("change", () => {
        if (!box.checked) return;
        if (!this.record.sizeup.includes(item.id)) {
          this.record.sizeup.push(item.id);
          sim.addLog("info", `Size-up: ${item.label} checked.`);
        }
        if (this.record.sizeup.length === SIZEUP_ITEMS.length && !this.sizeupLogged) {
          this.sizeupLogged = true;
          sim.addLog("info", "Size-up complete (5/5).");
        }
      });
      label.append(box, text);
      list.appendChild(label);
    }
    card.appendChild(list);
    const btn = h("button", "flow-btn flow-btn-big", "Move to patient");
    btn.type = "button";
    btn.addEventListener("click", onDone);
    card.appendChild(btn);
    this.show(card);
  }

  // - L1 partner hints -

  updateHint(sim: Sim): void {
    if (sim.level !== 1 || this.phase === "end") {
      this.hintBar.hidden = true;
      return;
    }
    const hint = hintFor(sim);
    if (hint === null) {
      this.hintBar.hidden = true;
      return;
    }
    if (this.hintBar.textContent !== hint) {
      this.hintBar.textContent = hint;
      applyTerms(this.hintBar);
    }
    this.hintBar.hidden = false;
  }

  // - package and destination -

  showPackage(sim: Sim, onGo: () => void, onCancel: () => void): void {
    this.phase = "package";
    const card = h("div", "flow-card");
    card.appendChild(h("div", "flow-kicker", "On scene"));
    card.appendChild(h("h1", "flow-title", "Package for transport"));
    card.appendChild(h("div", "flow-note", "Pick a destination. The choice is logged, not graded in this build."));
    const list = h("div", "flow-checks");
    let picked: Destination | null = null;
    const go = h("button", "flow-btn flow-btn-big", "Load and go");
    go.type = "button";
    go.disabled = true;
    for (const opt of DESTINATION_OPTIONS) {
      const label = h("label", "flow-check");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "destination";
      radio.addEventListener("change", () => {
        picked = opt.id;
        go.disabled = false;
      });
      label.append(radio, h("span", "flow-check-text", `${opt.label} - ${opt.sub}`));
      list.appendChild(label);
    }
    card.appendChild(list);
    go.addEventListener("click", () => {
      if (picked === null) return;
      const opt = DESTINATION_OPTIONS.find((o) => o.id === picked);
      this.record.destination = picked;
      this.record.destinationLabel = opt?.label ?? picked;
      sim.addLog("info", `Destination chosen: ${this.record.destinationLabel}.`);
      sim.addLog("movement", "Loaded for transport. On-scene care ends.");
      onGo();
    });
    const back = h("button", "flow-btn flow-btn-ghost", "Back to patient");
    back.type = "button";
    back.addEventListener("click", onCancel);
    const row = h("div", "flow-btn-row");
    row.append(go, back);
    card.appendChild(row);
    this.show(card);
  }

  // - transport skip -

  runTransport(
    sim: Sim,
    hooks: { onClock: () => void; onMenu: () => void },
    onDone: (arrested: boolean) => void
  ): void {
    this.phase = "transport";
    this.tickingSuspended = true;
    const card = h("div", "flow-card");
    card.appendChild(h("div", "flow-kicker", `Transport to ${this.record.destinationLabel}`));
    card.appendChild(h("h1", "flow-title", "En route - engine ticking"));
    card.appendChild(
      h("div", "flow-note", `Off-screen time skip (${TRANSPORT_SKIP_S / 60} min). No moving-rig actions in this build.`)
    );
    const bar = h("div", "flow-progress");
    const fill = h("div", "flow-progress-fill");
    bar.appendChild(fill);
    card.appendChild(bar);
    const status = h("div", "flow-status", "Loading...");
    card.appendChild(status);
    this.show(card);

    let done = 0;
    const step = (): void => {
      for (let i = 0; i < 10 && done < TRANSPORT_SKIP_S; i++) {
        sim.tick();
        done += 1;
        hooks.onClock();
        if (sim.arrested) break;
      }
      fill.style.width = `${Math.round((done / TRANSPORT_SKIP_S) * 100)}%`;
      const rate = sim.bleedRate_mL_per_min();
      status.textContent = sim.arrested
        ? `T+${fmtClock(sim.t_s)} - ARREST during transport.`
        : `T+${fmtClock(sim.t_s)} - ${rate < CONTROL_RATE_ML_PER_MIN ? "bleeding controlled" : "BLEEDING - reassess on arrival"}.`;
      hooks.onMenu();
      if (sim.arrested || done >= TRANSPORT_SKIP_S) {
        this.transportTimer = null;
        if (!sim.arrested) sim.addLog("info", `Arrived at ${this.record.destinationLabel}. Transport skip ${TRANSPORT_SKIP_S}s.`);
        onDone(sim.arrested);
        return;
      }
      this.transportTimer = window.setTimeout(step, 40);
    };
    this.transportTimer = window.setTimeout(step, 40);
  }

  // - radio report -

  showRadio(sim: Sim, onHandoff: () => void): void {
    this.phase = "radio";
    this.tickingSuspended = false;
    const turns: RadioTurn[] = [];
    const card = h("div", "flow-card flow-card-wide");
    card.appendChild(h("div", "flow-kicker", `Radio - ${this.record.destinationLabel}`));
    card.appendChild(h("h1", "flow-title", "Radio report to the charge nurse"));
    const guide = h("ul", "flow-list");
    for (const [k, v] of MIST_GUIDE) {
      const li = document.createElement("li");
      li.textContent = `${k}: ${v}`;
      guide.appendChild(li);
    }
    card.appendChild(guide);
    card.appendChild(
      h("div", "flow-note", "Type your own report - it is not auto-filled. Voice reporting is parked; text stands in today.")
    );
    const log = h("div", "flow-radio-log");
    card.appendChild(log);
    const area = document.createElement("textarea");
    area.className = "flow-textarea";
    area.rows = 5;
    area.maxLength = 1200;
    area.placeholder = "28-year-old male, bike vs guardrail...";
    card.appendChild(area);
    const send = h("button", "flow-btn", "Send report");
    send.type = "button";
    const nothingMore = h("button", "flow-btn flow-btn-ghost", "Nothing more - request handoff");
    nothingMore.type = "button";
    const handoff = h("button", "flow-btn flow-btn-big", "Hand off patient - end run");
    handoff.type = "button";
    handoff.hidden = true;
    const row = h("div", "flow-btn-row");
    row.append(send, nothingMore, handoff);
    card.appendChild(row);
    this.show(card);
    area.focus();

    const renderTurns = (): void => {
      log.innerHTML = "";
      for (const t of turns) {
        const div = h("div", t.from === "player" ? "talk-player" : "talk-josh");
        div.textContent = `${t.from === "player" ? "You" : "Nurse"}: ${t.text}`;
        log.appendChild(div);
      }
      log.scrollTop = log.scrollHeight;
    };

    const playerText = (): string => turns.filter((t) => t.from === "player").map((t) => t.text).join("\n");

    const localNurse = (): { text: string; complete: boolean } => {
      const missing = missingMist(playerText());
      if (missing.length === 0) {
        return { text: "Copy all four - mechanism, injuries, vitals, treatment. Bring him to trauma bay 1.", complete: true };
      }
      const ask = MIST_KEYS.find((k) => k.id === missing[0]);
      return { text: ask?.ask ?? "Say again?", complete: false };
    };
    let liveFailed = false;

    const finish = (complete: boolean): void => {
      if (complete) {
        handoff.hidden = false;
        nothingMore.hidden = true;
      }
    };

    send.addEventListener("click", () => {
      const text = area.value.trim();
      if (text === "" || send.disabled) return;
      send.disabled = true;
      area.value = "";
      turns.push({ from: "player", text: text.slice(0, 1200) });
      sim.addLog("info", `Radio: you: "${text.slice(0, 160)}"`);
      renderTurns();
      const waiting = h("div", "talk-josh", "Nurse: ...");
      log.appendChild(waiting);
      void fetch("/api/radio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ report: text, state: radioTruth(sim), history: turns.slice(-10) })
      })
        .then((res) => {
          if (!res.ok) throw new Error(`radio route ${res.status}`);
          return res.json() as Promise<{ text?: unknown; complete?: unknown }>;
        })
        .then((data) => {
          if (this.phase !== "radio") return;
          const reply = typeof data.text === "string" && data.text !== "" ? data.text : localNurse().text;
          const complete = data.complete === true || (typeof data.text !== "string" && missingMist(playerText()).length === 0);
          turns.push({ from: "nurse", text: reply });
          sim.addLog("info", `Radio nurse: "${reply.slice(0, 160)}"`);
          finish(complete);
        })
        .catch(() => {
          if (this.phase !== "radio") return;
          if (!liveFailed) {
            liveFailed = true;
            sim.addLog("info", "Live nurse unreachable: local MIST checklist.");
          }
          const fallback = localNurse();
          turns.push({ from: "nurse", text: fallback.text });
          sim.addLog("info", `Radio nurse: "${fallback.text}"`);
          finish(fallback.complete);
        })
        .finally(() => {
          send.disabled = false;
          renderTurns();
        });
    });

    nothingMore.addEventListener("click", () => {
      sim.addLog("info", "Radio: you confirmed nothing more. Handoff requested.");
      onHandoff();
    });
    handoff.addEventListener("click", () => {
      sim.addLog("info", "Radio: complete report. Handoff at the ED.");
      onHandoff();
    });
  }

  // - end of run -

  showEnd(params: { sim: Sim; win: boolean; checks: HandoffCheck[]; report: HTMLElement }): void {
    this.phase = "end";
    this.tickingSuspended = true;
    this.hintBar.hidden = true;
    if (this.transportTimer !== null) {
      window.clearTimeout(this.transportTimer);
      this.transportTimer = null;
    }
    const { sim, win, checks, report } = params;
    this.record.outcome = win ? "win" : "lose";
    sim.addLog("info", win ? "Run over: WIN - patient handed off alive, criteria met." : `Run over: LOSE - ${this.record.outcomeReason}`);
    const card = h("div", "flow-card flow-card-wide");
    card.appendChild(h("div", "flow-kicker", "End of run"));
    const banner = h("h1", win ? "flow-win" : "flow-lose", win ? "HANDOFF - PATIENT ALIVE" : "RUN LOST");
    card.appendChild(banner);
    if (!win) card.appendChild(h("div", "flow-note", this.record.outcomeReason));
    const info = h("dl", "flow-cad");
    for (const [k, v] of [
      ["Level", this.record.levelLabel],
      ["Destination", this.record.destinationLabel],
      ["Outcome", win ? "Win" : "Lose"]
    ]) {
      info.appendChild(h("dt", "flow-dt", k));
      info.appendChild(h("dd", "flow-dd", v));
    }
    card.appendChild(info);
    card.appendChild(h("div", "flow-h", "Transport criteria at handoff"));
    const ul = h("ul", "flow-list");
    for (const c of checks) {
      const li = document.createElement("li");
      li.textContent = `${c.pass ? "PASS" : "FAIL"} - ${c.label}`;
      li.className = c.pass ? "flow-pass" : "flow-fail";
      ul.appendChild(li);
    }
    card.appendChild(ul);
    card.appendChild(h("div", "flow-h", "Run report"));
    card.appendChild(report);
    const again = h("button", "flow-btn flow-btn-big", "Run again (reload)");
    again.type = "button";
    again.addEventListener("click", () => window.location.reload());
    card.appendChild(again);
    this.show(card);
  }
}
