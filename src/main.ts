// Boot: validate data, build world, patient and sim, wire input, HUD, ACM
// menu and live debug. Any data or scene failure lands in the on-screen
// error box, never a void.

import "./style.css";
import { buildWorld } from "./engine/scene";
import { SPOT_IDS, SpotCamera, type SpotId } from "./engine/camera";
import { bindInput } from "./engine/input";
import { pickRegion } from "./engine/raycast";
import { startLoop } from "./engine/loop";
import { buildPatient } from "./patient/body";
import { RegionHighlight } from "./patient/highlight";
import type { RegionId } from "./patient/regions";
import { Hud } from "./ui/hud";
import { DebugOverlay } from "./ui/debug";
import { MedicalMenu, TAB_HOTKEYS } from "./ui/medicalMenu";
import { getTermMode, setTermMode, type TermMode } from "./ui/terms";
import { newBikeDownSim } from "./sim/scenario";
import { loadAll, loadBikeDown } from "./data/loaders";

function showBootError(message: string): void {
  const box = document.getElementById("boot-error");
  if (box === null) return;
  box.hidden = false;
  box.textContent = `Startup failed: ${message}`;
}

function main(): void {
  // Data first: a broken file must fail loudly at boot, not mid-call.
  loadAll();
  const call = loadBikeDown();
  const sim = newBikeDownSim();

  const canvas = document.getElementById("scene");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("missing <canvas id=scene> in index.html");
  }

  const { scene, renderer } = buildWorld(canvas);
  const spotCamera = new SpotCamera();
  const patient = buildPatient();
  scene.add(patient.group);
  const highlight = new RegionHighlight(patient);
  const debug = new DebugOverlay(sim);
  const menu = new MedicalMenu(sim);
  let speed = 1;
  let lastRunSpeed = 1;

  const hud = new Hud({
    onSelectRegion: (region: RegionId) => {
      highlight.setSelected(region);
      hud.showRegion(highlight.getSelected());
      menu.setRegion(highlight.getSelected());
    },
    onSelectSpot: (spot: SpotId) => {
      spotCamera.applySpot(spot);
      hud.showSpot(spot);
    },
    onSpeed: (next: number) => setSpeed(next),
    onTerms: (mode: TermMode) => setTerms(mode),
    onTips: () => {
      menu.toggleTips();
      hud.showTips(menu.tips);
    }
  });
  const setSpeed = (next: number): void => {
    if (next > 0) lastRunSpeed = next;
    speed = next;
    hud.showSpeed(speed);
  };
  const setTerms = (mode: TermMode): void => {
    setTermMode(mode);
    hud.showTerms(mode);
    menu.retranslate();
    debug.refresh();
  };
  hud.showSpeed(speed);
  hud.showTerms(getTermMode());
  hud.showTips(menu.tips);
  hud.showCall(call);
  hud.showRegion(null);
  hud.showSpot(spotCamera.getSpot());
  hud.showClock(0);

  bindInput(canvas, {
    onLook: (dx, dy) => spotCamera.addLook(dx, dy),
    onTap: (x, y) => {
      const hit = pickRegion(spotCamera.camera, patient.group, x, y);
      // Tapping empty ground clears the selection.
      highlight.setSelected(hit);
      hud.showRegion(highlight.getSelected());
      menu.setRegion(highlight.getSelected());
    },
    onSpotKey: (index) => {
      if (index < 0 || index >= SPOT_IDS.length) return;
      const spot: SpotId = SPOT_IDS[index];
      spotCamera.applySpot(spot);
      hud.showSpot(spot);
    },
    onDebugKey: () => debug.toggle(),
    onTalkKey: () => menu.openTalk(),
    onHotkey: (key: string) => {
      if (key === "p") setSpeed(speed === 0 ? lastRunSpeed : 0);
      else if (key === "t") setTerms(getTermMode() === "medical" ? "plain" : "medical");
      else if (key === "h") {
        menu.toggleTips();
        hud.showTips(menu.tips);
      } else if (TAB_HOTKEYS[key] !== undefined) menu.setTab(TAB_HOTKEYS[key]);
    }
  });

  startLoop({
    renderer,
    scene,
    camera: spotCamera.camera,
    patient,
    sim,
    onResize: () => spotCamera.onResize(),
    speed: () => speed,
    onTick: () => {
      hud.showClock(sim.t_s);
      menu.refresh();
    }
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
