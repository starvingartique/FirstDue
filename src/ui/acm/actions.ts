// ACM category action lists part 1: examine, bleeding, airway.
// Implemented from scratch Nov 3. Every row calls the same Sim method
// with the same arguments the left-panel menu uses today; only the
// presentation is ACM. Inspect-style rows record findings into ACM exam
// memory (replacing on re-inspect) instead of the menu cache.

import type { RegionId } from "../../patient/regions";
import { REGION_LABELS } from "../../patient/regions";
import type { Sim } from "../../sim/engine";
import { TRUCK_BOXES } from "../../sim/engine";
import type { Holder } from "../../sim/types";
import { loadOct28Conditions } from "../../data/loaders";
import { readNumber, type AcmNumberDef, type AcmRowDef, type AcmRowHost, type AcmSelectDef } from "./rows";
import { fmtClockT, lastDoneTime } from "./format";

export interface AcmActionHost extends AcmRowHost {
  region: RegionId | null;
  onFindings: (region: RegionId, items: string[], kind: "inspect" | "palpate") => void;
  examFindings: (region: RegionId) => string[];
  /** Assessment rows arm the pop-up watch when their check starts. */
  onAssess?: (key: "hr" | "lungs" | "sbp" | "capRefill") => void;
}

function running(sim: Sim, id: string): boolean {
  return sim.pending?.id === id;
}

function doneBadge(sim: Sim, needle: string): { text: string; cls: "check" | "done" } | null {
  const t = lastDoneTime(sim.log, needle);
  return t === null ? null : { text: `CHECK ${fmtClockT(t)}`, cls: "check" };
}

function inspectFindings(sim: Sim, region: RegionId): string[] {
  if (region === "leg_left") {
    return [
      "Bright red pulsatile spurting, timed to the pulse",
      "Blood pool expanding under the thigh",
      "Soaked jeans over the left thigh",
      sim.beltTrap ? "Belt cinched mid-thigh, leg purple and swollen below it" : "No belt on the thigh"
    ];
  }
  if (region === "arm_right") return ["Large abraded area with embedded gravel (road rash), oozing."];
  if (region === "back") return ["Back exposed: no wounds, no bleeding found. Spine non-tender."];
  try {
    const found: string[] = [];
    for (const c of loadOct28Conditions().conditions) {
      if (c.region === region || (c.region === "systemic" && region === "chest_left")) {
        found.push(...(c.findings["inspect"] ?? []));
      }
    }
    return found.length > 0 ? found : ["No obvious injury on inspection."];
  } catch {
    return ["No obvious injury on inspection."];
  }
}

