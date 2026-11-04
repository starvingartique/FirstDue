// Validates every data file through the shared loaders, cross-checks the
// Dispatch Engine v1 component database, and validates each cached call.
// Exit 0 prints counts, any DataError prints the file and exits 1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { validateFleshedCall } from "../src/dispatch/validate";

const here = path.dirname(fileURLToPath(import.meta.url));

function crossCheck(): string[] {
  const notes: string[] = [];
  const complaints = loadComplaints();
  const mechanisms = loadMechanisms();
  const map = loadConditionsMap();
  const patients = loadPatients();
  const envs = loadEnvironments();
  const oct28 = loadOct28Conditions();
  const draft = loadConditions();

  const complaintIds = new Set(complaints.complaints.map((c) => c.id));
  const subtypeByMech = new Map<string, Set<string>>(
    mechanisms.mechanisms.map((m) => [m.id, new Set(m.subtypes.map((s) => s.id))])
  );
  const links = mechanisms.complaintMechanisms ?? [];
  for (const link of links) {
    if (!complaintIds.has(link.complaintId)) {
      throw new DataError("mechanisms.json", `complaintMechanism names unknown complaint ${link.complaintId}`);
    }
    if (!subtypeByMech.get(link.mechanismId)?.has(link.subtypeId)) {
      throw new DataError(
        "mechanisms.json",
        `complaintMechanism names unknown subtype ${link.mechanismId}/${link.subtypeId}`
      );
    }
  }
  const linked = new Set(links.map((l) => `${l.mechanismId}/${l.subtypeId}`));
  const mapped = new Set(map.mappings.map((m) => `${m.mechanismId}/${m.subtypeId}`));
  for (const key of linked) {
    if (!mapped.has(key)) throw new DataError("conditions_map.json", `no mapping for linked ${key}`);
  }
  const ready = new Set<string>();
  const known = new Set<string>();
  for (const c of oct28.conditions) {
    known.add(c.id);
    if (c.generatorReady) ready.add(c.id);
  }
  for (const c of draft.conditions) {
    known.add(c.id);
    if (c.generatorReady) ready.add(c.id);
  }
  for (const mapping of map.mappings) {
    for (const entry of mapping.conditions) {
      if (!ready.has(entry.conditionId)) {
        throw new DataError(
          "conditions_map.json",
          `${mapping.mechanismId}/${mapping.subtypeId} uses ${entry.conditionId}, which is not generatorReady`
        );
      }
      for (const id of [...(entry.coOccursWith ?? []), ...(entry.excludes ?? [])]) {
        if (!known.has(id)) {
          throw new DataError("conditions_map.json", `rule names unknown condition ${id}`);
        }
      }
    }
  }
  notes.push(`conditions_map covers ${mapped.size} mechanism pairs with generatorReady ids only`);
  const withDist = new Set(patients.distributions.map((d) => d.complaintId));
  for (const id of complaintIds) {
    if (!withDist.has(id)) throw new DataError("patients.json", `no distribution for complaint ${id}`);
  }
  for (const env of envs.environments) {
    for (const id of env.complaintIds ?? []) {
      if (!complaintIds.has(id)) {
        throw new DataError("environments.json", `${env.id} admits unknown complaint ${id}`);
      }
    }
  }
  return notes;
}

function checkCache(): string {
  const dir = path.join(here, "..", "data", "calls", "cache");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  let bad = 0;
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as unknown;
    const v = validateFleshedCall(raw);
    if (!v.ok) {
      bad += 1;
      console.error(`CACHE ERROR in ${file}: ${v.errors.join("; ")}`);
    }
  }
  if (bad > 0) {
    console.error(`${bad} cached call(s) FAILED validation.`);
    process.exit(1);
  }
  return `cache OK (${files.length} call(s)${files.length === 0 ? ", empty until first generation" : ""})`;
}

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
  const complaints = loadComplaints();
  const cmap = loadConditionsMap();
  const patients = loadPatients();
  const comorb = loadComorbidities();
  const envs = loadEnvironments();
  const bystanders = loadBystanders();
  const complications = loadComplications();
  const bikeDown = loadBikeDown();
  const levels = loadDifficulty();

  const pushMeta = drugs._meta as unknown as Record<string, unknown>;
  const pushChecks = Array.isArray(pushMeta["pushChecks"]) ? pushMeta["pushChecks"] : [];
  if (pushChecks.length !== 7 || !pushChecks.every((c) => typeof c === "string" && c.length > 10)) {
    throw new Error(`drugs.json _meta.pushChecks must hold 7 before-every-push checks, found ${pushChecks.length}`);
  }
  if (typeof pushMeta["pushChecksNote"] !== "string" || !(pushMeta["pushChecksNote"] as string).includes("medic sign-off")) {
    throw new Error("drugs.json _meta.pushChecksNote must carry the advisor sign-off note");
  }
  console.log(`drugs.json OK (${drugs.drugs.length} drugs, 7 push checks)`);
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
  console.log(`equipment.json OK (${equipment.equipment.length} items, CAT belt 1 / jump 4 / cabinet 6)`);
  console.log(
    `dispatch v1 OK (${complaints.complaints.length} complaints, ` +
      `${mechanisms.complaintMechanisms?.length ?? 0} complaint links, ` +
      `${cmap.mappings.length} mappings, ${patients.distributions.length} patient dists, ` +
      `${comorb.entries.length} comorbidities, ${envs.environments.length} environments, ` +
      `${bystanders.archetypes.length} bystanders, ${complications.complications.length} complications)`
  );
  for (const note of crossCheck()) console.log(`cross-check OK (${note})`);
  console.log(checkCache());
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
