// Generated-call instantiation: the physiology engine builds the true state
// from conditions plus patient plus meds. Only modeled effects are read;
// everything narrative-only stays in the history card and the CAD text.
// The fixed Bike down seed never passes through here and stays untouched.

import { loadBystanders, loadEquipment } from "../data/loaders";
import { Sim } from "../sim/engine";
import type { FleshedCall } from "./types";

/**
 * Scene-start blood loss for a generated femoral bleed. V1 reuses the Bike
 * down scene-start model (mid-bleed contact at about 20 percent) rather than
 * inventing a second one.
 */
const SCENE_START_LOSS_ML = 1100;

export function newGeneratedSim(call: FleshedCall): Sim {
  const conditions = new Set(call.conditions);
  const femoral = conditions.has("femoral_arterial_bleed");
  const arch =
    call.skeleton.bystanderId === null
      ? undefined
      : loadBystanders().archetypes.find((a) => a.id === call.skeleton.bystanderId);
  const holdsPressure =
    femoral && (arch?.helpsWith ?? []).includes("holding_pressure");
  const hazards = (call.scene.hazards ?? []).join(" ").toLowerCase();
  const sim = new Sim({
    seed: call.seed,
    startLoss_mL: femoral ? SCENE_START_LOSS_ML : 0,
    bystanderShirt: holdsPressure,
    beltTrap: false,
    stressActive: conditions.has("crash_stress_offset"),
    betaBlocked: call.skeleton.comorbidityIds.includes("beta_blocker_use"),
    wetClothing: conditions.has("hypothermia_trauma"),
    wrapped: false,
    startTemp_C: 36.8,
    startPain_0_to_10: conditions.has("crash_stress_offset") ? 8 : 0,
    fetch_s: 50,
    darkScene: call.scene.timeOfDay === "night",
    roadside: hazards.includes("traffic"),
    femoralBleed: femoral,
    roadRash: conditions.has("road_rash"),
    scheduled:
      call.skeleton.complication === null
        ? []
        : [{ at_s: call.skeleton.complication.onset_s, id: call.skeleton.complication.id }]
  });
  const kit = loadEquipment();
  for (const item of kit.equipment) {
    const q = item.quantities ?? { belt: 0, jump_bag: 0, cabinet: 0 };
    sim.stock(item.id, q.belt, q.jump_bag, q.cabinet);
  }
  sim.addLog(
    "info",
    `Generated call ${call.id}: ${call.conditions.join(", ") || "no engine conditions"}.`
  );
  return sim;
}
