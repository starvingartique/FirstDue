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
import { MedicalMenu, TAB_HOTKEYS } from "./ui/medicalMenu";
import { KIT_LINKS, KitLabels } from "./ui/kitLabels";
import { getTermMode, setTermMode, type TermMode } from "./ui/terms";
import { RunFlow, evaluateHandoff, type HandoffCheck } from "./ui/flow";
import type { Sim } from "./sim/engine";
import { newBikeDownSim } from "./sim/scenario";
import { loadAll, loadBikeDown, loadDifficulty } from "./data/loaders";

function showBootError(message: string): void {
  const box = document.getElementById("boot-error");
  if (box === null) return;
  box.hidden = false;
  box.textContent = `Startup failed: ${message}`;
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
  let speed = 1;
  let lastRunSpeed = 1;

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
    onSpeed: (next: number) => setSpeed(next),
    onTerms: (mode: TermMode) => setTerms(mode),
    onTips: () => {
      menu?.toggleTips();
      hud.showTips(menu?.tips ?? true);
    },
    onPackage: () => openPackage()
  });
  const setSpeed = (next: number): void => {
    if (next > 0) lastRunSpeed = next;
    speed = next;
    hud.showSpeed(speed);
  };
  const setTerms = (mode: TermMode): void => {
    setTermMode(mode);
    hud.showTerms(mode);
    menu?.retranslate();
    debug?.refresh();
    flow.retranslate();
    kitLabels.retranslate();
  };
  hud.showSpeed(speed);
  hud.showTerms(getTermMode());
  hud.showTips(true);
  hud.showCall(call);
  hud.showRegion(null);
  hud.showSpot(spotCamera.getSpot());
  hud.showClock(0);
  hud.showPackage(false);

  const finishEnd = (win: boolean, checks: HandoffCheck[]): void => {
    if (sim === null || menu === null) return;
    hud.showPackage(false);
    menu.setRunInfo({
      level: flow.record.levelLabel,
      destination: flow.record.destinationLabel,
      outcome: win ? "Win" : "Lose"
    });
    flow.showEnd({ sim, win, checks, report: menu.reportElement() });
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
    onTalkKey: () => menu?.openTalk(),
    onHotkey: (key: string) => {
      if (key === "p") setSpeed(speed === 0 ? lastRunSpeed : 0);
      else if (key === "t") setTerms(getTermMode() === "medical" ? "plain" : "medical");
      else if (key === "h") {
        menu?.toggleTips();
        hud.showTips(menu?.tips ?? true);
      } else if (key === "g") openPackage();
      else if (TAB_HOTKEYS[key] !== undefined) menu?.setTab(TAB_HOTKEYS[key]);
    }
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
    flow.showDispatch(call, () => {
      const s = newBikeDownSim();
      s.setLevel(level);
      s.addLog("info", `Level chosen: ${flow.record.levelLabel}.`);
      sim = s;
      debug = new DebugOverlay(s);
      menu = new MedicalMenu(s);
      menu.setRunInfo({ level: flow.record.levelLabel, destination: "not chosen", outcome: "run in progress" });
      spotCamera.applySpot("patient");
      hud.showSpot("patient");
      hud.showClock(0);
      const m = menu;
      startLoop({
        renderer,
        scene,
        camera: spotCamera.camera,
        patient,
        sim: s,
        onResize: () => spotCamera.onResize(),
        speed: () => (flow.tickingSuspended ? 0 : speed),
        onFrame: () => {
          kitLabels.update(spotCamera.camera);
          hands.update(spotCamera.camera, s.pending);
        },
        onTick: () => {
          hud.showClock(s.t_s);
          m.refresh();
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
      });
    });
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
