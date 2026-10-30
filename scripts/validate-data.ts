// Validates every data file through the shared loaders. Exit 0 prints counts,
// any DataError prints the file and the problem and exits 1.

import {
  loadBikeDown,
  loadBystanders,
  loadComplaints,
  loadComorbidities,
  loadComplications,
  loadConditions,
  loadConditionsMap,
  loadDifficulty,
  loadDrugs,
  loadEnvironments,
  loadEquipment,
  loadInterventions,
  loadMarchPaws,
  loadMechanisms,
  loadOct28Conditions,
  loadOct29Airway,
  loadOct29Lines,
  loadOct29Vitals,
  loadPatients,
  loadPhysiology,
  loadTraumaLibrary
} from "../src/data/loaders";
import { DataError } from "../src/data/validate";

try {
  const drugs = loadDrugs();
  const conditions = loadConditions();
  const oct28 = loadOct28Conditions();
  const airway = loadOct29Airway();
  const lines = loadOct29Lines();
  const vitals = loadOct29Vitals();
  const trauma = loadTraumaLibrary();
  const march = loadMarchPaws();
  const mechanisms = loadMechanisms();
  const physiology = loadPhysiology();
  const interventions = loadInterventions();
  const equipment = loadEquipment();
  loadComplaints();
  loadConditionsMap();
  loadPatients();
  loadComorbidities();
  loadEnvironments();
  loadBystanders();
  loadComplications();
  const bikeDown = loadBikeDown();
  const levels = loadDifficulty();

  console.log(`drugs.json OK (${drugs.drugs.length} drugs)`);
  console.log(`conditions.json OK (${conditions.conditions.length} conditions, DRAFT, unused by Bike down)`);
  console.log(`oct28_conditions.json OK (${oct28.conditions.map((c) => c.id).join(", ")})`);
  console.log(`oct29_airway.json OK (${airway.airwayDevices.length} devices, O2 + tank + BVM)`);
  console.log(`oct29_lines.json OK (${lines.ivCatheters.length} catheters, IO + drip sets + explicit fluids)`);
  console.log(`oct29_vitals.json OK (${vitals.procedures.length} manual procedures)`);
  console.log(`trauma_library.json OK (${trauma.injuries.length} injuries)`);
  console.log(`march_paws.json OK (${march.sequence.length} steps)`);
  console.log(`mechanisms.json OK (${mechanisms.mechanisms.length} mechanisms)`);
  const base = physiology.baselines as Record<string, unknown>;
  console.log(
    `physiology.json OK (HR ${String(base["heartRate_bpm"])}, ` +
      `BP ${String(base["sbp_mmhg"])}/${String(base["dbp_mmhg"])}, ` +
      `volume ${String(base["bloodVolume_mL"])} mL, arterial_major 700)`
  );
  console.log(`interventions.json OK (${interventions.interventions.map((i) => i.id).join(", ")})`);
  console.log(`equipment.json OK (${equipment.equipment.length} items, CAT belt 1 / jump 2 / cabinet 4)`);
  console.log("complaints/conditions_map/patients/comorbidities OK (skeleton placeholders)");
  console.log("environments/bystanders/complications OK (skeleton placeholders)");
  console.log(
    `bike_down.json OK (${bikeDown.patient.name}, seed ${bikeDown.seed}, ` +
      `contact loss ${String(bikeDown.sceneStart?.bloodLossAtContact_mL)} mL, ` +
      `belt trap ${bikeDown.sceneStart?.venousTourniquetTrap?.included === true ? "on" : "off"})`
  );
  console.log(`difficulty OK (${levels.length} levels)`);
} catch (error) {
  if (error instanceof DataError) {
    console.error(`DATA ERROR in ${error.file}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}
