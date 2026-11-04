// ACM monitor category LP15-style screen, implemented from scratch Nov 3.
// Dark screen with an EKG strip, SpO2 pleth, EtCO2 waveform, and an NIBP
// box. A trace draws only while its probe is attached; waveform shapes
// are decorative, and every number comes from the existing monitor
// readings (monitorSpo2, monitorEtco2) or the last cuff read. The sweep
// rate follows the monitor HR when there is one. Static under
// prefers-reduced-motion.

import type { Sim } from "../../sim/engine";
import { sayLine } from "../wording";

const SVG_NS = "http://www.w3.org/2000/svg";

/** One decorative QRS complex centered at x, baseline y, width w. */
function qrs(x: number, y: number, w: number, h: number): string {
  const u = w / 12;
  return [
    `M ${x} ${y}`,
    `l ${u} 0`,
    `l ${u} ${-h * 0.15}`,
    `l ${u} ${h * 0.15}`,
    `l ${u} 0`,
    `l ${u * 0.7} ${-h}`,
    `l ${u * 0.7} ${h * 1.25}`,
    `l ${u * 0.7} ${-h * 0.25}`,
    `l ${u} 0`,
    `l ${u} ${-h * 0.3}`,
    `l ${u} ${h * 0.3}`,
    `l ${u} 0`
  ].join(" ");
}

/** One wide slow bump for PEA/arrest. */
function wide(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} q ${w * 0.25} 0 ${w * 0.35} ${-h} q ${w * 0.1} ${-h * 0.2} ${w * 0.2} 0 q ${w * 0.1} ${h * 0.2} ${w * 0.2} ${h}`;
}

/** One smooth pleth pulse. */
function pleth(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} q ${w * 0.2} 0 ${w * 0.3} ${-h} q ${w * 0.1} ${-h * 0.25} ${w * 0.2} 0 q ${w * 0.1} ${h * 0.1} ${w * 0.3} ${h}`;
}

/** One capnography square wave with sloped upstroke. */
function capno(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} l ${w * 0.15} ${-h} l ${w * 0.45} 0 l ${w * 0.15} ${h} l ${w * 0.25} 0`;
}

function strip(
  cls: string,
  beat: (x: number, y: number, w: number, h: number) => string,
  period_s: number | null
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 300 60");
  svg.setAttribute("class", `acm-scope ${cls}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const path = document.createElementNS(SVG_NS, "path");
  let d = "";
  for (let x = -75; x < 600; x += 75) d += `${beat(x, 45, 75, 30)} `;
  path.setAttribute("d", d);
  path.setAttribute("class", "acm-trace");
  // Four complexes per 300 px loop: duration follows the monitor rate.
  if (period_s !== null && period_s > 0) {
    path.style.animationDuration = `${(period_s * 4).toFixed(2)}s`;
  }
  const g = document.createElementNS(SVG_NS, "g");
  g.appendChild(path);
  svg.appendChild(g);
  return svg;
}

export function buildMonitorScreen(sim: Sim, parent: HTMLElement): void {
  const screen = document.createElement("div");
  screen.className = "acm-lp15";
  const spo2 = sim.monitorSpo2();
  // Sweep rate follows the last measured pulse, never a true vital.
  const measured = Number(sim.observed.hr?.value ?? "x");
  const spo2Hr = Number.isFinite(measured) ? measured : null;
  const arrested = sim.arrested || sim.vitals.rhythm === "pea";

  // EKG strip: pads on only. Slow wide shape when arrested.
  const ekgBox = document.createElement("div");
  ekgBox.className = "acm-scope-box";
  const ekgTag = document.createElement("div");
  ekgTag.className = "acm-scope-tag";
  ekgTag.textContent = sayLine("EKG");
  ekgBox.appendChild(ekgTag);
  if (sim.defibPadsOn) {
    const beat = arrested ? wide : qrs;
    const period = spo2Hr !== null && spo2Hr > 0 ? 60 / spo2Hr : arrested ? 2 : 0.8;
    ekgBox.appendChild(strip("acm-ekg", beat, period));
  } else {
    const off = document.createElement("div");
    off.className = "acm-scope-off";
    off.textContent = sayLine("NO PADS");
    ekgBox.appendChild(off);
  }
  const hrBox = document.createElement("div");
  hrBox.className = "acm-scope-num";
  hrBox.textContent = spo2Hr === null ? "HR ---" : `HR ${spo2Hr}`;
  ekgBox.appendChild(hrBox);
  screen.appendChild(ekgBox);

  // SpO2 pleth: probe on only.
  const plethBox = document.createElement("div");
  plethBox.className = "acm-scope-box";
  const plethTag = document.createElement("div");
  plethTag.className = "acm-scope-tag";
  plethTag.textContent = sayLine("SPO2");
  plethBox.appendChild(plethTag);
  if (sim.monitor.spo2Attached) {
    const period = spo2Hr !== null && spo2Hr > 0 ? 60 / spo2Hr : 0.8;
    plethBox.appendChild(strip("acm-pleth", pleth, period));
  } else {
    const off = document.createElement("div");
    off.className = "acm-scope-off";
    off.textContent = sayLine("NO PROBE");
    plethBox.appendChild(off);
  }
  const spo2Box = document.createElement("div");
  spo2Box.className = "acm-scope-num";
  spo2Box.textContent = spo2 === null || "none" in spo2 ? "SpO2 ---" : `SpO2 ${spo2.value}`;
  plethBox.appendChild(spo2Box);
  screen.appendChild(plethBox);

  // EtCO2: attached only; flat without a waveform.
  const co2Box = document.createElement("div");
  co2Box.className = "acm-scope-box";
  const co2Tag = document.createElement("div");
  co2Tag.className = "acm-scope-tag";
  co2Tag.textContent = sayLine("ETCO2");
  co2Box.appendChild(co2Tag);
  const etco2 = sim.monitorEtco2();
  if (etco2 !== null && etco2.waveform) {
    co2Box.appendChild(strip("acm-capno", capno, 3));
  } else {
    const off = document.createElement("div");
    off.className = "acm-scope-off";
    off.textContent = sayLine(etco2 === null ? "OFF" : "NO WAVEFORM");
    co2Box.appendChild(off);
  }
  const co2Num = document.createElement("div");
  co2Num.className = "acm-scope-num";
  co2Num.textContent = etco2 === null || !etco2.waveform ? "EtCO2 ---" : `EtCO2 ${etco2.value}`;
  co2Box.appendChild(co2Num);
  screen.appendChild(co2Box);

  // NIBP box: last cuff read only.
  const nibp = document.createElement("div");
  nibp.className = "acm-nibp";
  const sbp = sim.observed.sbp;
  const dbp = sim.observed.dbp;
  nibp.textContent = sayLine(
    sbp === undefined ? "NIBP ---/---" : `NIBP ${sbp.value}/${dbp?.value ?? "---"} (${sbp.method})`
  );
  screen.appendChild(nibp);

  parent.appendChild(screen);
}
