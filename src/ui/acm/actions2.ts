// ACM category action lists part 2: breathing, lines/blood rows, monitor.
// Implemented from scratch Nov 3. Same Sim calls as today. Line cards
// and the meds draw-up card live in cards.ts; this file holds the
// remaining rows plus the shared monitor attach/manual rows.

import type { Sim } from "../../sim/engine";
import type { CuffFit } from "../../sim/exams";
import type { AcmRowDef } from "./rows";
import { fmtClockT, lastDoneTime } from "./format";
import type { AcmActionHost } from "./actions";

function running(sim: Sim, id: string): boolean {
  return sim.pending?.id === id;
}

function observedBadge(sim: Sim, key: "hr" | "rr" | "sbp" | "dbp" | "spo2" | "temp" | "glucose" | "pupils" | "skin" | "lungs" | "gcs" | "capRefill"): AcmRowDef["badge"] {
  const o = sim.observed[key];
  return o === undefined ? null : { text: `CHECK ${fmtClockT(o.t_s)}`, cls: "check" };
}

export function breathingRows(host: AcmActionHost): AcmRowDef[] {
  const { sim } = host;
  return [
    {
      id: "o2",
      glyph: "O2",
      name: "Apply O2 (20s)",
      duration: "20s",
      badge: running(sim, "o2")
        ? { text: "RUNNING", cls: "running" }
        : sim.o2.device === "none"
          ? null
          : { text: `ON ${sim.o2.device}`, cls: "on" },
      selects: [
        {
          id: "acm-o2-dev",
          label: "Device",
          options: [
            { value: "nasal_cannula", label: "Nasal cannula" },
            { value: "simple_mask", label: "Simple mask" },
            { value: "non_rebreather", label: "Non-rebreather" },
            { value: "bvm_reservoir", label: "BVM + reservoir" },
            { value: "cpap", label: "CPAP (cabinet)" }
          ]
        },
        {
          id: "acm-o2-flow",
          label: "Flow",
          options: ["1", "2", "4", "6", "10", "15"].map((n) => ({ value: n, label: `${n} L/min` }))
        },
        {
          id: "acm-o2-res",
          label: "NRB reservoir",
          options: [
            { value: "yes", label: "Pre-inflated" },
            { value: "no", label: "Deflated" }
          ]
        },
        {
          id: "acm-o2-peep",
          label: "CPAP",
          options: [
            { value: "5", label: "5 cmH2O" },
            { value: "7.5", label: "7.5 cmH2O" },
            { value: "10", label: "10 cmH2O" }
          ]
        }
      ],
      run: () =>
        sim.applyO2(
          ((host.state.controls.get("acm-o2-dev") ?? "nasal_cannula") as
            | "nasal_cannula"
            | "simple_mask"
            | "non_rebreather"
            | "bvm_reservoir"
            | "cpap"),
          Number(host.state.controls.get("acm-o2-flow") ?? "4"),
          (host.state.controls.get("acm-o2-res") ?? "no") === "yes",
          Number(host.state.controls.get("acm-o2-peep") ?? "5"),
          0.5
        )
    },
    {
      id: "nrb",
      glyph: "NR",
      name: "Pre-inflate NRB reservoir",
      badge: sim.o2.reservoirInflated ? { text: "SET", cls: "set" } : null,
      run: () => sim.preinflateReservoir()
    },
    {
      id: "o2-off",
      glyph: "RM",
      name: "Remove O2 device",
      run: () => sim.removeO2()
    },
    {
      id: "tank",
      glyph: "TK",
      name: "Swap to M cylinder (30s)",
      duration: "30s",
      stock: "o2_tank_m",
      badge: running(sim, "tank_swap") ? { text: "RUNNING", cls: "running" } : null,
      run: () => sim.swapTank()
    },
    {
      id: "bvmmask",
      glyph: "BM",
      name: "Fit mask",
      badge: { text: `SET ${sim.bvm.maskSize}`, cls: "set" },
      selects: [
        {
          id: "acm-bvm-mask",
          label: "Mask",
          options: [
            { value: "small", label: "Small" },
            { value: "medium", label: "Medium" },
            { value: "large", label: "Large" }
          ]
        }
      ],
      run: () =>
        sim.setBvmMask(
          ((host.state.controls.get("acm-bvm-mask") ?? "large") as "small" | "medium" | "large")
        )
    },
    {
      id: "bvm550",
      glyph: "B+",
      name: "Squeeze: third (~550 mL, correct)",
      stock: "bvm_adult",
      run: () => sim.squeezeBvm(550)
    },
    {
      id: "bvm400",
      glyph: "B-",
      name: "Squeeze: gentle (~400 mL, shallow)",
      stock: "bvm_adult",
      run: () => sim.squeezeBvm(400)
    },
    {
      id: "bvm800",
      glyph: "B!",
      name: "Squeeze: half (~800 mL, too big)",
      stock: "bvm_adult",
      run: () => sim.squeezeBvm(800)
    },
    {
      id: "bvm1200",
      glyph: "B!",
      name: "Squeeze: full (~1200 mL, way too big)",
      stock: "bvm_adult",
      run: () => sim.squeezeBvm(1200)
    }
  ];
}

