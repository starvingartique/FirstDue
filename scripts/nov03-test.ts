// Nov 3 demo-day pass: cancel + refund, doll flip, BVM feedback, PEA
// display, talk gating, vitals fluctuation, drug reference helpers,
// group-chat mirror, and top-bar shift names. Headless-safe imports only;
// DOM panels are covered by the Edge boot check, not here.

import { newBikeDownSim, newTestSim } from "../src/sim/scenario";
import { markersFor, DOLL_SHAPES } from "../src/ui/bodyDoll";
import { vitalsPillText, defibMonitorLine, rhythmWords, pulseWords } from "../src/ui/monitorWords";
import { patientSnapshot, cannedReply, cannedUnprompted } from "../src/ui/talk";
import { vitalWave } from "../src/sim/physiology";
import {
  drugEffectWords,
  doseLine,
  joshWorkedDose,
  pushChecks,
  allDrugs,
  drugCatalog
} from "../src/sim/drugs";
import { mirrorLogLine } from "../src/ui/chatDock";
import { marchDescription } from "../src/ui/marchStrip";
import { shiftFor } from "../src/ui/hud";

let failures = 0;

function check(name: string, cond: boolean, detail: string): void {
  if (cond) console.log(`PASS ${name} (${detail})`);
  else {
    failures++;
    console.error(`FAIL ${name} (${detail})`);
  }
}

// - cancel + refund -

{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  const before = sim.atPatient("cat_tourniquet");
  const started = sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 4, writeTime: true });
  const grabbed = sim.atPatient("cat_tourniquet");
  const cancelled = sim.cancelPending();
  const after = sim.atPatient("cat_tourniquet");
  check("cancel: TQ start grabs the CAT", started.ok && grabbed === before - 1, `${before} -> ${grabbed}`);
  check("cancel: pending clears", cancelled.ok && sim.pending === null, String(sim.pending));
  check("cancel: CAT refunded to the pile", after === before, `${grabbed} -> ${after}`);
  check(
    "cancel: logged",
    sim.log.some((e) => e.text.startsWith("Cancelled: Apply CAT")),
    sim.log[sim.log.length - 1]?.text ?? "no log"
  );
  for (let i = 0; i < 60; i++) sim.tick();
  check(
    "cancel: nothing completes after",
    !sim.log.some((e) => e.text.startsWith("Done: Apply CAT")),
    `tq=${sim.tq.applied}`
  );
}

{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  const nothing = sim.cancelPending();
  check("cancel: nothing running refuses", !nothing.ok, nothing.reason ?? "ok?");
}

{
  // Packing hold cancel: wound stays packed, pressure restarts, no gamble.
  const sim = newBikeDownSim();
  sim.setLevel(2);
  sim.exposeWound();
  for (let i = 0; i < 15; i++) sim.tick();
  sim.packWound({ technique: "packed", gauze: "hemostatic" });
  for (let i = 0; i < 70; i++) sim.tick();
  sim.holdPacking("player");
  const holding = sim.packing.stage === "holding";
  sim.cancelPending();
  check(
    "cancel: packing hold reverts to packed-pending-hold",
    holding && sim.packing.stage === "packed_pending_hold" && sim.packing.holder === null,
    sim.packing.stage
  );
}

// - doll flip: patient left on the viewer left -

{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  sim.applyTQ({ strapTight: true, placement: "high_thigh", halfTurns: 4, writeTime: true });
  for (let i = 0; i < 60; i++) sim.tick();
  const tq = markersFor(sim).filter((m) => m.kind === "tq");
  const legLeft = DOLL_SHAPES.leg_left[0];
  check(
    "doll: TQ marker on viewer left",
    tq.length > 0 && (tq[0]?.x ?? 99) < 60,
    `${tq[0]?.x},${tq[0]?.y}`
  );
  check(
    "doll: left leg shape on viewer left",
    legLeft !== undefined && legLeft.kind === "rect" && legLeft.x < 60,
    legLeft !== undefined && legLeft.kind === "rect" ? `x=${legLeft.x}` : "?"
  );
  const legRight = DOLL_SHAPES.leg_right[0];
  check(
    "doll: right leg shape on viewer right",
    legRight !== undefined && legRight.kind === "rect" && legRight.x > 60,
    legRight !== undefined && legRight.kind === "rect" ? `x=${legRight.x}` : "?"
  );
}

