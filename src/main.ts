// Boot: validate data, build world, then run the Oct 30 phase flow. The sim,
// menu and debug overlay are created on dispatch accept, so the engine clock
// and the event log start there. Before that the 3D scene just renders
// behind the level and dispatch cards. Any boot failure lands in the
// on-screen error box, never a void.

import "./style.css";
import "./flow.css";
import { buildWorld } from "./engine/scene";
import { SPOT_IDS, SpotCamera, type SpotId } from "./engine/camera";
import { bindInput } from "./engine/input";
import { pickKitItem, pickRegion } from "./engine/raycast";
import { ProcedureHands } from "./engine/hands";
import { startLoop } from "./engine/loop";
import { buildPatient } from "./patient/body";
import { RegionHighlight } from "./patient/highlight";
import type { RegionId } from "./patient/regions";
import { Hud } from "./ui/hud";
import { DebugOverlay } from "./ui/debug";
import { MedicalMenu } from "./ui/medicalMenu";
import { ChatDock } from "./ui/chatDock";
import { SpeedBar } from "./ui/speedBar";
import { MarchStrip } from "./ui/marchStrip";
import { TipsBubble } from "./ui/tipsBubble";
import { SceneLog } from "./ui/sceneLog";
import { KIT_LINKS, KitLabels } from "./ui/kitLabels";
import { getWording, setWording, type WordingMode } from "./ui/wording";
import { RunFlow, evaluateHandoff, type HandoffCheck } from "./ui/flow";
import { BIKE_DOWN_PATHWAY } from "./ui/debrief";
import type { Sim } from "./sim/engine";
import { newBikeDownSim } from "./sim/scenario";
import { newGeneratedSim } from "./dispatch/instantiate";
import { pickBundled } from "./dispatch/cache";
import type { FleshedCall } from "./dispatch/types";
import type { FixedCall } from "./data/types";
import { loadAll, loadBikeDown, loadDifficulty } from "./data/loaders";

function showBootError(message: string): void {
  const box = document.getElementById("boot-error");
  if (box === null) return;
  box.hidden = false;
  box.textContent = `Startup failed: ${message}`;
}

/**
 * Persistent vitals pill text. Shows while the pulse ox probe or defib pads
 * are on: pleth HR plus the lagged monitor SpO2, engine numbers only. Null
 * hides the pill. No new vital is invented here.
 */
function vitalsPillText(s: Sim): string | null {
  if (!s.monitor.spo2Attached && !s.defibPadsOn) return null;
  const spo2 = s.monitorSpo2();
  const spo2Text =
    spo2 === null ? "--" : "none" in spo2 ? "no pleth" : `${spo2.value}`;
  return `HR ${s.vitals.hr_bpm} - SpO2 ${spo2Text}`;
}

function arrestReason(phase: string): string {
  if (phase === "sizeup") return "PEA arrest during scene size-up.";
  if (phase === "package") return "PEA arrest while packaging for transport.";
  if (phase === "radio") return "PEA arrest during the radio report.";
  return "PEA arrest on scene.";
}

