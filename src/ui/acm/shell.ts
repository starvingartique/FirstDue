// ACM overlay shell, implemented from scratch Nov 3. One full-screen
// overlay with the 3D scene dimmed behind it: header row, left action
// column with the 8-category icon bar, center body column with the triage
// strip, right overview column, and the bottom activity log + quick view
// row. H toggles, Esc closes, opening never pauses. Number keys pick
// categories and W/A/S/D/Z/X pick body parts while open; hotkeys never
// fire while typing. Ctrl+H with the menu closed peeks a small card.
// Assessment rows arm a pop-up watch: when the check lands in observed,
// a modal shows only what the player found. The center ACE progress bar
// with cancel reuses Sim.pending and Sim.cancelPending, the same cancel
// semantics as the Prompt 10 bar; partner fetch and packing-hold jobs
// show as the smaller second bar.

import type { RegionId } from "../../patient/regions";
import type { Sim } from "../../sim/engine";
import { CANCEL_GLYPH } from "../progressBar";
import { sayLine } from "../wording";
import { actionRowsFor, type AcmActionHost } from "./actions";
import { breathingRows, lineStartRows, manualRows, monitorAttachRows } from "./actions2";
import { buildAcmBody } from "./body";
import { buildActivityLog, buildQuickView } from "./bottom";
import { buildLineCards, buildMeds, buildTriage, type AcmCardHost } from "./cards";
import { bleedLineForTier, bleedTierForRate, fmtBandTime, fmtClockT, pulseRateWords } from "./format";
import { buildMonitorScreen } from "./monitor";
import { buildOverview } from "./overview";
import { buildRow } from "./rows";
import { ACM_CATEGORIES, freshRunState, type AcmCategory, type AcmRunState, type TriageLevel } from "./types";

export interface AcmHooks {
  sim: () => Sim | null;
  region: () => RegionId | null;
  setRegion: (region: RegionId | null) => void;
  /** ACE orientation setting: mirror so the patient faces the viewer. */
  mirrored: () => boolean;
  painAsked: () => boolean;
  patientLabel: () => string;
  /** After any Sim call: main refreshes scene-side UI. */
  onRun: () => void;
  /** Triage is the player's call, stored for the run report. */
  onTriage: (level: TriageLevel) => void;
  /** Category changed by key, click, or kit jump (tips follow it). */
  onCategory: (cat: AcmCategory) => void;
}

type AssessKey = "hr" | "lungs" | "sbp" | "capRefill";

/** Screen-side body keys: A/Z pick the screen-left limbs, D/X the right. */
function regionForKey(code: string, mirrored: boolean): RegionId | null {
  const leftArm = mirrored ? "arm_right" : "arm_left";
  const rightArm = mirrored ? "arm_left" : "arm_right";
  const leftLeg = mirrored ? "leg_right" : "leg_left";
  const rightLeg = mirrored ? "leg_left" : "leg_right";
  switch (code) {
    case "KeyW": return "head";
    case "KeyS": return "chest_left";
    case "KeyA": return leftArm;
    case "KeyD": return rightArm;
    case "KeyZ": return leftLeg;
    case "KeyX": return rightLeg;
    default: return null;
  }
}

