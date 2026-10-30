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
    fetch_s: 50,
    darkScene: true,
    roadside: true
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
    fetch_s: 50,
    darkScene: false,
    roadside: false
  });
  sim.stock("cat_tourniquet", 1, 2, 4);
  sim.stock("hemostatic_gauze_zfold", 0, 2, 4);
  sim.stock("plain_gauze_roll_kerlix", 0, 4, 10);
  sim.stock("pressure_bandage_6in", 0, 2, 6);
  sim.stock("trauma_shears", 1, 1, 1);
  // Oct 29 test stocks: enough of everything for the headless checks.
  sim.stock("hypothermia_wrap_blanket", 0, 1, 2);
  sim.stock("opa_set", 0, 1, 1);
  sim.stock("npa_set", 0, 1, 1);
  sim.stock("igel_set", 0, 2, 1);
  sim.stock("kinglt_set", 0, 2, 1);
  sim.stock("ett_set", 0, 3, 1);
  sim.stock("bvm_adult", 0, 1, 1);
  sim.stock("suction_unit", 0, 1, 0);
  sim.stock("suction_catheter_14fr", 0, 2, 2);
  sim.stock("waveform_etco2", 0, 1, 0);
  sim.stock("nasal_cannula", 0, 2, 4);
  sim.stock("simple_mask", 0, 1, 2);
  sim.stock("non_rebreather", 0, 2, 2);
  sim.stock("o2_tank_d", 0, 1, 0);
  sim.stock("o2_tank_m", 0, 0, 1);
  for (const gauge of [14, 16, 18, 20, 22, 24]) sim.stock(`iv_cath_${gauge}g`, 0, 3, 4);
  sim.stock("io_drill_ezio", 0, 1, 0);
  sim.stock("io_needle_15mm", 0, 1, 2);
  sim.stock("io_needle_25mm", 0, 2, 2);
  sim.stock("io_needle_45mm", 0, 2, 2);
  sim.stock("macro_drip_set", 0, 2, 4);
  sim.stock("micro_drip_set", 0, 1, 3);
  sim.stock("pressure_bag_300", 0, 1, 1);
  sim.stock("fluid_warmer", 0, 0, 1);
  sim.stock("blood_tubing_filter", 0, 0, 2);
  sim.stock("ns_1000ml", 0, 3, 4);
  sim.stock("lr_1000ml", 0, 2, 2);
  sim.stock("whole_blood_unit", 0, 0, 2);
  sim.stock("syringe_3ml", 0, 3, 2);
  sim.stock("syringe_10ml", 0, 3, 2);
  sim.stock("syringe_20ml", 0, 3, 2);
  sim.stock("stethoscope", 0, 1, 0);
  sim.stock("bp_cuff_adult", 0, 1, 0);
  sim.stock("bp_cuff_large", 0, 1, 0);
  sim.stock("bp_cuff_peds", 0, 1, 0);
  sim.stock("penlight", 1, 0, 0);
  sim.stock("glucometer", 0, 1, 0);
  sim.stock("thermometer", 0, 1, 0);
  sim.stock("monitor_defib", 0, 1, 0);
  return sim;
}