function examRows(host: AcmActionHost): AcmRowDef[] {
  const { sim, region } = host;
  const rows: AcmRowDef[] = [];
  rows.push({
    id: "sweep",
    glyph: "SW",
    name: "Blood sweep (12s)",
    duration: "12s",
    badge: running(sim, "sweep") ? { text: "RUNNING", cls: "running" } : doneBadge(sim, "Blood sweep"),
    run: () => sim.bloodSweep()
  });
  if (region !== null) {
    const label = REGION_LABELS[region];
    if (region === "leg_left") {
      rows.push({
        id: "inspect",
        glyph: "IN",
        name: "Inspect the thigh",
        badge: hostBadge(host),
        run: () => {
          host.onFindings(region, inspectFindings(sim, region), "inspect");
          return { ok: true };
        }
      });
      rows.push({
        id: "expose",
        glyph: "EX",
        name: "Expose with shears (10s)",
        duration: "10s",
        stock: "trauma_shears",
        badge: sim.exposed
          ? { text: "SET", cls: "set" }
          : running(sim, "expose")
            ? { text: "RUNNING", cls: "running" }
            : null,
        run: () => sim.exposeWound()
      });
      rows.push({
        id: "palpate",
        glyph: "PP",
        name: "Palpate distal pulse",
        badge: hostBadge(host),
        run: () => {
          const gone = (sim.tq.applied && sim.tq.occluded) || sim.vitals.radial === "Absent";
          host.onFindings(region, [
            gone ? "No distal pulse palpable." : "Distal pulse present (bleed NOT controlled).",
            sim.legCongested() ? "Limb engorged, congested." : "No venous congestion."
          ], "palpate");
          return { ok: true };
        }
      });
    } else if (region === "back") {
      rows.push({
        id: "logroll",
        glyph: "LR",
        name: "Log roll with partner, check the back",
        badge: doneBadge(sim, "Log roll") ?? hostBadge(host),
        run: () => {
          const res = sim.movePatient("log_roll");
          if (res.ok) host.onFindings(region, inspectFindings(sim, region), "inspect");
          return res;
        }
      });
    } else if (region === "arm_right") {
      rows.push({
        id: "inspect",
        glyph: "IN",
        name: "Inspect the arm",
        badge: hostBadge(host),
        run: () => {
          host.onFindings(region, inspectFindings(sim, region), "inspect");
          return { ok: true };
        }
      });
    } else {
      rows.push({
        id: "inspect",
        glyph: "IN",
        name: `Inspect ${label}`,
        badge: hostBadge(host),
        run: () => {
          host.onFindings(region, inspectFindings(sim, region), "inspect");
          return { ok: true };
        }
      });
      rows.push({
        id: "palpate",
        glyph: "PP",
        name: `Palpate ${label}`,
        badge: hostBadge(host),
        run: () => {
          host.onFindings(region, ["No deformity, no crepitus, non-tender except as noted."], "palpate");
          return { ok: true };
        }
      });
    }
  }
  if (sim.pressure.bystanderShirt) {
    rows.push({
      id: "takeover",
      glyph: "TO",
      name: "Take over from the bystander",
      run: () => sim.takeOverFromBystander()
    });
  }
  rows.push({
    id: "clothing",
    glyph: "WC",
    name: "Remove wet clothing (45s)",
    duration: "45s",
    stock: "trauma_shears",
    badge: !sim.wetClothing
      ? { text: "SET", cls: "set" }
      : running(sim, "dry_clothes")
        ? { text: "RUNNING", cls: "running" }
        : null,
    run: () => sim.removeWetClothing()
  });
  rows.push({
    id: "wrap",
    glyph: "WR",
    name: "Wrap for hypothermia (30s)",
    duration: "30s",
    stock: "hypothermia_wrap_blanket",
    badge: sim.wrapped
      ? { text: "SET", cls: "set" }
      : running(sim, "wrap")
        ? { text: "RUNNING", cls: "running" }
        : null,
    run: () => sim.applyWrap()
  });
  // Assessment pop-ups also live here (spec: Monitor/Examine).
  rows.push(...assessRows(host));
  // Kit section rides at the bottom of Examine (general category).
  rows.push(...kitRows(host));
  return rows;
}

/** CHECK badge when the open region holds exam findings. */
function hostBadge(host: AcmActionHost): { text: string; cls: "check" } | null {
  const { region } = host;
  if (region === null) return null;
  return host.examFindings(region).length === 0 ? null : { text: "CHECK", cls: "check" };
}

