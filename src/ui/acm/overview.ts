// ACM right column OVERVIEW, implemented from scratch Nov 3. Patient
// lines first (bleeding words, control words, lines, pain words when the
// player asked in chat), then the selected part (findings, bandaged
// salmon, TQ amber with time, examined-clean vs not-examined). Words
// only, ACE colors, no true vitals: bleeding tiers bucket the same rate
// the 3D pulse uses, pain is gated on a chat question, findings come from
// ACM exam memory plus visible engine states.

import type { RegionId } from "../../patient/regions";
import { REGION_LABELS } from "../../patient/regions";
import type { Sim } from "../../sim/engine";
import { sayLine } from "../wording";
import { bleedLineForTier, bleedTierForRate, fmtBandTime, painWords } from "./format";
import type { AcmExamState } from "./types";

export interface AcmOverviewHost {
  sim: Sim;
  exam: AcmExamState;
  region: RegionId | null;
  /** True once the player asked about pain in chat. */
  painAsked: boolean;
}

function line(parent: HTMLElement, text: string, cls?: string): void {
  const div = document.createElement("div");
  div.className = `acm-ov${cls === undefined ? "" : ` ${cls}`}`;
  div.textContent = sayLine(text);
  parent.appendChild(div);
}

export function buildOverview(host: AcmOverviewHost, parent: HTMLElement): void {
  const { sim, region } = host;
  const head = document.createElement("div");
  head.className = "acm-col-head";
  head.textContent = sayLine("Overview").toUpperCase();
  parent.appendChild(head);

  // Patient lines.
  const tier = bleedTierForRate(sim.bleedRate_mL_per_min());
  const bleed = bleedLineForTier(tier);
  line(parent, bleed.text, bleed.cls);
  const controlled = sim.tq.applied && sim.tq.occluded;
  const packed = sim.packing.stage === "set" || sim.packing.stage === "holding";
  line(
    parent,
    tier === "none"
      ? controlled || packed
        ? "Bleeding controlled"
        : "No active bleeding seen"
      : "Bleeding NOT controlled",
    tier === "none" ? "acm-dim" : "acm-bleed-severe"
  );
  if (sim.fluids.lines.length === 0) {
    line(parent, "No IV", "acm-dim");
  } else {
    for (const l of sim.fluids.lines) {
      const bag = l.bag === null ? "no bag" : `${l.bag.fluid} ${Math.round(l.bag.volumeLeft_mL)} mL left`;
      line(parent, `${l.kind} ${l.site}: ${bag}${l.infiltrated ? " INFILTRATED" : ""}.`);
    }
  }
  if (host.painAsked) line(parent, `Pain: ${painWords(sim.vitals.pain_0_to_10)}.`);

  const sep = document.createElement("div");
  sep.className = "acm-sep";
  parent.appendChild(sep);

  // Selected part.
  if (region === null) {
    line(parent, "No part selected", "acm-dim");
    return;
  }
  line(parent, REGION_LABELS[region], "acm-ov-name");
  const findings = [...(host.exam.findings.get(region) ?? [])];
  if (region === "leg_left" && sim.exposed) {
    findings.push("Partial femoral laceration, anterior thigh, spurting arterial blood.");
  }
  const inspected = host.exam.inspected.has(region) || host.exam.palpated.has(region);
  if (!inspected && findings.length === 0) {
    line(parent, "Not examined", "acm-dim");
    return;
  }
  const packedLeg = region === "leg_left" && sim.packing.stage !== "none";
  const dressedLeg = region === "leg_left" && sim.dressing.applied;
  if (findings.length === 0) {
    line(parent, "No injuries found", "acm-dim");
  }
  for (const finding of findings) {
    const lower = finding.toLowerCase();
    if (/fracture/.test(lower)) line(parent, finding, "acm-fracture");
    else if (/splint/.test(lower)) line(parent, finding, "acm-splint");
    else if (packedLeg || dressedLeg) line(parent, `[B] ${finding}`, "acm-bandaged");
    else line(parent, finding);
  }
  if (packedLeg && sim.packing.stage !== "none") {
    line(parent, `[B] Wound packed (${sim.packing.stage}).`, "acm-bandaged");
  }
  if (dressedLeg) line(parent, "[B] Pressure dressing on.", "acm-bandaged");
  if (region === "leg_left" && sim.tq.applied) {
    line(parent, `Tourniquet applied ${fmtBandTime(sim.tq.appliedAt_s)}`, "acm-tqline");
    if (sim.tq.secondApplied) line(parent, "Second tourniquet on.", "acm-tqline");
  }
  if (region === "leg_left" && sim.beltTrap) line(parent, "Bystander belt on the thigh.", "acm-beltline");
}
