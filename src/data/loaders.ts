// Data loaders. Each loader imports one JSON file, runs the matching schema
// checks, and returns the typed data. JSON stays bundled with the client via
// Vite so the skeleton runs with zero fetch wiring. Live generated calls will
// arrive over fetch later; the validators are shared either way.

import drugsJson from "../../data/medical/drugs.json";
import physiologyJson from "../../data/medical/physiology.json";
import conditionsJson from "../../data/medical/conditions.json";
import interventionsJson from "../../data/medical/interventions.json";
import equipmentJson from "../../data/medical/equipment.json";
import traumaJson from "../../data/medical/trauma_library.json";
import marchJson from "../../data/medical/march_paws.json";
import complaintsJson from "../../data/calls/components/complaints.json";
import mechanismsJson from "../../data/calls/components/mechanisms.json";
import conditionsMapJson from "../../data/calls/components/conditions_map.json";
import patientsJson from "../../data/calls/components/patients.json";
import comorbiditiesJson from "../../data/calls/components/comorbidities.json";
import environmentsJson from "../../data/calls/components/environments.json";
import bystandersJson from "../../data/calls/components/bystanders.json";
import complicationsJson from "../../data/calls/components/complications.json";
import bikeDownJson from "../../data/calls/fixed/bike_down.json";
import level1Json from "../../data/difficulty/level1.json";
import level2Json from "../../data/difficulty/level2.json";
import level3Json from "../../data/difficulty/level3.json";
import level4Json from "../../data/difficulty/level4.json";
import level5Json from "../../data/difficulty/level5.json";
import type {
  BystandersFile,
  ComplaintsFile,
  ComorbiditiesFile,
  ComplicationsFile,
  ConditionsFile,
  ConditionsMapFile,
  DifficultyLevel,
  DrugsFile,
  EnvironmentsFile,
  EquipmentFile,
  FixedCall,
  InterventionsFile,
  MarchPawsFile,
  MechanismsFile,
  PatientsFile,
  PhysiologyFile,
  TraumaLibraryFile
} from "./types";
import { checkEntries, checkMeta, checkUniqueIds, DataError, isObject } from "./validate";

function as<T>(file: string, root: unknown, checks: (root: Rec) => void): T {
  if (!isObject(root)) throw new DataError(file, "root must be an object");
  checks(root);
  return root as unknown as T;
}

type Rec = Record<string, unknown>;

export function loadDrugs(): DrugsFile {
  return as<DrugsFile>("drugs.json", drugsJson, (root) => {
    const meta = checkMeta("drugs.json", root);
    if (typeof meta["count"] !== "number") {
      throw new DataError("drugs.json", '_meta.count must be a number');
    }
    const drugs = checkEntries("drugs.json", "drugs", root, [
      "id",
      "name",
      "presentations",
      "dosing",
      "scopeLevel",
      "location"
    ]);
    checkUniqueIds("drugs.json", "drugs", drugs);
    if (drugs.length !== meta["count"]) {
      throw new DataError(
        "drugs.json",
        `count says ${String(meta["count"])} but file holds ${drugs.length}`
      );
    }
  });
}

export function loadPhysiology(): PhysiologyFile {
  return as<PhysiologyFile>("physiology.json", physiologyJson, (root) => {
    checkMeta("physiology.json", root);
    for (const key of ["baselines", "shockClasses", "effectTokens", "bleedRates_mL_per_min"]) {
      if (!isObject(root[key])) throw new DataError("physiology.json", `"${key}" must be an object`);
    }
  });
}

export function loadConditions(): ConditionsFile {
  return as<ConditionsFile>("conditions.json", conditionsJson, (root) => {
    checkMeta("conditions.json", root);
    const list = checkEntries("conditions.json", "conditions", root, [
      "id",
      "name",
      "effects",
      "findings",
      "minLevel",
      "generatorReady"
    ]);
    checkUniqueIds("conditions.json", "conditions", list);
  });
}

export function loadInterventions(): InterventionsFile {
  return as<InterventionsFile>("interventions.json", interventionsJson, (root) => {
    checkMeta("interventions.json", root);
    const list = checkEntries("interventions.json", "interventions", root, [
      "id",
      "name",
      "timeCost_s",
      "minLevel"
    ]);
    checkUniqueIds("interventions.json", "interventions", list);
  });
}

export function loadEquipment(): EquipmentFile {
  return as<EquipmentFile>("equipment.json", equipmentJson, (root) => {
    checkMeta("equipment.json", root);
    const list = checkEntries("equipment.json", "equipment", root, [
      "id",
      "name",
      "category",
      "location",
      "quantity"
    ]);
    checkUniqueIds("equipment.json", "equipment", list);
  });
}

export function loadTraumaLibrary(): TraumaLibraryFile {
  return as<TraumaLibraryFile>("trauma_library.json", traumaJson, (root) => {
    checkMeta("trauma_library.json", root);
    const list = checkEntries("trauma_library.json", "injuries", root, ["id"]);
    checkUniqueIds("trauma_library.json", "injuries", list);
  });
}