export function assessRows(host: AcmActionHost): AcmRowDef[] {
  const { sim } = host;
  const arm = (key: "hr" | "lungs" | "sbp" | "capRefill", res: { ok: boolean }): void => {
    if (res.ok) host.onAssess?.(key);
  };
  return [
    {
      id: "assess-pulse",
      glyph: "PU",
      name: "Feel pulse (20s)",
      duration: "20s",
      badge: running(sim, "exam_pulse")
        ? { text: "RUNNING", cls: "running" }
        : sim.observed.hr !== undefined
          ? { text: `CHECK ${fmtClockT(sim.observed.hr.t_s)}`, cls: "check" }
          : null,
      run: () => {
        const res = sim.checkPulse();
        arm("hr", res);
        return res;
      }
    },
    {
      id: "assess-lungs",
      glyph: "LU",
      name: "Listen to lungs (25s)",
      duration: "25s",
      badge: running(sim, "exam_lung")
        ? { text: "RUNNING", cls: "running" }
        : sim.observed.lungs !== undefined
          ? { text: `CHECK ${fmtClockT(sim.observed.lungs.t_s)}`, cls: "check" }
          : null,
      run: () => {
        const res = sim.checkLungs();
        arm("lungs", res);
        return res;
      }
    },
    {
      id: "assess-bp",
      glyph: "BP",
      name: "Measure BP, palpated (30s)",
      duration: "30s",
      badge: running(sim, "exam_bpp")
        ? { text: "RUNNING", cls: "running" }
        : sim.observed.sbp !== undefined
          ? { text: `CHECK ${fmtClockT(sim.observed.sbp.t_s)}`, cls: "check" }
          : null,
      run: () => {
        const res = sim.checkBpPalp();
        arm("sbp", res);
        return res;
      }
    },
    {
      id: "assess-cap",
      glyph: "CR",
      name: "Cap refill (8s)",
      duration: "8s",
      badge: running(sim, "exam_cr")
        ? { text: "RUNNING", cls: "running" }
        : sim.observed.capRefill !== undefined
          ? { text: `CHECK ${fmtClockT(sim.observed.capRefill.t_s)}`, cls: "check" }
          : null,
      run: () => {
        const res = sim.checkCapRefill();
        arm("capRefill", res);
        return res;
      }
    }
  ];
}

function kitRows(host: AcmActionHost): AcmRowDef[] {
  const { sim } = host;
  const rows: AcmRowDef[] = [];
  const fetchSel: AcmSelectDef[] = [
    {
      id: "acm-fetch-item",
      label: "Fetch",
      options: [
        { value: "cat_tourniquet", label: "CAT" },
        { value: "hemostatic_gauze_zfold", label: "Hemostatic gauze" },
        { value: "pressure_bandage_6in", label: "6 in bandage" },
        { value: "softt_wide_tourniquet", label: "SOF-T" },
        { value: "junctional_tourniquet_samjt", label: "SAM JT" },
        { value: "hypothermia_wrap_blanket", label: "Wrap blanket" },
        { value: "o2_tank_m", label: "O2 M cylinder" },
        { value: "whole_blood_unit", label: "Whole blood" },
        { value: "y_tubing_blood", label: "Y tubing" },
        { value: "fluid_warmer", label: "Fluid warmer" },
        { value: "cpap_unit", label: "CPAP" }
      ]
    },
    {
      id: "acm-fetch-runner",
      label: "Runner",
      options: [
        { value: "partner", label: "Partner (you stay free)" },
        { value: "player", label: "You (50s)" }
      ]
    }
  ];
  const itemNow = host.state.controls.get("acm-fetch-item") ?? "cat_tourniquet";
  const jobRunning =
    running(sim, "fetch") || sim.fetches.some((f) => f.itemId === itemNow);
  rows.push({
    id: "fetch",
    glyph: "FT",
    name: "Fetch from the truck (50s round trip)",
    duration: "50s",
    badge: jobRunning ? { text: "RUNNING", cls: "running" } : null,
    selects: fetchSel,
    run: () =>
      sim.fetchFromTruck(
        host.state.controls.get("acm-fetch-item") ?? "cat_tourniquet",
        ((host.state.controls.get("acm-fetch-runner") ?? "partner") as Holder)
      )
  });
  for (const box of TRUCK_BOXES) {
    if (host.state.controls.get(`acm-box-${box.id}`) === "hide") continue;
    const staged = sim.stagedBoxes.has(box.id);
    const coming = sim.boxTrips.some((t) => t.boxes.includes(box.id));
    if (staged || coming) {
      rows.push({
        id: `box-${box.id}`,
        glyph: "BX",
        name: box.label,
        badge: staged ? { text: "SET", cls: "set" } : { text: "RUNNING", cls: "running" },
        run: () => ({ ok: false, reason: staged ? "Already staged at the patient." : "Already on the way." })
      });
    } else {
      rows.push({
        id: `box-${box.id}`,
        glyph: "BX",
        name: `Partner: bring the ${box.label} (50s)`,
        duration: "50s",
        run: () => sim.stageBox(box.id)
      });
    }
  }
  return rows;
}