function main(): void {
  // Data first: a broken file must fail loudly at boot, not mid-call.
  loadAll();
  const call = loadBikeDown();
  const levels = loadDifficulty();

  const canvas = document.getElementById("scene");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("missing <canvas id=scene> in index.html");
  }

  const { scene, renderer } = buildWorld(canvas);
  const spotCamera = new SpotCamera();
  const patient = buildPatient();
  scene.add(patient.group);
  const highlight = new RegionHighlight(patient);
  const flow = new RunFlow();

  // Late-bound on dispatch accept: no clock, no log before that.
  let sim: Sim | null = null;
  let menu: MedicalMenu | null = null;
  let debug: DebugOverlay | null = null;
  let acceptedCall: FixedCall | null = null;

  // Kit labels and preview. Item taps open existing menu tabs only.
  const kitRoot = scene.getObjectByName("kit");
  if (kitRoot === undefined || kitRoot === null) throw new Error("missing kit group in scene");
  const kitLabels = new KitLabels({
    onSelect: (id) => {
      const link = KIT_LINKS[id];
      if (link !== null) menu?.setTab(link.tab);
    },
    onOpenAction: (id) => {
      const link = KIT_LINKS[id];
      if (link !== null) menu?.openKitAction(link.tab, link.section);
    }
  });

  // First-person hands: visible only while a procedure runs, holding that
  // procedure's kit item. Own scene group, never raycast.
  const hands = new ProcedureHands(kitRoot);
  scene.add(hands.group);

  // Left chat dock under the menu: talk while working the menu. Bound to
  // the sim on dispatch accept, hidden before that and on the end screen.
  const dock = new ChatDock();
  // UI pass panels: speed bar, MARCH strip, L1 tips bubble, scene log.
  const speed = new SpeedBar();
  const march = new MarchStrip();
  const tips = new TipsBubble();
  const sceneLog = new SceneLog();

  const hud = new Hud({
    onSelectRegion: (region: RegionId) => {
      highlight.setSelected(region);
      hud.showRegion(highlight.getSelected());
      menu?.setRegion(highlight.getSelected());
    },
    onSelectSpot: (spot: SpotId) => {
      spotCamera.applySpot(spot);
      hud.showSpot(spot);
      kitLabels.setSpot(spot);
    },
    onPackage: () => openPackage(),
    onWording: (mode: WordingMode) => {
      setWording(mode);
      hud.showWording(mode);
      hud.reword();
      menu?.reword();
      kitLabels.reword();
      tips.reword();
      if (menu !== null && flow.phase === "end") flow.refreshEndReport(menu.reportElement());
    }
  });
  hud.showWording(getWording());
  hud.showCall(call);
  hud.showRegion(null);
  hud.showSpot(spotCamera.getSpot());
  hud.showClock(0);
  hud.showPackage(false);

  const finishEnd = (win: boolean, checks: HandoffCheck[]): void => {
    if (sim === null || menu === null) return;
    hud.showPackage(false);
    dock.setVisible(false);
    speed.setVisible(false);
    march.bind(null);
    tips.bind(null);
    sceneLog.bind(null);
    menu.setRunInfo({
      level: flow.record.levelLabel,
      destination: flow.record.destinationLabel,
      outcome: win ? "Win" : "Lose"
    });
    const fleshed = acceptedCall as FleshedCall | null;
    const pathway =
      fleshed !== null && typeof fleshed.expectedPathway === "string" && fleshed.expectedPathway !== ""
        ? fleshed.expectedPathway
        : BIKE_DOWN_PATHWAY;
    flow.showEnd({ sim, win, checks, report: menu.reportElement(), pathway });
  };
  const endRunLost = (reason: string): void => {
    if (flow.phase === "end" || sim === null) return;
    flow.record.outcomeReason = reason;
    finishEnd(false, evaluateHandoff(sim).checks);
  };
  const endRunAtHandoff = (): void => {
    if (flow.phase === "end" || sim === null) return;
    const { win, checks } = evaluateHandoff(sim);
    if (!win) {
      const failed = checks
        .filter((c) => !c.pass)
        .map((c) => c.label)
        .join("; ");
      flow.record.outcomeReason = `Transport criteria not met at handoff: ${failed}.`;
    }
    finishEnd(win, checks);
  };

  const openPackage = (): void => {
    if (flow.phase !== "care" || sim === null || menu === null) return;
    const s = sim;
    const m = menu;
    hud.showPackage(false);
    flow.showPackage(
      s,
      () => {
        m.setRunInfo({
          level: flow.record.levelLabel,
          destination: flow.record.destinationLabel,
          outcome: "run in progress"
        });
        flow.runTransport(
          s,
          {
            onClock: () => hud.showClock(s.t_s),
            onMenu: () => m.refresh()
          },
          (arrested) => {
            if (arrested) {
              endRunLost("PEA arrest during the transport skip.");
              return;
            }
            flow.showRadio(s, endRunAtHandoff);
          }
        );
      },
      () => {
        flow.hideOverlay();
        hud.showPackage(true);
      }
    );
  };

  bindInput(canvas, {
    onLook: (dx, dy) => spotCamera.addLook(dx, dy),
    onTap: (x, y) => {
      const hit = pickRegion(spotCamera.camera, patient.group, x, y);
      if (hit === null) {
        // No body region: a staged kit item may have been tapped.
        const kitHit = pickKitItem(spotCamera.camera, kitRoot, x, y);
        if (kitHit !== null) {
          kitLabels.select(kitHit);
          return;
        }
      }
      // Tapping empty ground clears the selection.
      highlight.setSelected(hit);
      hud.showRegion(highlight.getSelected());
      menu?.setRegion(highlight.getSelected());
    },
    onSpotKey: (index) => {
      if (index < 0 || index >= SPOT_IDS.length) return;
      const spot: SpotId = SPOT_IDS[index];
      spotCamera.applySpot(spot);
      hud.showSpot(spot);
      kitLabels.setSpot(spot);
    },
    onDebugKey: () => debug?.toggle(),
    onTalkKey: () => dock.focus(),
    onPackageKey: () => openPackage()
  });

  // Prerun render: scene behind the level and dispatch cards. Replaced by
  // the real loop (with the sim tick) on dispatch accept.
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    spotCamera.onResize();
  });
  renderer.setAnimationLoop(() => {
    kitLabels.update(spotCamera.camera);
    hands.update(spotCamera.camera, sim?.pending ?? null);
    renderer.render(scene, spotCamera.camera);
  });

  flow.showLevel(levels, (level) => {
    const picked = levels.find((l) => l.level === level);
    flow.record.level = level;
    flow.record.levelLabel = `L${level} ${picked?.role ?? ""}`.trim();
    const hooks = {
      onAccept: (accepted: FixedCall) => {
        let s: Sim;
        try {
          s =
            accepted.id === "bike_down"
              ? newBikeDownSim()
              : newGeneratedSim(accepted as FleshedCall);
        } catch {
          flow.showDispatch(call, level, hooks, "That generated call was malformed. Bike down is loaded instead - accept it or generate again.");
          return;
        }
        hud.showCall(accepted);
        acceptedCall = accepted;
        s.setLevel(level);
        s.addLog("info", `Level chosen: ${flow.record.levelLabel}.`);
        sim = s;
        debug = new DebugOverlay(s);
        dock.bind(s);
        speed.setVisible(true);
        march.bind(s);
        tips.bind(s);
        sceneLog.bind(s);
        menu = new MedicalMenu(s, {
          onTab: (tab) => tips.show(tab),
          onSelectRegion: (region) => {
            highlight.setSelected(region);
            hud.showRegion(highlight.getSelected());
            menu?.setRegion(highlight.getSelected());
          }
        });
        menu.setRunInfo({ level: flow.record.levelLabel, destination: "not chosen", outcome: "run in progress" });
        spotCamera.applySpot("patient");
        hud.showSpot("patient");
        kitLabels.setSpot("patient");
        hud.showClock(0);
        const m = menu;
        startLoop({
          renderer,
          scene,
          camera: spotCamera.camera,
          patient,
          sim: s,
          onResize: () => spotCamera.onResize(),
          paused: () => flow.tickingSuspended || speed.isPaused(),
          rate: () => speed.getRate(),
          onFrame: () => {
            kitLabels.update(spotCamera.camera);
            hands.update(spotCamera.camera, s.pending);
            dock.setVisible(flow.phase !== "end");
          },
          onTick: () => {
            hud.showClock(s.t_s);
            hud.showVitals(vitalsPillText(s));
            m.refresh();
            dock.refresh();
            march.refresh();
            sceneLog.refresh();
            dock.tickUnprompted(flow.phase === "sizeup" || flow.phase === "care");
            flow.updateHint(s);
            if (
              s.arrested &&
              (flow.phase === "sizeup" || flow.phase === "care" || flow.phase === "package" || flow.phase === "radio")
            ) {
              endRunLost(arrestReason(flow.phase));
            }
          }
        });
        flow.tickingSuspended = false;
        flow.showSizeup(s, () => {
          flow.hideOverlay();
          hud.showPackage(true);
          tips.show(m.currentTab);
        });
      },
      onGenerate: async (seedText: string) => {
        const trimmed = seedText.trim();
        const wantSeed = /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
        try {
          const response = await fetch("/api/generate-call", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(wantSeed === null ? { level } : { seed: wantSeed, level })
          });
          const data = (await response.json()) as {
            call?: FixedCall;
            fallbackNote?: unknown;
            fallback?: unknown;
            error?: unknown;
          };
          if (!response.ok || data.call === undefined) throw new Error(String(data.error ?? "bad response"));
          return {
            call: data.call,
            note: typeof data.fallbackNote === "string" ? data.fallbackNote : null
          };
        } catch {
          // Server unreachable or generation exhausted: bundled cached call,
          // never a stuck Dispatch screen.
          const fallbackSeed = wantSeed ?? Math.floor(Date.now() % 1000000);
          const bundled = pickBundled(fallbackSeed, level);
          return {
            call: bundled,
            note: `Server unreachable; served bundled cached call ${bundled.id}.`
          };
        }
      }
    };
    flow.showDispatch(call, level, hooks);
  });
}

window.addEventListener("error", (event) => {
  showBootError(event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  showBootError(event.reason instanceof Error ? event.reason.message : String(event.reason));
});

try {
  main();
} catch (error) {
  showBootError(error instanceof Error ? error.message : String(error));
}