export function lineStartRows(host: AcmActionHost): AcmRowDef[] {
  const { sim } = host;
  return [
    {
      id: "iv",
      glyph: "IV",
      name: "Attempt IV (75s)",
      duration: "75s",
      badge: running(sim, "iv") ? { text: "RUNNING", cls: "running" } : null,
      selects: [
        {
          id: "acm-iv-site",
          label: "Site",
          options: [
            { value: "ac", label: "AC (trauma pick)" },
            { value: "forearm", label: "Forearm" },
            { value: "hand", label: "Hand" }
          ]
        },
        {
          id: "acm-iv-gauge",
          label: "Catheter",
          options: [14, 16, 18, 20, 22, 24].map((g) => ({
            value: String(g),
            label: `${g}g (have ${sim.atPatient(`iv_cath_${g}g`)})`
          }))
        }
      ],
      run: () =>
        sim.startIv(
          ((host.state.controls.get("acm-iv-site") ?? "ac") as "ac" | "forearm" | "hand"),
          Number(host.state.controls.get("acm-iv-gauge") ?? "18")
        )
    },
    {
      id: "io",
      glyph: "IO",
      name: "Place IO (30s)",
      duration: "30s",
      badge: running(sim, "io") || running(sim, "io_sternal") ? { text: "RUNNING", cls: "running" } : null,
      selects: [
        {
          id: "acm-io-site",
          label: "Site",
          options: [
            { value: "tibial", label: "Tibial" },
            { value: "humeral", label: "Humeral" },
            { value: "sternal", label: `Sternal (FAST1, have ${sim.atPatient("io_fast1")})` }
          ]
        },
        {
          id: "acm-io-needle",
          label: "Needle",
          options: ["15", "25", "45"].map((n) => ({
            value: n,
            label: `${n} mm (have ${sim.atPatient(`io_needle_${n}mm`)})`
          }))
        },
        {
          id: "acm-io-lido",
          label: "Lidocaine",
          options: [
            { value: "yes", label: "40 mg IO first" },
            { value: "no", label: "Skip it (pain 10/10)" }
          ]
        }
      ],
      run: () => {
        const site = host.state.controls.get("acm-io-site") ?? "tibial";
        const lido = (host.state.controls.get("acm-io-lido") ?? "yes") === "yes";
        if (site === "sternal") return sim.startSternalIo(lido);
        return sim.startIo(
          site as "tibial" | "humeral",
          Number(host.state.controls.get("acm-io-needle") ?? "25"),
          lido
        );
      }
    }
  ];
}

export function monitorAttachRows(host: AcmActionHost): AcmRowDef[] {
  const { sim } = host;
  return [
    {
      id: "spo2on",
      glyph: "OX",
      name: "Attach SpO2 probe",
      stock: "spo2_probe",
      badge: sim.monitor.spo2Attached ? { text: "ON", cls: "on" } : null,
      run: () => sim.attachSpo2()
    },
    {
      id: "spo2read",
      glyph: "OX",
      name: "Read SpO2 (15s)",
      duration: "15s",
      badge: running(sim, "exam_spo2")
        ? { text: "RUNNING", cls: "running" }
        : lastDoneTime(sim.log, "Read SpO2") === null
          ? observedBadge(sim, "spo2")
          : { text: `CHECK ${fmtClockT(lastDoneTime(sim.log, "Read SpO2") ?? 0)}`, cls: "check" },
      run: () => sim.readSpo2()
    },
    {
      id: "etco2on",
      glyph: "CO",
      name: "Attach waveform EtCO2",
      stock: "waveform_etco2",
      badge: sim.monitor.etco2Attached ? { text: "ON", cls: "on" } : null,
      run: () => sim.attachEtco2()
    },
    {
      id: "pads",
      glyph: "ECG",
      name: "Stick defib pads (monitor only)",
      stock: "monitor_defib",
      badge: sim.defibPadsOn ? { text: "ON", cls: "on" } : null,
      run: () => sim.attachDefibPads()
    },
    {
      id: "nibp",
      glyph: "NI",
      name: "NIBP auto cycle (40s)",
      duration: "40s",
      stock: "monitor_defib",
      badge: running(sim, "nibp")
        ? { text: "RUNNING", cls: "running" }
        : lastDoneTime(sim.log, "NIBP") === null
          ? observedBadge(sim, "sbp")
          : { text: `CHECK ${fmtClockT(lastDoneTime(sim.log, "NIBP") ?? 0)}`, cls: "check" },
      run: () => sim.runNibp()
    }
  ];
}