function bleedingRows(host: AcmActionHost): AcmRowDef[] {
  const { sim } = host;
  const tqBadge = (): AcmRowDef["badge"] => {
    if (running(sim, "apply_tq")) return { text: "RUNNING", cls: "running" };
    if (!sim.tq.applied) return null;
    if (!sim.tq.occluded) return { text: "CHECK LOOSE", cls: "warn" };
    return { text: `ON ${fmtClockT(sim.tq.appliedAt_s)}`, cls: "on" };
  };
  return [
    {
      id: "tq",
      glyph: "TQ",
      name: "Apply CAT high and tight (30s)",
      duration: "30s",
      stock: "cat_tourniquet",
      badge: tqBadge(),
      selects: [
        {
          id: "acm-tq-strap",
          label: "Strap pull",
          options: [
            { value: "tight", label: "Pulled tight" },
            { value: "slack", label: "Left slack" }
          ]
        },
        {
          id: "acm-tq-place",
          label: "Placement",
          options: [
            { value: "high_thigh", label: "High thigh, groin crease" },
            { value: "knee", label: "Over the knee" }
          ]
        },
        {
          id: "acm-tq-turns",
          label: "Half-turns",
          options: ["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: `${n} half-turns` }))
        },
        {
          id: "acm-tq-time",
          label: "Write time",
          options: [
            { value: "yes", label: "Write the time" },
            { value: "no", label: "Skip it" }
          ]
        }
      ],
      run: () =>
        sim.applyTQ({
          strapTight: (host.state.controls.get("acm-tq-strap") ?? "tight") === "tight",
          placement: (host.state.controls.get("acm-tq-place") ?? "high_thigh") === "knee" ? "knee" : "high_thigh",
          halfTurns: Number(host.state.controls.get("acm-tq-turns") ?? "3"),
          writeTime: (host.state.controls.get("acm-tq-time") ?? "yes") === "yes"
        })
    },
    {
      id: "tq2",
      glyph: "T2",
      name: "Apply second CAT (30s)",
      duration: "30s",
      stock: "cat_tourniquet",
      badge: running(sim, "apply_tq2")
        ? { text: "RUNNING", cls: "running" }
        : sim.tq.secondApplied
          ? { text: "ON", cls: "on" }
          : null,
      selects: [
        {
          id: "acm-tq2-place",
          label: "Placement",
          options: [
            { value: "proximal", label: "Proximal to first, side by side" },
            { value: "distal", label: "Below the first" },
            { value: "over_wound", label: "Over the wound" },
            { value: "overlapping", label: "Overlapping windlasses" }
          ]
        },
        {
          id: "acm-tq2-loosen",
          label: "First TQ",
          options: [
            { value: "keep", label: "Leave tight" },
            { value: "loosen", label: "Loosen it to place" }
          ]
        }
      ],
      run: () =>
        sim.applySecondTQ({
          placement: ((host.state.controls.get("acm-tq2-place") ?? "proximal") as
            | "proximal"
            | "distal"
            | "over_wound"
            | "overlapping"),
          loosenedFirst: (host.state.controls.get("acm-tq2-loosen") ?? "keep") === "loosen"
        })
    },
    {
      id: "pack",
      glyph: "PK",
      name: "Pack the wound (60s)",
      duration: "60s",
      badge: running(sim, "pack")
        ? { text: "RUNNING", cls: "running" }
        : sim.packing.stage === "none"
          ? null
          : { text: `SET ${sim.packing.stage}`, cls: "set" },
      selects: [
        {
          id: "acm-pack-tech",
          label: "Technique",
          options: [
            { value: "packed", label: "Pack into wound" },
            { value: "on_top", label: "Lay on top" }
          ]
        },
        {
          id: "acm-pack-gauze",
          label: "Gauze",
          options: [
            { value: "hemostatic", label: "Hemostatic" },
            { value: "plain", label: "Plain Kerlix" }
          ]
        }
      ],
      run: () =>
        sim.packWound({
          technique: (host.state.controls.get("acm-pack-tech") ?? "packed") === "on_top" ? "on_top" : "packed",
          gauze: (host.state.controls.get("acm-pack-gauze") ?? "hemostatic") === "plain" ? "plain" : "hemostatic"
        })
    },
    {
      id: "hold",
      glyph: "HD",
      name: "Hold pressure 3 min",
      duration: "180s",
      badge:
        sim.packing.stage === "holding"
          ? { text: `RUNNING ${sim.packing.holder ?? ""}`, cls: "running" }
          : sim.packing.stage === "set"
            ? { text: "CHECK", cls: "check" }
            : null,
      selects: [
        {
          id: "acm-hold-holder",
          label: "Hold by",
          options: [
            { value: "partner", label: "Partner (you stay free)" },
            { value: "player", label: "You (3 min tied up)" },
            { value: "bystander", label: "Bystander" }
          ]
        }
      ],
      run: () => sim.holdPacking(((host.state.controls.get("acm-hold-holder") ?? "partner") as Holder))
    },
    ...(sim.packing.stage === "holding" || sim.packing.stage === "packed_pending_hold"
      ? [
          {
            id: "release",
            glyph: "RE",
            name: "Release pressure early (risky)",
            run: () => sim.releasePackingEarly()
          } as AcmRowDef
        ]
      : []),
    ...(sim.packing.stage === "set" || sim.packing.stage === "holding"
      ? [
          {
            id: "peek",
            glyph: "PK",
            name: "Lift the edge to peek (risky)",
            run: () => sim.peekPacking()
          } as AcmRowDef
        ]
      : []),
    {
      id: "pressure",
      glyph: "DP",
      name: "Start direct pressure (3s)",
      duration: "3s",
      badge: sim.pressure.active ? { text: `ON ${sim.pressure.holder}`, cls: "on" } : null,
      selects: [
        {
          id: "acm-press-qual",
          label: "Quality",
          options: [
            { value: "firm", label: "Firm, bodyweight" },
            { value: "light", label: "Light" },
            { value: "off_source", label: "Off the source" }
          ]
        },
        {
          id: "acm-press-holder",
          label: "Holder",
          options: [
            { value: "player", label: "You" },
            { value: "partner", label: "Partner" },
            { value: "bystander", label: "Bystander" }
          ]
        }
      ],
      run: () =>
        sim.startPressure({
          quality: ((host.state.controls.get("acm-press-qual") ?? "firm") as "firm" | "light" | "off_source"),
          holder: ((host.state.controls.get("acm-press-holder") ?? "player") as Holder)
        })
    },
    ...(sim.pressure.active
      ? [
          {
            id: "pressure-off",
            glyph: "DP",
            name: "Release pressure",
            run: () => sim.releasePressure()
          } as AcmRowDef,
          {
            id: "pressure-swap",
            glyph: "SW",
            name: "Swap holder (reset fatigue)",
            run: () => sim.swapPressureHolder(sim.pressure.holder === "partner" ? "player" : "partner")
          } as AcmRowDef
        ]
      : []),
    {
      id: "dressing",
      glyph: "DR",
      name: "Apply pressure dressing (65s)",
      duration: "65s",
      stock: "pressure_bandage_6in",
      badge: running(sim, "dressing")
        ? { text: "RUNNING", cls: "running" }
        : sim.dressing.applied
          ? { text: `SET ${sim.dressing.tightness}`, cls: "set" }
          : null,
      selects: [
        {
          id: "acm-dress-tight",
          label: "Tightness",
          options: [
            { value: "correct", label: "Correct" },
            { value: "loose", label: "Too loose" },
            { value: "tight", label: "Too tight" }
          ]
        }
      ],
      run: () =>
        sim.applyDressing(
          ((host.state.controls.get("acm-dress-tight") ?? "correct") as "correct" | "loose" | "tight")
        )
    },
    ...(sim.dressing.applied
      ? [{ id: "dress-off", glyph: "DR", name: "Remove dressing", run: () => sim.removeDressing() } as AcmRowDef]
      : []),
    ...(sim.beltTrap
      ? [
          {
            id: "belt",
            glyph: "BT",
            name: "Remove the bystander belt (5s)",
            duration: "5s",
            badge: running(sim, "remove_belt") ? { text: "RUNNING", cls: "running" } : null,
            run: () => sim.removeBelt()
          } as AcmRowDef
        ]
      : []),
    {
      id: "reassess",
      glyph: "RA",
      name: "Reassess hemorrhage control (15s)",
      duration: "15s",
      badge: running(sim, "reassess") ? { text: "RUNNING", cls: "running" } : doneBadge(sim, "Reassess"),
      run: () => sim.reassessBleeding()
    }
  ];
}

function airwayRows(host: AcmActionHost): AcmRowDef[] {
  const { sim } = host;
  const aw = sim.airway;
  const adjunctBadge = (): AcmRowDef["badge"] => {
    if (aw.adjunct === null) return null;
    return { text: `IN ${aw.adjunct.kind} ${aw.adjunct.size}`, cls: "in" };
  };
  return [
    {
      id: "opa",
      glyph: "OP",
      name: "Insert OPA (15s)",
      duration: "15s",
      stock: "opa_set",
      badge: running(sim, "opa") ? { text: "RUNNING", cls: "running" } : adjunctBadge(),
      selects: [
        {
          id: "acm-opa",
          label: "OPA size",
          options: [
            { value: "80", label: "80 mm" },
            { value: "90", label: "90 mm" },
            { value: "100", label: "100 mm" }
          ]
        }
      ],
      run: () => sim.insertOpa(Number(host.state.controls.get("acm-opa") ?? "100"))
    },
    {
      id: "npa",
      glyph: "NP",
      name: "Insert NPA (15s)",
      duration: "15s",
      stock: "npa_set",
      badge: running(sim, "npa") ? { text: "RUNNING", cls: "running" } : adjunctBadge(),
      selects: [
        {
          id: "acm-npa",
          label: "NPA size",
          options: ["26", "28", "30", "32", "34"].map((n) => ({ value: n, label: `${n} Fr` }))
        }
      ],
      run: () => sim.insertNpa(Number(host.state.controls.get("acm-npa") ?? "30"))
    },
    {
      id: "sga",
      glyph: "SG",
      name: "Place supraglottic (25s)",
      duration: "25s",
      badge: running(sim, "sga")
        ? { text: "RUNNING", cls: "running" }
        : aw.adjunct !== null && (aw.adjunct.kind === "igel" || aw.adjunct.kind === "kinglt")
          ? { text: `IN ${aw.adjunct.kind}`, cls: "in" }
          : null,
      selects: [
        {
          id: "acm-sgakind",
          label: "Device",
          options: [
            { value: "igel", label: "i-gel" },
            { value: "kinglt", label: "King LT" }
          ]
        },
        {
          id: "acm-sgasize",
          label: "Size",
          options: [
            { value: "3", label: "#3" },
            { value: "4", label: "#4" },
            { value: "5", label: "#5" }
          ]
        }
      ],
      run: () =>
        sim.placeSupraglottic(
          ((host.state.controls.get("acm-sgakind") ?? "igel") as "igel" | "kinglt"),
          Number(host.state.controls.get("acm-sgasize") ?? "4")
        )
    },
    {
      id: "ett",
      glyph: "ET",
      name: "Intubate (60s)",
      duration: "60s",
      stock: "ett_set",
      badge: running(sim, "ett")
        ? { text: "RUNNING", cls: "running" }
        : aw.ett !== null
          ? { text: `IN ${aw.ett.size_mm}mm`, cls: "in" }
          : null,
      selects: [
        {
          id: "acm-ett-size",
          label: "Tube",
          options: ["6.0", "6.5", "7.0", "7.5", "8.0", "8.5"].map((n) => ({ value: n, label: `${n} mm` }))
        },
        {
          id: "acm-ett-depth",
          label: "Depth",
          options: ["20", "21", "22", "23", "24", "25"].map((n) => ({ value: n, label: `${n} cm` }))
        },
        {
          id: "acm-ett-view",
          label: "Cord view",
          options: [
            { value: "full", label: "Cords visualized" },
            { value: "blind", label: "No view (blind)" }
          ]
        },
        {
          id: "acm-ett-cuff",
          label: "Cuff",
          options: [
            { value: "15", label: "15 cmH2O" },
            { value: "25", label: "25 cmH2O" },
            { value: "40", label: "40 cmH2O" }
          ]
        }
      ],
      run: () =>
        sim.intubate(
          Number(host.state.controls.get("acm-ett-size") ?? "7.5"),
          Number(host.state.controls.get("acm-ett-depth") ?? "22"),
          (host.state.controls.get("acm-ett-view") ?? "full") === "blind",
          Number(host.state.controls.get("acm-ett-cuff") ?? "25")
        )
    },
    {
      id: "secure",
      glyph: "ST",
      name: "Secure the tube (15s)",
      duration: "15s",
      badge: aw.ett?.secured === true ? { text: "SET", cls: "set" } : null,
      run: () => sim.secureTube()
    },
    {
      id: "checktube",
      glyph: "CT",
      name: "Check tube on EtCO2",
      badge: doneBadge(sim, "Check tube") ?? doneBadge(sim, "Tube check"),
      run: () => sim.checkTube()
    },
    {
      id: "airway-off",
      glyph: "RM",
      name: "Remove airway device",
      run: () => sim.removeAirwayDevice()
    },
    {
      id: "suction",
      glyph: "SU",
      name: "Suction now",
      stock: "suction_unit",
      badge: running(sim, "suction") ? { text: "RUNNING", cls: "running" } : null,
      selects: [
        {
          id: "acm-suc-site",
          label: "Site",
          options: [
            { value: "mouth", label: "Mouth (Yankauer)" },
            { value: "ett", label: "ETT (14 Fr)" }
          ]
        },
        {
          id: "acm-suc-secs",
          label: "Seconds",
          options: [
            { value: "10", label: "10 s" },
            { value: "12", label: "12 s" },
            { value: "15", label: "15 s" }
          ]
        }
      ],
      run: () =>
        sim.suctionAirway(
          ((host.state.controls.get("acm-suc-site") ?? "mouth") as "mouth" | "ett"),
          Number(host.state.controls.get("acm-suc-secs") ?? "12")
        )
    }
  ];
}

export function actionRowsFor(
  host: AcmActionHost,
  category: "examine" | "bleeding" | "airway"
): AcmRowDef[] {
  if (category === "examine") return examRows(host);
  if (category === "bleeding") return bleedingRows(host);
  return airwayRows(host);
}

export type { AcmNumberDef };
export function readAcmNumber(host: AcmActionHost, def: AcmNumberDef): number {
  return readNumber(host, def);
}