export function loadMarchPaws(): MarchPawsFile {
  return as<MarchPawsFile>("march_paws.json", marchJson, (root) => {
    checkMeta("march_paws.json", root);
    checkEntries("march_paws.json", "sequence", root, ["step", "name"]);
    if (typeof root["reassessment"] !== "string") {
      throw new DataError("march_paws.json", '"reassessment" must be a string');
    }
  });
}

export function loadComplaints(): ComplaintsFile {
  return as<ComplaintsFile>("complaints.json", complaintsJson, (root) => {
    checkMeta("complaints.json", root);
    const list = checkEntries("complaints.json", "complaints", root, ["id", "label", "weight"]);
    checkUniqueIds("complaints.json", "complaints", list);
  });
}

export function loadMechanisms(): MechanismsFile {
  return as<MechanismsFile>("mechanisms.json", mechanismsJson, (root) => {
    checkMeta("mechanisms.json", root);
    const list = checkEntries("mechanisms.json", "mechanisms", root, ["id", "subtypes"]);
    checkUniqueIds("mechanisms.json", "mechanisms", list);
  });
}

export function loadConditionsMap(): ConditionsMapFile {
  return as<ConditionsMapFile>("conditions_map.json", conditionsMapJson, (root) => {
    checkMeta("conditions_map.json", root);
    checkEntries("conditions_map.json", "mappings", root, ["mechanismId", "conditions"]);
  });
}

export function loadPatients(): PatientsFile {
  return as<PatientsFile>("patients.json", patientsJson, (root) => {
    checkMeta("patients.json", root);
    checkEntries("patients.json", "distributions", root, ["complaintId", "ageRange", "sexSplit"]);
  });
}

export function loadComorbidities(): ComorbiditiesFile {
  return as<ComorbiditiesFile>("comorbidities.json", comorbiditiesJson, (root) => {
    checkMeta("comorbidities.json", root);
    const list = checkEntries("comorbidities.json", "entries", root, ["id", "label"]);
    checkUniqueIds("comorbidities.json", "entries", list);
  });
}

export function loadEnvironments(): EnvironmentsFile {
  return as<EnvironmentsFile>("environments.json", environmentsJson, (root) => {
    checkMeta("environments.json", root);
    const list = checkEntries("environments.json", "environments", root, ["id", "label"]);
    checkUniqueIds("environments.json", "environments", list);
  });
}

export function loadBystanders(): BystandersFile {
  return as<BystandersFile>("bystanders.json", bystandersJson, (root) => {
    checkMeta("bystanders.json", root);
    const list = checkEntries("bystanders.json", "archetypes", root, ["id", "label", "behavior"]);
    checkUniqueIds("bystanders.json", "archetypes", list);
  });
}

export function loadComplications(): ComplicationsFile {
  return as<ComplicationsFile>("complications.json", complicationsJson, (root) => {
    checkMeta("complications.json", root);
    const list = checkEntries("complications.json", "complications", root, ["id", "label", "trigger"]);
    checkUniqueIds("complications.json", "complications", list);
  });
}

export function loadBikeDown(): FixedCall {
  return as<FixedCall>("bike_down.json", bikeDownJson, (root) => {
    for (const key of ["id", "seed", "patient", "dispatch", "scene", "injuries", "conditions", "marchFocus"]) {
      if (root[key] === undefined) throw new DataError("bike_down.json", `missing required key "${key}"`);
    }
    if (typeof root["seed"] !== "number") {
      throw new DataError("bike_down.json", '"seed" must be a number');
    }
    const patient = root["patient"];
    if (!isObject(patient)) throw new DataError("bike_down.json", '"patient" must be an object');
    for (const key of ["name", "nameLocked", "age", "sex"]) {
      if (patient[key] === undefined) {
        throw new DataError("bike_down.json", `patient is missing "${key}"`);
      }
    }
  });
}

function loadLevel(file: string, root: unknown): DifficultyLevel {
  return as<DifficultyLevel>(file, root, (r) => {
    for (const key of ["level", "role", "vitalsDisplay", "hints", "deterioration", "grading", "notes"]) {
      if (r[key] === undefined) throw new DataError(file, `missing required key "${key}"`);
    }
  });
}

export function loadDifficulty(): DifficultyLevel[] {
  return [
    loadLevel("level1.json", level1Json),
    loadLevel("level2.json", level2Json),
    loadLevel("level3.json", level3Json),
    loadLevel("level4.json", level4Json),
    loadLevel("level5.json", level5Json)
  ];
}

/** Runs every loader. Used at boot and by scripts/validate-data.ts. */
export function loadAll(): void {
  loadDrugs();
  loadPhysiology();
  loadConditions();
  loadInterventions();
  loadEquipment();
  loadTraumaLibrary();
  loadMarchPaws();
  loadComplaints();
  loadMechanisms();
  loadConditionsMap();
  loadPatients();
  loadComorbidities();
  loadEnvironments();
  loadBystanders();
  loadComplications();
  loadBikeDown();
  loadDifficulty();
}