// - BVM feedback -

{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  sim.squeezeBvm(550);
  check(
    "BVM: correct breath logs feedback",
    sim.log.some((e) => e.text.includes("BVM breath") && e.text.includes("ventilating")),
    sim.log[sim.log.length - 1]?.text ?? "no log"
  );
}

// - PEA display -

{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  sim.attachSpo2();
  sim.attachDefibPads();
  for (let i = 0; i < 600 && !sim.arrested; i++) sim.tick();
  check("PEA: untreated run arrests", sim.arrested && sim.vitals.rhythm === "pea", sim.vitals.rhythm);
  const pill = vitalsPillText(sim);
  check("PEA: pill shows rhythm with no pulse", (pill ?? "").includes("NO PULSE"), pill ?? "hidden");
  const line = defibMonitorLine(sim);
  check("PEA: defib line shows rhythm with no pulse", line.includes("PEA") && line.includes("NO pulse"), line);
}

{
  const sim = newBikeDownSim();
  sim.setLevel(2);
  sim.attachSpo2();
  const pill = vitalsPillText(sim);
  check("pill: perfusing run shows HR", (pill ?? "").startsWith("HR "), pill ?? "hidden");
  check("monitor: sinus rhythm words", rhythmWords("sinus") === "sinus rhythm", rhythmWords("sinus"));
  check("monitor: pulse palpable words", pulseWords(sim).includes("palpable"), pulseWords(sim));
}

// - talk gating: no "cannot breathe" from a talking patient -

{
  // 35.7 percent loss, no bleed: RR 32+, GCS 13, still talking.
  const sim = newTestSim(7, 2000, { femoralBleed: false });
  check("talk rig: RR 30+ and talking", sim.vitals.rr_per_min >= 30 && sim.vitals.gcs_total > 8, `rr=${sim.vitals.rr_per_min} gcs=${sim.vitals.gcs_total}`);
  const snap = patientSnapshot(sim);
  check("talk: snapshot never says cannot breathe", !/can ?not breathe|cannot breathe/i.test(snap), snap.slice(0, 120));
  check("talk: snapshot still shows struggle", /struggling|short of breath/i.test(snap), snap.slice(0, 120));
  const reply = cannedReply(sim, "can you breathe");
  check("talk: breathe reply fits a talking patient", !/can ?not|cannot/i.test(reply) && /breath/i.test(reply), reply);
  const unprompted = cannedUnprompted(sim);
  check("talk: unprompted air line fits talking", !/can ?not|cannot/i.test(unprompted) && /breathe/i.test(unprompted), unprompted);
}

// - vitals fluctuation -

{
  check("wave: zero at tick 0", vitalWave(0, 13, 27) === 0, String(vitalWave(0, 13, 27)));
  const sim = newBikeDownSim();
  sim.setLevel(2);
  const hrs = new Set<number>();
  const sbps = new Set<number>();
  for (let i = 0; i < 15; i++) {
    sim.tick();
    hrs.add(sim.vitals.hr_bpm);
    sbps.add(sim.vitals.sbp_mmhg);
  }
  check("fluct: HR varies across ticks", hrs.size >= 2, [...hrs].join(","));
  check("fluct: SBP varies across ticks", sbps.size >= 2, [...sbps].join(","));
  const hrRange = Math.max(...hrs) - Math.min(...hrs);
  check("fluct: HR stays small and believable", hrRange <= 6, `range=${hrRange}`);
}

// - drug reference helpers -

