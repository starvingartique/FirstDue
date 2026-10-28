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
  loadPatients,
  loadPhysiology,
  loadTraumaLibrary
} from "../src/data/loaders";
import { DataError } from "../src/data/validate";

try {
  const drugs = loadDrugs();
  const conditions = loadConditions();
  const trauma = loadTraumaLibrary();
  const march = loadMarchPaws();
  const mechanisms = loadMechanisms();
  loadPhysiology();
  loadInterventions();
  loadEquipment();
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
  console.log(`conditions.json OK (${conditions.conditions.length} conditions)`);
  console.log(`trauma_library.json OK (${trauma.injuries.length} injuries)`);
  console.log(`march_paws.json OK (${march.sequence.length} steps)`);
  console.log(`mechanisms.json OK (${mechanisms.mechanisms.length} mechanisms)`);
  console.log("physiology.json OK (skeleton placeholders)");
  console.log("interventions.json OK (skeleton placeholders)");
  console.log("equipment.json OK (skeleton placeholders)");
  console.log("complaints/conditions_map/patients/comorbidities OK (skeleton placeholders)");
  console.log("environments/bystanders/complications OK (skeleton placeholders)");
  console.log(`bike_down.json OK (${bikeDown.patient.name}, seed ${bikeDown.seed})`);
  console.log(`difficulty OK (${levels.length} levels)`);
} catch (error) {
  if (error instanceof DataError) {
    console.error(`DATA ERROR in ${error.file}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}