export function manualRows(host: AcmActionHost): AcmRowDef[] {
  const { sim } = host;
  const arm = (key: "hr" | "lungs" | "sbp" | "capRefill", res: { ok: boolean }): void => {
    if (res.ok) host.onAssess?.(key);
  };
  return [
    {
      id: "pulse",
      glyph: "PU",
      name: "Pulse: radial/carotid (20s, 60s if irregular)",
      duration: "20s",
      badge: running(sim, "exam_pulse") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "hr"),
      run: () => {
        const res = sim.checkPulse();
        arm("hr", res);
        return res;
      }
    },
    {
      id: "rr",
      glyph: "RR",
      name: "RR: watch chest (30s, do not announce)",
      duration: "30s",
      badge: running(sim, "exam_rr") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "rr"),
      run: () => sim.checkRR()
    },
    {
      id: "bpausc",
      glyph: "BP",
      name: "BP auscultated (50s)",
      duration: "50s",
      stock: "bp_cuff_adult",
      badge: running(sim, "exam_bp") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "sbp"),
      selects: [
        {
          id: "acm-bp-cuff",
          label: "Cuff",
          options: [
            { value: "correct", label: "Adult" },
            { value: "small", label: "Peds (too small)" },
            { value: "big", label: "Large (too big)" }
          ]
        },
        {
          id: "acm-bp-deflate",
          label: "Deflate",
          options: [
            { value: "slow", label: "2-3 mmHg/s" },
            { value: "fast", label: "Too fast" }
          ]
        }
      ],
      run: () => {
        const res = sim.checkBpAusc(
          ((host.state.controls.get("acm-bp-cuff") ?? "correct") as CuffFit),
          (host.state.controls.get("acm-bp-deflate") ?? "slow") === "fast"
        );
        arm("sbp", res);
        return res;
      }
    },
    {
      id: "bppalp",
      glyph: "BP",
      name: "BP palpated (30s, SBP only)",
      duration: "30s",
      stock: "bp_cuff_adult",
      badge: running(sim, "exam_bpp") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "sbp"),
      run: () => {
        const res = sim.checkBpPalp();
        arm("sbp", res);
        return res;
      }
    },
    {
      id: "caprefill",
      glyph: "CR",
      name: "Cap refill (8s)",
      duration: "8s",
      badge: running(sim, "exam_cr") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "capRefill"),
      run: () => {
        const res = sim.checkCapRefill();
        arm("capRefill", res);
        return res;
      }
    },
    {
      id: "pupils",
      glyph: "PL",
      name: "Pupils penlight (10s)",
      duration: "10s",
      stock: "penlight",
      badge: running(sim, "exam_pupil") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "pupils"),
      run: () => sim.checkPupils()
    },
    {
      id: "glucose",
      glyph: "GL",
      name: "Glucose fingerstick (12s)",
      duration: "12s",
      stock: "glucometer",
      badge: running(sim, "exam_glu") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "glucose"),
      run: () => sim.checkGlucose()
    },
    {
      id: "temp",
      glyph: "TP",
      name: "Temperature (15s)",
      duration: "15s",
      stock: "thermometer",
      badge: running(sim, "exam_temp") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "temp"),
      selects: [
        {
          id: "acm-temp-method",
          label: "Method",
          options: [
            { value: "tympanic", label: "Tympanic" },
            { value: "oral", label: "Oral" },
            { value: "temporal", label: "Temporal" }
          ]
        }
      ],
      run: () =>
        sim.checkTemp(
          ((host.state.controls.get("acm-temp-method") ?? "tympanic") as "tympanic" | "oral" | "temporal")
        )
    },
    {
      id: "skin",
      glyph: "SK",
      name: "Skin look + touch (5s)",
      duration: "5s",
      badge: running(sim, "exam_skin") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "skin"),
      run: () => sim.checkSkin()
    },
    {
      id: "lungs",
      glyph: "LU",
      name: "Lung sounds 4 sites (25s)",
      duration: "25s",
      stock: "stethoscope",
      badge: running(sim, "exam_lung") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "lungs"),
      run: () => {
        const res = sim.checkLungs();
        arm("lungs", res);
        return res;
      }
    },
    {
      id: "gcs",
      glyph: "GC",
      name: "GCS eyes/verbal/motor (20s)",
      duration: "20s",
      badge: running(sim, "exam_gcs") ? { text: "RUNNING", cls: "running" } : observedBadge(sim, "gcs"),
      run: () => sim.checkGcs()
    }
  ];
}