{
  const catalog = drugCatalog();
  const fent = catalog.usable.find((u) => u.drug.id === "fentanyl")?.drug;
  check("drugs: fentanyl usable", fent !== undefined, fent?.name ?? "missing");
  if (fent !== undefined) {
    const words = drugEffectWords(fent);
    check("drugs: effect words from tokens", words.some((w) => w === "Pain down a lot"), words.join("; "));
    const josh = joshWorkedDose(fent);
    check("drugs: Josh 80 kg worked dose", josh.includes("80 mcg"), josh);
  }
  const all = allDrugs();
  check("drugs: browser lists 104", all.length === 104, `${all.length}`);
  const epi = all.find((d) => d.id === "epinephrine");
  if (epi !== undefined) {
    const first = epi.dosing[0];
    check("drugs: dose line from data", first !== undefined && doseLine(first).includes("1 mg"), first === undefined ? "?" : doseLine(first));
  }
  const checks = pushChecks();
  check("drugs: 7 push checks", checks.checks.length === 7, `${checks.checks.length}`);
  check("drugs: advisor sign-off note", checks.note.includes("medic sign-off"), checks.note.slice(0, 60));
  const morphine = all.find((d) => d.id === "morphine");
  if (morphine !== undefined) {
    check("drugs: range protocol flags no single dose", joshWorkedDose(morphine).includes("TODO_CLINICAL"), joshWorkedDose(morphine).slice(0, 80));
  }
  // Sugammadex keeps the JSON anaphylaxis danger; the PDF omits it (PDF
  // gap, not a game bug). The display shows the JSON value verbatim.
  const sug = all.find((d) => d.id === "sugammadex");
  check(
    "drugs: sugammadex shows JSON anaphylaxis",
    sug !== undefined && (sug.dangers ?? []).some((d) => d.includes("Anaphylaxis")),
    sug === undefined ? "missing" : (sug.dangers ?? []).join("; ").slice(0, 80)
  );
  // Gap snapshot: fields missing in the JSON stay TODO_CLINICAL in the
  // display. These counts fail loudly if data is silently overwritten.
  const gaps = {
    onset: all.filter((d) => Object.entries(d.onset ?? {}).length === 0).length,
    duration: all.filter((d) => Object.entries(d.duration ?? {}).length === 0).length,
    contra: all.filter((d) => (d.contraindications ?? []).length === 0).length,
    dangers: all.filter((d) => (d.dangers ?? []).length === 0).length
  };
  check(
    "drugs: TODO gap counts unchanged",
    gaps.onset === 81 && gaps.duration === 86 && gaps.contra === 27 && gaps.dangers === 7,
    `onset=${gaps.onset} duration=${gaps.duration} contra=${gaps.contra} dangers=${gaps.dangers}`
  );
}

// - group chat mirror + top bar + MARCH description -

{
  check(
    "chat: fetch lines mirror as partner",
    mirrorLogLine("fetch", "cat_tourniquet fetched from the truck (50s round trip).")?.speaker === "partner",
    "fetch"
  );
  check(
    "chat: bystander lines mirror verbatim",
    mirrorLogLine("bleed", "Bystander lets go. The wound spurts.")?.speaker === "bystander",
    "bystander"
  );
  check("chat: talk lines stay out", mirrorLogLine("talk", "You: hi") === null, "talk");
  check("chat: exam lines stay out", mirrorLogLine("exam", "HR 120") === null, "exam");
  check("topbar: night shift name", shiftFor("night") === "Night Shift", shiftFor("night"));
  check("topbar: day shift name", shiftFor("day") === "Day Shift", shiftFor("day"));
  const desc = marchDescription("M");
  check("march: M description from data", desc !== null && desc.name.length > 0, desc?.name ?? "null");
}

if (failures > 0) {
  console.error(`${failures} Nov 3 check(s) FAILED.`);
  process.exit(1);
}
console.log("All Nov 3 checks passed.");
