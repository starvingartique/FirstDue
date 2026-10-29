// Scenario setup: builds a Sim from the loaded data files. Bike down opens
// mid-bleed per the scene-start fix: 1,100 mL gone, a bystander shirt on the
// wound, and the belt trap on the thigh.

import { loadBikeDown, loadEquipment } from "../data/loaders";
import { Sim, type SimConfig } from "./engine";

export function newBikeDownSim(): Sim {
  const call = loadBikeDown();
  const kit = loadEquipment();
  const start = call.sceneStart;

  const config: SimConfig = {
    seed: call.seed,
    startLoss_mL: start?.bloodLossAtContact_mL ?? 1100,
    bystanderShirt: (start?.bystanderPressure?.effectiveness ?? 0.5) > 0,
    beltTrap: start?.venousTourniquetTrap?.included ?? true,
    stressActive: true,
    betaBlocked: false,
    wetClothing: true,
    wrapped: false,
    startTemp_C: 36.8,
    startPain_0_to_10: 8,
    fetch_s: 50
  };
  const sim = new Sim(config);
  for (const item of kit.equipment) {
    const q = item.quantities ?? { belt: 0, jump_bag: 0, cabinet: 0 };
    sim.stock(item.id, q.belt, q.jump_bag, q.cabinet);
  }
  return sim;
}

/** Bare-bones Sim for curve tests: no bystander, no belt, custom start loss. */
export function newTestSim(seed = 1027, startLoss_mL = 0): Sim {
  const sim = new Sim({
    seed,
    startLoss_mL,
    bystanderShirt: false,
    beltTrap: false,
    stressActive: false,
    betaBlocked: false,
    wetClothing: false,
    wrapped: true,
    startTemp_C: 36.8,
    startPain_0_to_10: 0,
    fetch_s: 50
  });
  sim.stock("cat_tourniquet", 1, 2, 4);
  sim.stock("hemostatic_gauze_zfold", 0, 2, 4);
  sim.stock("plain_gauze_roll_kerlix", 0, 4, 10);
  sim.stock("pressure_bandage_6in", 0, 2, 6);
  sim.stock("trauma_shears", 1, 1, 1);
  return sim;
}
