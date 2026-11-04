// Boot: validate data, build world, then run the Oct 30 phase flow. The sim,
// menu and debug overlay are created on dispatch accept, so the engine clock
// and the event log start there. Before that the 3D scene just renders
// behind the level and dispatch cards. Any boot failure lands in the
// on-screen error box, never a void.

import "./style.css";
import "./flow.css";
import "./acm.css";
import "./title.css";
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
import { MedicalMenu, type Tab } from "./ui/medicalMenu";
import { TitleScreen } from "./ui/title";
import { AcmShell } from "./ui/acm/shell";
import { TRIAGE_LEVELS, type AcmCategory } from "./ui/acm/types";
import { ChatDock } from "./ui/chatDock";
import { SpeedBar } from "./ui/speedBar";
import { MarchStrip } from "./ui/marchStrip";
import { TipsBubble } from "./ui/tipsBubble";
import { SceneLog } from "./ui/sceneLog";
import { DollPanel } from "./ui/dollPanel";
import { QuickActions } from "./ui/quickActions";
import { ProgressBar } from "./ui/progressBar";
import { PartnerBar } from "./ui/partnerBar";
import { HeldItemPanel } from "./ui/heldItem";
import { SettingsPanel } from "./ui/settings";
import { initClickSounds, playAlert, playDone } from "./ui/sound";
import { KIT_LINKS, KitLabels } from "./ui/kitLabels";
import { getWording, setWording, type WordingMode } from "./ui/wording";
import { vitalsPillText } from "./ui/monitorWords";
import { RunFlow, evaluateHandoff, hintFor, type HandoffCheck } from "./ui/flow";
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

/** Legacy menu tabs to ACM categories for kit jumps. */
const TAB_TO_ACM: Record<Tab, AcmCategory> = {
  examine: "examine",
  airway: "airway",
  breathing: "breathing",
  circulation: "bleeding",
  meds: "meds",
  lines: "lines",
  monitor: "monitor"
};

