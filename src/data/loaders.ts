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
import oct28ConditionsJson from "../../data/medical/oct28_conditions.json";
import oct29AirwayJson from "../../data/medical/oct29_airway.json";
import oct29LinesJson from "../../data/medical/oct29_lines.json";
import oct29VitalsJson from "../../data/medical/oct29_vitals.json";
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
  Oct28ConditionsFile,
  Oct29AirwayFile,
  Oct29LinesFile,
  Oct29VitalsFile,
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
    // Oct 28 anchors: Josh baselines and the femoral bleed must match the
    // medical answers exactly, or the engine curve is wrong.
    const base = root["baselines"] as Record<string, unknown>;
    const expect: Record<string, unknown> = {
      heartRate_bpm: 76,
      respRate_per_min: 14,
      sbp_mmhg: 124,
      dbp_mmhg: 78,
      spo2_pct: 98,
      etco2_mmhg: 38,
      bloodVolume_mL: 5600
    };
    for (const [key, value] of Object.entries(expect)) {
      if (base[key] !== value) {
        throw new DataError("physiology.json", `baselines.${key} must be ${String(value)}`);
      }
    }
    const bleed = root["bleedRates_mL_per_min"] as Record<string, unknown>;
    if (bleed["arterial_major"] !== 700) {
      throw new DataError("physiology.json", '"arterial_major" must be 700');
    }
    if (bleed["junctional"] !== 500) {
      throw new DataError("physiology.json", '"junctional" must be 500');
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

const OCT28_INTERVENTION_IDS = [
  "tourniquet_high_and_tight",
  "second_tourniquet_proximal",
  "hemostatic_packing_3min_pressure",
  "direct_pressure",
  "pressure_dressing"
];

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
    const ids = new Set(list.map((entry) => entry["id"]));
    for (const id of OCT28_INTERVENTION_IDS) {
      if (!ids.has(id)) throw new DataError("interventions.json", `missing Oct 28 intervention "${id}"`);
    }
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
    // Oct 28 kit: every hemorrhage item carries per-stash quantities.
    const cat = list.find((entry) => entry["id"] === "cat_tourniquet");
    if (cat === undefined) throw new DataError("equipment.json", 'missing "cat_tourniquet"');
    const q = cat["quantities"];
    if (!isObject(q) || q["belt"] !== 1 || q["jump_bag"] !== 2 || q["cabinet"] !== 4) {
      throw new DataError("equipment.json", '"cat_tourniquet" quantities must be belt 1, jump 2, cabinet 4');
    }
  });
}

export function loadOct28Conditions(): Oct28ConditionsFile {
  return as<Oct28ConditionsFile>("oct28_conditions.json", oct28ConditionsJson, (root) => {
    checkMeta("oct28_conditions.json", root);
    const list = checkEntries("oct28_conditions.json", "conditions", root, [
      "id",
      "name",
      "effects",
      "findings",
      "minLevel",
      "generatorReady"
    ]);
    checkUniqueIds("oct28_conditions.json", "conditions", list);
  });
}

export function loadOct29Airway(): Oct29AirwayFile {
  return as<Oct29AirwayFile>("oct29_airway.json", oct29AirwayJson, (root) => {
    checkMeta("oct29_airway.json", root);
    const devices = checkEntries("oct29_airway.json", "airwayDevices", root, ["id", "name"]);
    checkUniqueIds("oct29_airway.json", "airwayDevices", devices);
    for (const key of ["bvm", "suction", "oxygenDelivery", "fio2Table", "tank", "engineCoupling_TUNE"]) {
      if (root[key] === undefined) throw new DataError("oct29_airway.json", `missing required key "${key}"`);
    }
    // Josh's correct sizes must match section 7 exactly.
    const byId = new Map(devices.map((d) => [d["id"], d]));
    const opa = byId.get("opa");
    if (opa?.["correctForJosh_mm"] !== 100) {
      throw new DataError("oct29_airway.json", 'opa.correctForJosh_mm must be 100');
    }
    const ett = byId.get("ett");
    const ettSizes = ett?.["correctForJosh_mm"];
    if (!Array.isArray(ettSizes) || ettSizes[0] !== 7.5 || ettSizes[1] !== 8.0) {
      throw new DataError("oct29_airway.json", 'ett.correctForJosh_mm must be [7.5, 8.0]');
    }
  });
}

export function loadOct29Lines(): Oct29LinesFile {
  return as<Oct29LinesFile>("oct29_lines.json", oct29LinesJson, (root) => {
    checkMeta("oct29_lines.json", root);
    checkEntries("oct29_lines.json", "ivCatheters", root, ["gauge", "color", "gravityFlow_mL_per_min"]);
    for (const key of ["pressureBag", "ivStart", "io", "dripSets", "fluids"]) {
      if (!isObject(root[key])) throw new DataError("oct29_lines.json", `"${key}" must be an object`);
    }
    const fluids = root["fluids"] as Record<string, unknown>;
    if (fluids["crystalloid_retained_mL_at_60min"] !== 250) {
      throw new DataError("oct29_lines.json", '"fluids.crystalloid_retained_mL_at_60min" must be 250');
    }
    if (fluids["blood_retained_fraction"] !== 0.9) {
      throw new DataError("oct29_lines.json", '"fluids.blood_retained_fraction" must be 0.9');
    }
  });
}

export function loadOct29Vitals(): Oct29VitalsFile {
  return as<Oct29VitalsFile>("oct29_vitals.json", oct29VitalsJson, (root) => {
    checkMeta("oct29_vitals.json", root);
    const list = checkEntries("oct29_vitals.json", "procedures", root, ["id", "name", "time_engine_s", "error"]);
    checkUniqueIds("oct29_vitals.json", "procedures", list);
    if (list.length !== 13) throw new DataError("oct29_vitals.json", '"procedures" must hold 13 entries');
    if (!isObject(root["shockThresholds"])) {
      throw new DataError("oct29_vitals.json", '"shockThresholds" must be an object');
    }
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
    if (patient["weight_kg"] !== 80) {
      throw new DataError("bike_down.json", 'patient.weight_kg must stay 80 (never shown in UI)');
    }
    // Oct 28 scene-start fix: contact happens mid-bleed at about 20 percent.
    const sceneStart = root["sceneStart"];
    if (!isObject(sceneStart)) throw new DataError("bike_down.json", '"sceneStart" must be an object');
    if (sceneStart["bloodLossAtContact_mL"] !== 1100) {
      throw new DataError("bike_down.json", '"sceneStart.bloodLossAtContact_mL" must be 1100');
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
  loadOct28Conditions();
  loadOct29Airway();
  loadOct29Lines();
  loadOct29Vitals();
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