function typingActive(): boolean {
  const el = document.activeElement;
  if (el === null) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

export class AcmShell {
  readonly state: AcmRunState = freshRunState();
  private readonly hooks: AcmHooks;
  private readonly root: HTMLElement;
  private readonly peekRoot: HTMLElement;
  private open = false;
  private refusal: string | null = null;
  private armed: { key: AssessKey; since_s: number } | null = null;
  private modalOpen = false;
  private peeking = false;
  private peekTimer: number | null = null;
  private focusGuard = false;
  private sig = "";
  private forced = true;

  private readonly clockEl = document.createElement("span");
  private readonly catbarEl = document.createElement("div");
  private readonly actionsEl = document.createElement("div");
  private readonly bodyEl = document.createElement("div");
  private readonly overviewEl = document.createElement("div");
  private readonly logEl = document.createElement("div");
  private readonly quickEl = document.createElement("div");
  private readonly progressEl = document.createElement("div");
  private readonly modalEl = document.createElement("div");

  constructor(root: HTMLElement, peekRoot: HTMLElement, hooks: AcmHooks) {
    this.root = root;
    this.peekRoot = peekRoot;
    this.hooks = hooks;
    this.root.hidden = true;
    this.root.className = "acm-root";
    this.peekRoot.hidden = true;
    this.peekRoot.className = "acm-peek";
    this.build();
    this.root.addEventListener("focusin", (event) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      this.focusGuard = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    });
    this.root.addEventListener("focusout", () => {
      this.focusGuard = false;
      this.forced = true;
      this.refresh();
    });
    document.addEventListener("keydown", (event) => this.onKeyDown(event));
    document.addEventListener("keyup", (event) => this.onKeyUp(event));
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.root.hidden = !open;
    if (open) {
      this.hidePeek();
      this.forced = true;
      this.refresh();
    } else {
      this.closeModal();
    }
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  /** Kit jumps and doll clicks land on a category, opening the menu. */
  showCategory(cat: AcmCategory): void {
    this.state.category = cat;
    this.refusal = null;
    this.hooks.onCategory(cat);
    this.setOpen(true);
    this.forced = true;
    this.refresh();
  }

  resetRun(): void {
    const fresh = freshRunState();
    this.state.category = fresh.category;
    this.state.exam = fresh.exam;
    this.state.triage = fresh.triage;
    this.state.controls = fresh.controls;
    this.state.expanded = fresh.expanded;
    this.state.drugId = fresh.drugId;
    this.state.refDrug = fresh.refDrug;
    this.refusal = null;
    this.armed = null;
    this.closeModal();
    this.forced = true;
  }

  /** Reword everything (wording toggle) without touching the sim. */
  reword(): void {
    this.forced = true;
    this.refresh();
  }

  private build(): void {
    const dim = document.createElement("div");
    dim.className = "acm-veil";
    const panel = document.createElement("div");
    panel.className = "acm-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", sayLine("Medical menu"));

    const header = document.createElement("div");
    header.className = "acm-header";
    const title = document.createElement("span");
    title.className = "acm-title";
    title.textContent = sayLine("Medical menu").toUpperCase();
    const heads = document.createElement("div");
    heads.className = "acm-heads";
    const leftHead = document.createElement("span");
    leftHead.className = "acm-head-left";
    leftHead.textContent = sayLine("Examine and treatment").toUpperCase();
    const midHead = document.createElement("span");
    midHead.className = "acm-head-mid";
    midHead.dataset["patient"] = "1";
    const rightHead = document.createElement("span");
    rightHead.className = "acm-head-right";
    rightHead.textContent = sayLine("Overview").toUpperCase();
    heads.append(leftHead, midHead, rightHead);
    this.clockEl.className = "acm-clock";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "acm-close";
    close.textContent = "H";
    close.title = sayLine("Close (H or Esc)");
    close.setAttribute("aria-label", sayLine("Close the medical menu"));
    close.addEventListener("click", () => this.setOpen(false));
    header.append(title, heads, this.clockEl, close);

    const main = document.createElement("div");
    main.className = "acm-main";
    const left = document.createElement("div");
    left.className = "acm-left";
    this.catbarEl.className = "acm-catbar";
    this.actionsEl.className = "acm-actions";
    left.append(this.catbarEl, this.actionsEl);
    const center = document.createElement("div");
    center.className = "acm-center";
    this.bodyEl.className = "acm-bodycol";
    center.appendChild(this.bodyEl);
    const right = document.createElement("div");
    right.className = "acm-right";
    this.overviewEl.className = "acm-overview";
    right.appendChild(this.overviewEl);
    main.append(left, center, right);

    const bottom = document.createElement("div");
    bottom.className = "acm-bottom";
    this.logEl.className = "acm-log";
    this.quickEl.className = "acm-quick";
    bottom.append(this.logEl, this.quickEl);

    this.progressEl.className = "acm-progress";
    this.modalEl.className = "acm-modal";
    this.modalEl.hidden = true;
    panel.append(header, main, bottom);
    this.root.append(dim, panel, this.progressEl, this.modalEl);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (typingActive()) return;
    if (event.code === "Escape") {
      if (this.modalOpen) this.closeModal();
      else if (this.open) this.setOpen(false);
      return;
    }
    // Peek: hold Ctrl+H with the menu closed.
    if (event.code === "KeyH" && event.ctrlKey && !event.metaKey && !this.open) {
      event.preventDefault();
      if (this.peekTimer !== null) {
        window.clearTimeout(this.peekTimer);
        this.peekTimer = null;
      }
      this.peeking = true;
      this.renderPeek();
      return;
    }
    if (event.code === "KeyH" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.toggle();
      return;
    }
    if (!this.open || this.modalOpen) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const cat = ACM_CATEGORIES.find((c) => c.key === event.key);
    if (cat !== undefined) {
      this.state.category = cat.id;
      this.refusal = null;
      this.hooks.onCategory(cat.id);
      this.forced = true;
      this.refresh();
      return;
    }
    const region = regionForKey(event.code, this.hooks.mirrored());
    if (region !== null) {
      this.hooks.setRegion(region);
      this.forced = true;
      this.refresh();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (!this.peeking) return;
    if (event.code === "KeyH" || event.code === "ControlLeft" || event.code === "ControlRight") {
      if (this.peekTimer !== null) window.clearTimeout(this.peekTimer);
      this.peekTimer = window.setTimeout(() => this.hidePeek(), 1000);
    }
  }

  private hidePeek(): void {
    this.peeking = false;
    if (this.peekTimer !== null) {
      window.clearTimeout(this.peekTimer);
      this.peekTimer = null;
    }
    this.peekRoot.hidden = true;
  }

  private renderPeek(): void {
    const sim = this.hooks.sim();
    if (sim === null) {
      this.peekRoot.hidden = true;
      return;
    }
    this.peekRoot.replaceChildren();
    const head = document.createElement("div");
    head.className = "acm-peek-head";
    head.textContent = sayLine(this.hooks.patientLabel()).toUpperCase();
    this.peekRoot.appendChild(head);
    const body = buildAcmBody({
      sim,
      exam: this.state.exam,
      selected: this.hooks.region(),
      mirrored: this.hooks.mirrored(),
      triage: this.state.triage,
      onSelect: () => {},
      onTriage: () => {}
    });
    body.classList.add("acm-peek-body");
    this.peekRoot.appendChild(body);
    const tier = bleedTierForRate(sim.bleedRate_mL_per_min());
    const bleed = bleedLineForTier(tier);
    const bleedLine = document.createElement("div");
    bleedLine.className = `acm-peek-line ${bleed.cls}`;
    bleedLine.textContent = sayLine(bleed.text);
    this.peekRoot.appendChild(bleedLine);
    const vitals = document.createElement("div");
    vitals.className = "acm-peek-line acm-dim";
    const bits: string[] = [];
    if (sim.level === 1) {
      bits.push(`HR ${sim.vitals.hr_bpm}`, `SBP ${sim.vitals.sbp_mmhg}`, `SpO2 ${sim.vitals.spo2_pct}`);
    } else {
      const o = sim.observed;
      if (o.hr !== undefined) bits.push(`HR ${o.hr.value}`);
      if (o.sbp !== undefined) bits.push(`SBP ${o.sbp.value}`);
      if (o.spo2 !== undefined) bits.push(`SpO2 ${o.spo2.value}`);
      if (o.rr !== undefined) bits.push(`RR ${o.rr.value}`);
    }
    vitals.textContent = sayLine(bits.length > 0 ? bits.join("  ") : "No vitals measured");
    this.peekRoot.appendChild(vitals);
    if (sim.tq.applied) {
      const tq = document.createElement("div");
      tq.className = "acm-peek-line acm-tqline";
      tq.textContent = sayLine(`TQ ${fmtBandTime(sim.tq.appliedAt_s)}${sim.tq.timeWritten ? "" : " (no time written)"}`);
      this.peekRoot.appendChild(tq);
    }
    this.peekRoot.hidden = false;
  }

  private openModal(title: string, lines: string[]): void {
    this.modalEl.replaceChildren();
    const card = document.createElement("div");
    card.className = "acm-modal-card";
    const head = document.createElement("div");
    head.className = "acm-modal-head";
    head.textContent = sayLine(title);
    card.appendChild(head);
    for (const text of lines) {
      const div = document.createElement("div");
      div.className = "acm-modal-line";
      div.textContent = sayLine(text);
      card.appendChild(div);
    }
    const note = document.createElement("div");
    note.className = "acm-modal-note";
    note.textContent = sayLine("Logged to Quick View.");
    card.appendChild(note);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "acm-modal-close";
    close.textContent = sayLine("Close");
    close.addEventListener("click", () => this.closeModal());
    card.appendChild(close);
    this.modalEl.appendChild(card);
    this.modalEl.hidden = false;
    this.modalOpen = true;
    close.focus();
  }

  private closeModal(): void {
    this.modalEl.hidden = true;
    this.modalEl.replaceChildren();
    this.modalOpen = false;
  }

  private watchAssessment(sim: Sim): void {
    if (this.armed === null) return;
    const { key, since_s } = this.armed;
    const read = key === "sbp" ? sim.observed.sbp : sim.observed[key];
    if (read === undefined || read.t_s <= since_s) return;
    this.armed = null;
    if (!this.open) return;
    if (key === "hr") {
      const n = Number(read.value);
      const words = Number.isFinite(n) && read.value.trim() !== "" ? pulseRateWords(n) : null;
      this.openModal("Feel pulse", [
        words === null
          ? `Pulse: ${read.value} (${read.method}).`
          : `Pulse ${read.value}: ${words} (${read.method}).`
      ]);
    } else if (key === "lungs") {
      this.openModal("Listen to lungs", [`Lungs: ${read.value} (${read.method}).`]);
    } else if (key === "sbp") {
      const dbp = sim.observed.dbp;
      const both = dbp !== undefined && dbp.t_s === read.t_s ? `${read.value}/${dbp.value}` : read.value;
      this.openModal("Measure BP", [`BP ${both} (${read.method}).`]);
    } else {
      this.openModal("Cap refill", [`Cap refill: ${read.value} (${read.method}).`]);
    }
  }

  private actionHost(sim: Sim): AcmActionHost {
    return {
      sim,
      state: this.state,
      rerender: () => {
        this.forced = true;
        this.refresh();
        this.hooks.onRun();
      },
      onCannot: (label, reason) => {
        sim.addLog("info", `Cannot: ${label} - ${reason}`);
        this.refusal = `${label}: ${reason}`;
      },
      onOk: () => {
        this.refusal = null;
      },
      region: this.hooks.region(),
      onFindings: (region, items, kind) => {
        if (kind === "inspect") {
          this.state.exam.inspected.add(region);
          this.state.exam.findings.set(region, [...items]);
        } else {
          this.state.exam.palpated.add(region);
          const prior = this.state.exam.findings.get(region) ?? [];
          const merged = [...prior];
          for (const item of items) {
            if (!merged.includes(item)) merged.push(item);
          }
          this.state.exam.findings.set(region, merged);
        }
      },
      examFindings: (region) => this.state.exam.findings.get(region) ?? [],
      onAssess: (key) => {
        this.armed = { key, since_s: sim.t_s };
      }
    };
  }

  private cardHost(sim: Sim): AcmCardHost {
    const actions = this.actionHost(sim);
    return {
      ...actions,
      triage: this.state.triage,
      onTriage: (level) => {
        this.state.triage = level;
        this.hooks.onTriage(level);
        this.forced = true;
        this.refresh();
      }
    };
  }

  private renderCatbar(): void {
    this.catbarEl.replaceChildren();
    for (const cat of ACM_CATEGORIES) {
      if (cat.id === "examine") {
        const divider = document.createElement("div");
        divider.className = "acm-catdiv";
        this.catbarEl.appendChild(divider);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = `acm-cat${this.state.category === cat.id ? " acm-cat-sel" : ""}`;
      button.textContent = cat.glyph;
      button.title = sayLine(`${cat.label} (${cat.key})`);
      button.setAttribute("aria-label", sayLine(cat.label));
      const id: AcmCategory = cat.id;
      button.addEventListener("click", () => {
        this.state.category = id;
        this.refusal = null;
        this.hooks.onCategory(id);
        this.forced = true;
        this.refresh();
      });
      this.catbarEl.appendChild(button);
    }
  }

  private renderActions(sim: Sim): void {
    this.actionsEl.replaceChildren();
    if (this.refusal !== null) {
      const div = document.createElement("div");
      div.className = "acm-refusal";
      div.textContent = sayLine(this.refusal);
      this.actionsEl.appendChild(div);
    }
    const category = this.state.category;
    if (category === "triage") {
      buildTriage(this.cardHost(sim), this.actionsEl);
      return;
    }
    if (category === "meds") {
      buildMeds(this.cardHost(sim), this.actionsEl);
      return;
    }
    if (category === "lines") {
      const host = this.actionHost(sim);
      for (const row of lineStartRows(host)) buildRow(host, this.actionsEl, row);
      buildLineCards(this.cardHost(sim), this.actionsEl);
      return;
    }
    if (category === "monitor") {
      const host = this.actionHost(sim);
      for (const row of monitorAttachRows(host)) buildRow(host, this.actionsEl, row);
      buildMonitorScreen(sim, this.actionsEl);
      for (const row of manualRows(host)) buildRow(host, this.actionsEl, row);
      return;
    }
    if (category === "breathing") {
      const host = this.actionHost(sim);
      for (const row of breathingRows(host)) buildRow(host, this.actionsEl, row);
      return;
    }
    const host = this.actionHost(sim);
    for (const row of actionRowsFor(host, category)) buildRow(host, this.actionsEl, row);
  }

  private renderBody(sim: Sim): void {
    this.bodyEl.replaceChildren();
    this.bodyEl.appendChild(
      buildAcmBody({
        sim,
        exam: this.state.exam,
        selected: this.hooks.region(),
        mirrored: this.hooks.mirrored(),
        triage: this.state.triage,
        onSelect: (region) => {
          this.hooks.setRegion(region);
          this.forced = true;
          this.refresh();
        },
        onTriage: (level) => {
          this.state.triage = level;
          this.hooks.onTriage(level);
          this.forced = true;
          this.refresh();
        }
      })
    );
  }

  private renderProgress(sim: Sim): void {
    this.progressEl.replaceChildren();
    const pending = sim.pending;
    if (pending === null) {
      this.progressEl.hidden = true;
      return;
    }
    this.progressEl.hidden = false;
    const label = document.createElement("div");
    label.className = "acm-prog-label";
    label.textContent = sayLine(`${pending.label} - ${pending.remaining_s}s left`).toUpperCase();
    const track = document.createElement("div");
    track.className = "acm-prog-track";
    const fill = document.createElement("div");
    fill.className = "acm-prog-fill";
    const done = pending.total_s <= 0 ? 1 : 1 - pending.remaining_s / pending.total_s;
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, done)) * 100)}%`;
    track.appendChild(fill);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "acm-prog-cancel";
    cancel.textContent = CANCEL_GLYPH;
    cancel.title = sayLine("Cancel the running action");
    cancel.setAttribute("aria-label", sayLine("Cancel the running action"));
    cancel.addEventListener("click", () => {
      // Same cancel semantics as the Prompt 10 bar: refund, log, nothing
      // completes after. A cancelled check never pops its modal.
      this.armed = null;
      sim.cancelPending();
      this.forced = true;
      this.refresh();
      this.hooks.onRun();
    });
    this.progressEl.append(label, track, cancel);
    // Partner jobs: truck fetches and packing holds ride the small bar.
    const jobs: { label: string; remaining_s: number; total_s: number }[] = [];
    for (const fetch of sim.fetches) {
      jobs.push({ label: `Fetch ${fetch.itemId}`, remaining_s: fetch.remaining_s, total_s: fetch.total_s });
    }
    if (sim.packing.holder === "partner" && sim.packing.holdRemaining_s > 0) {
      jobs.push({
        label: "Partner holds pressure",
        remaining_s: sim.packing.holdRemaining_s,
        total_s: sim.packing.holdTotal_s
      });
    }
    for (const job of jobs) {
      const row = document.createElement("div");
      row.className = "acm-partner";
      const text = document.createElement("div");
      text.className = "acm-partner-label";
      text.textContent = sayLine(`${job.label} - ${Math.ceil(job.remaining_s)}s left`).toUpperCase();
      const ptrack = document.createElement("div");
      ptrack.className = "acm-partner-track";
      const pfill = document.createElement("div");
      pfill.className = "acm-partner-fill";
      const pdone = job.total_s <= 0 ? 1 : 1 - job.remaining_s / job.total_s;
      pfill.style.width = `${Math.round(Math.min(1, Math.max(0, pdone)) * 100)}%`;
      ptrack.appendChild(pfill);
      row.append(text, ptrack);
      this.progressEl.appendChild(row);
    }
  }

  private signature(sim: Sim): string {
    const o = sim.observed;
    const observed = JSON.stringify(o);
    const gear = [
      sim.tq.applied, sim.tq.occluded, sim.tq.secondApplied, sim.tq.timeWritten,
      sim.packing.stage, sim.packing.holder, sim.dressing.applied, sim.dressing.soaked,
      sim.pressure.active, sim.pressure.holder, sim.beltTrap, sim.exposed,
      sim.airway.adjunct, sim.airway.ett !== null, sim.o2.device,
      sim.monitor.spo2Attached, sim.monitor.etco2Attached, sim.defibPadsOn,
      sim.fluids.lines.length, sim.fluids.lines.map((l) => `${l.kind}${l.site}${l.bag?.fluid ?? "-"}${l.infiltrated}`).join(","),
      sim.wrapped, sim.arrested, sim.level
    ].join("|");
    const exam = `${this.state.exam.inspected.size}/${this.state.exam.palpated.size}/${[...this.state.exam.findings.values()].flat().length}`;
    return [
      sim.log.length,
      sim.pending === null ? "idle" : `${sim.pending.id}:${sim.pending.remaining_s}`,
      sim.fetches.map((f) => `${f.itemId}:${Math.ceil(f.remaining_s)}`).join(","),
      Math.ceil(sim.packing.holdRemaining_s),
      observed, gear, exam,
      this.state.category, this.hooks.region() ?? "-", this.state.triage,
      this.hooks.mirrored(), this.hooks.painAsked(), this.refusal ?? ""
    ].join("~");
  }

  /** Called every frame and after every run. Cheap parts always update. */
  refresh(): void {
    const sim = this.hooks.sim();
    if (sim === null) {
      this.root.hidden = true;
      this.peekRoot.hidden = true;
      return;
    }
    // Late bind: H before dispatch accept opens a sim-less shell, so sync.
    this.root.hidden = !this.open;
    this.clockEl.textContent = fmtClockT(sim.t_s);
    const patient = this.root.querySelector('[data-patient="1"]');
    if (patient !== null) patient.textContent = sayLine(this.hooks.patientLabel()).toUpperCase();
    this.renderProgress(sim);
    this.watchAssessment(sim);
    if (this.peeking) this.renderPeek();
    if (!this.open) return;
    if (this.focusGuard && !this.forced) return;
    const sig = this.signature(sim);
    if (!this.forced && sig === this.sig) return;
    this.forced = false;
    this.sig = sig;
    this.renderCatbar();
    this.renderActions(sim);
    this.renderBody(sim);
    this.overviewEl.replaceChildren();
    buildOverview(
      { sim, exam: this.state.exam, region: this.hooks.region(), painAsked: this.hooks.painAsked() },
      this.overviewEl
    );
    this.logEl.replaceChildren();
    buildActivityLog(sim, this.logEl);
    this.quickEl.replaceChildren();
    buildQuickView(sim, this.quickEl);
  }
}