/** ACM categories back to legacy tabs so the tips bubble follows along. */
const ACM_TO_TAB: Record<AcmCategory, Tab> = {
  triage: "examine",
  examine: "examine",
  bleeding: "circulation",
  airway: "airway",
  breathing: "breathing",
  meds: "meds",
  lines: "lines",
  monitor: "monitor"
};

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
  // ACM overlay shell: constructed once the HUD exists, reset per run.
  let shell: AcmShell | null = null;
  // True once the player asked about pain in chat (gates the pain words).
  let painAsked = false;

  // Kit labels and preview. Item taps open existing menu tabs only.
  const kitRoot = scene.getObjectByName("kit");
  if (kitRoot === undefined || kitRoot === null) throw new Error("missing kit group in scene");
  const kitLabels = new KitLabels({
    onSelect: (id) => {
      const link = KIT_LINKS[id];
      if (link !== null) shell?.showCategory(TAB_TO_ACM[link.tab]);
    },
    onOpenAction: (id) => {
      // ACM fit: kit jumps land on the matching category. The legacy
      // section scroll has no overlay equivalent, so it opens the list.
      const link = KIT_LINKS[id];
      if (link !== null) shell?.showCategory(TAB_TO_ACM[link.tab]);
    }
  }, canvas);

  // First-person hands: visible only while a procedure runs, holding that
  // procedure's kit item. Own scene group, never raycast.
  const hands = new ProcedureHands(kitRoot);
  scene.add(hands.group);

  // Left chat dock under the menu: talk while working the menu. Bound to
  // the sim on dispatch accept, hidden before that and on the end screen.
  const dock = new ChatDock({
    onPlayerLine: (text) => {
      if (/\bpain\b|\bhurt|\bache|\bsore\b|\bheadache/i.test(text)) painAsked = true;
    }
  });
  // UI pass panels: speed bar, MARCH strip, L1 tips bubble, scene log.
  const speed = new SpeedBar();
  const march = new MarchStrip();
  const tips = new TipsBubble({ onTip: (tip) => dock.postPartnerTip(tip) });
  const sceneLog = new SceneLog();
  // Nov 3 rail: doll panel, progress bar, held item card, settings.
  // Nov 4 quick panel: declared early so region picks refresh it.
  let quick: QuickActions | null = null;
  const dollPanel = new DollPanel((region: RegionId) => {
    highlight.setSelected(region);
    hud.showRegion(highlight.getSelected());
    dollPanel.setSelected(highlight.getSelected());
    quick?.refresh();
    shell?.showCategory("examine");
  });
  const progress = new ProgressBar(() => {
    if (sim === null) return;
    sim.cancelPending();
    shell?.refresh();
    sceneLog.refresh();
    dock.refresh();
    progress.refresh(sim);
    quick?.refresh();
  });
  const partnerBar = new PartnerBar((key) => {
    if (sim === null) return;
    sim.cancelPartnerJob(key);
    shell?.refresh();
    sceneLog.refresh();
    dock.refresh();
    partnerBar.refresh(sim);
    quick?.refresh();
  });
  const heldItem = new HeldItemPanel();
  const rightRail = document.getElementById("right-rail");
  if (rightRail === null) throw new Error("missing #right-rail in index.html");
  const settingsPanel = new SettingsPanel();
  initClickSounds();
  let callNo = 0;
  let soundSeen = 0;

  const hud = new Hud({
    onSelectRegion: (region: RegionId) => {
      highlight.setSelected(region);
      hud.showRegion(highlight.getSelected());
      dollPanel.setSelected(highlight.getSelected());
      quick?.refresh();
      shell?.refresh();
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
      shell?.reword();
      settingsPanel.reword();
      kitLabels.reword();
      dollPanel.reword();
      quick?.reword();
      progress.refresh(sim);
      partnerBar.refresh(sim);
      if (sim !== null) heldItem.reword(sim.pending, kitLabels.getSelected());
      if (menu !== null && flow.phase === "end") flow.refreshEndReport(menu.reportElement());
    }
  });
  hud.showWording(getWording());
  hud.showCall(call);
  hud.showRegion(null);
  hud.showSpot(spotCamera.getSpot());
  hud.showClock(0);
  hud.showPackage(false);

  // ACM overlay: replaces the left-side menu panel. The legacy
  // MedicalMenu instance stays for the end report only.
  const acmRoot = document.getElementById("acm-root");
  if (acmRoot === null) throw new Error("missing #acm-root in index.html");
  const acmPeek = document.getElementById("acm-peek");
  if (acmPeek === null) throw new Error("missing #acm-peek in index.html");
  shell = new AcmShell(acmRoot, acmPeek, {
    sim: () => sim,
    region: () => highlight.getSelected(),
    setRegion: (region) => {
      highlight.setSelected(region);
      hud.showRegion(highlight.getSelected());
      dollPanel.setSelected(highlight.getSelected());
      quick?.refresh();
    },
    mirrored: () => settingsPanel.current.aceOrientation,
    painAsked: () => painAsked,
    patientLabel: () => {
      const p = acceptedCall?.patient;
      return p === undefined ? "Josh, 28M" : `${p.name}, ${p.age}${p.sex}`;
    },
    onRun: () => {
      sceneLog.refresh();
      dock.refresh();
      if (sim !== null) heldItem.refresh(sim.pending, kitLabels.getSelected());
      quick?.refresh();
    },
    onTriage: (level) => {
      flow.record.triage = TRIAGE_LEVELS.find((t) => t.id === level)?.label ?? level;
    },
    onCategory: (cat) => tips.show(ACM_TO_TAB[cat])
  });
  quick = new QuickActions({
    sim: () => sim,
    region: () => highlight.getSelected(),
    onRun: () => {
      sceneLog.refresh();
      dock.refresh();
      if (sim !== null) heldItem.refresh(sim.pending, kitLabels.getSelected());
      shell?.refresh();
    },
    onOpenMenu: () => shell?.setOpen(true),
    onOpenBag: () => {
      spotCamera.applySpot("kit");
      hud.showSpot("kit");
      kitLabels.setSpot("kit");
    }
  });

  const finishEnd = (win: boolean, checks: HandoffCheck[]): void => {
    if (sim === null || menu === null) return;
    hud.showPackage(false);
    shell?.setOpen(false);
    dock.setVisible(false);
    speed.setVisible(false);
    march.bind(null);
    tips.bind(null);
    sceneLog.bind(null);
    dollPanel.bind(null);
    rightRail.hidden = true;
    progress.refresh(null);
    partnerBar.refresh(null);
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
            onMenu: () => shell?.refresh()
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
      const hit = pickRegion(spotCamera.camera, patient.group, x, y, canvas);
      if (hit === null) {
        // No body region: a staged kit item may have been tapped.
        const kitHit = pickKitItem(spotCamera.camera, kitRoot, x, y, canvas);
        if (kitHit !== null) {
          kitLabels.select(kitHit);
          return;
        }
      }
      // Tapping empty ground clears the selection.
      highlight.setSelected(hit);
      hud.showRegion(highlight.getSelected());
      dollPanel.setSelected(highlight.getSelected());
      quick?.refresh();
      shell?.refresh();
    },
    onSpotKey: (index) => {
      // While the overlay is open, digits pick ACM categories instead.
      if (shell?.isOpen() === true) return;
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

  // Title screen first: the existing level -> dispatch -> care flow is
  // unchanged, it just starts from the title's Continue instead of boot.
  const onLevelPicked = (level: 1 | 2): void => {
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
        callNo += 1;
        hud.showCall(accepted, callNo);
        acceptedCall = accepted;
        s.setLevel(level);
        s.addLog("info", `Level chosen: ${flow.record.levelLabel}.`);
        sim = s;
        soundSeen = s.log.length;
        debug = new DebugOverlay(s);
        dock.bind(s);
        speed.setVisible(true);
        march.bind(s);
        tips.bind(s);
        sceneLog.bind(s);
        dollPanel.bind(s);
        rightRail.hidden = false;
        progress.refresh(s);
        partnerBar.refresh(s);
        heldItem.refresh(s.pending, kitLabels.getSelected());
        quick?.refresh();
        // Legacy menu instance kept for the end report only. Its panel
        // is hidden; the ACM overlay is the working menu from here on.
        menu = new MedicalMenu(s);
        menu.setRunInfo({ level: flow.record.levelLabel, destination: "not chosen", outcome: "run in progress" });
        shell?.resetRun();
        painAsked = false;
        flow.record.triage = "none";
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
            shell?.refresh();
          },
          onTick: () => {
            hud.showClock(s.t_s);
            hud.showVitals(vitalsPillText(s));
            dock.refresh();
            march.refresh();
            sceneLog.refresh();
            dollPanel.refresh();
            quick?.refresh();
            // The ACM center bar covers open-overlay runs; the bottom bar
            // covers closed-overlay runs. Never both at once.
            progress.refresh(shell?.isOpen() === true ? null : s);
            partnerBar.refresh(s);
            heldItem.refresh(s.pending, kitLabels.getSelected());
            dock.setPartnerHint(s.level === 1 && flow.phase !== "end" ? hintFor(s) : null);
            // New log lines since the last tick drive feedback sounds.
            let done = false;
            let alarm = false;
            while (soundSeen < s.log.length) {
              const event = s.log[soundSeen];
              soundSeen += 1;
              if (event === undefined) continue;
              if (event.kind === "trap" || event.kind === "arrest") alarm = true;
              else if (event.text.startsWith("Done: ")) done = true;
            }
            if (alarm) playAlert();
            else if (done) playDone();
            dock.tickUnprompted(flow.phase === "sizeup" || flow.phase === "care");
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
  };
  const titleRoot = document.getElementById("title-screen");
  if (titleRoot === null) throw new Error("missing #title-screen in index.html");
  const titleScreen = new TitleScreen(titleRoot, {
    onStart: () => flow.showLevel(levels, onLevelPicked),
    onSettings: () => settingsPanel.open()
  });
  titleScreen.show();
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
