// ACM bottom row: ACTIVITY LOG and QUICK VIEW, implemented from scratch
// Nov 3. The log lists every treatment with T+ time, newest first, from
// the action/bleed/trap/fetch log kinds. Quick view shows measured
// vitals with time and method, plus live monitor readings while their
// probes are on. At L1 the same auto-vitals block the menu shows today
// renders instead, preserving L1 exactly.

import type { Sim } from "../../sim/engine";
import { sayLine } from "../wording";
import { defibMonitorLine } from "../monitorWords";
import { fmtClockT } from "./format";

const LOG_KINDS = new Set(["action", "bleed", "trap", "fetch"]);

export function buildActivityLog(sim: Sim, parent: HTMLElement): void {
  const head = document.createElement("div");
  head.className = "acm-col-head";
  head.textContent = sayLine("Activity log").toUpperCase();
  parent.appendChild(head);
  const list = document.createElement("div");
  list.className = "acm-log-list";
  const rows = sim.log.filter((e) => LOG_KINDS.has(e.kind)).slice(-40).reverse();
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "acm-dim";
    empty.textContent = sayLine("No treatments yet.");
    list.appendChild(empty);
  }
  for (const event of rows) {
    const div = document.createElement("div");
    div.className = `acm-log-line acm-log-${event.kind}`;
    div.textContent = sayLine(`${fmtClockT(event.t_s)} [${event.kind}] ${event.text}`);
    list.appendChild(div);
  }
  parent.appendChild(list);
}

export function buildQuickView(sim: Sim, parent: HTMLElement): void {
  const head = document.createElement("div");
  head.className = "acm-col-head";
  head.textContent = sayLine("Quick view").toUpperCase();
  parent.appendChild(head);
  const list = document.createElement("div");
  list.className = "acm-qv-list";
  const row = (label: string, text: string, dim?: boolean): void => {
    const div = document.createElement("div");
    div.className = `acm-qv${dim === true ? " acm-dim" : ""}`;
    div.textContent = sayLine(`${label}: ${text}`);
    list.appendChild(div);
  };
  if (sim.level === 1) {
    // L1 auto vitals, exactly the block the menu shows today.
    const v = sim.vitals;
    row("HR", `${v.hr_bpm}`);
    row("BP", `${v.sbp_mmhg}/${v.dbp_mmhg}`);
    row("RR", `${v.rr_per_min}`);
    row("SpO2", `${v.spo2_pct}`);
    row("EtCO2", `${v.etco2_mmhg}${v.etco2Waveform ? " (waveform)" : ""}`);
    row("GCS", `${v.gcs_text}`);
    row("Temp", `${v.temp_C} C`);
    row("Glucose", `${v.glucose_mg_per_dL}`);
    row("Pain", `${v.pain_0_to_10}/10`);
  } else {
    const o = sim.observed;
    const show = (label: string, v: { value: string; t_s: number; method: string } | undefined): void => {
      if (v === undefined) row(label, "not measured", true);
      else row(label, `${v.value} (${fmtClockT(v.t_s)}, ${v.method})`);
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
  }
  // Live monitor readings while probes are on (existing readings only).
  const spo2 = sim.monitorSpo2();
  if (spo2 !== null) {
    row("Monitor SpO2", "none" in spo2 ? spo2.none : `${spo2.value} (${spo2.note}, live)`);
  }
  const etco2 = sim.monitorEtco2();
  if (etco2 !== null) {
    row(
      "Monitor EtCO2",
      etco2.waveform ? `waveform, ${etco2.value} mmHg (live)` : "NO waveform (live)"
    );
  }
  if (sim.defibPadsOn) row("Defib", defibMonitorLine(sim));
  parent.appendChild(list);
}
