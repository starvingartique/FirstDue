// Validator, code not LLM. Checks the skeleton (valid IDs, level pools,
// generatorReady conditions, rules closure) and the assembled fleshed call
// (skeleton echo, history consistency, no clinical numbers). Also assembles
// the fleshed call from skeleton plus LLM narrative, so IDs and echoes stay
// deterministic in code rather than trusting the model.

import {
  loadBystanders,
  loadComplaints,
  loadComorbidities,
  loadComplications,
  loadConditionsMap,
  loadEnvironments,
  loadMechanisms,
  loadPatients
} from "../data/loaders";
import { isObject } from "../data/validate";
import { generatorReadyIds } from "./sampler";
import type { CallSkeleton, FleshedCall } from "./types";

export type { CallSkeleton, FleshedCall, HistoryCard, LlmFlesh } from "./types";
import type { LlmFlesh } from "./types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function fail(errors: string[]): ValidationResult {
  return { ok: false, errors };
}

// - clinical numbers: vitals, doses and scores never come from the LLM -

interface NumberPattern {
  name: string;
  re: RegExp;
}

const NUMBER_PATTERNS: NumberPattern[] = [
  { name: "blood pressure fraction", re: /\b\d{2,3}\s*\/\s*\d{1,3}\b/ },
  { name: "vitals unit", re: /\b\d+(?:\.\d+)?\s?(?:bpm|mmhg|mm hg|mg\/dl|mmol\/l|meq\/l)\b/i },
  {
    name: "vitals word with number",
    re: /\b(?:heart rate|pulse|blood pressure|\bhr\b|\bbp\b|spo2|etco2|respiratory rate|\brr\b|oxygen saturation|o2 sat|gcs|glasgow|blood sugar|glucose|temperature|\btemp\b|capillary refill|cap refill|shock index)\b[^.\n!?]{0,25}\d/i
  },
  {
    name: "dose or count",
    re: /\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|units?|tablets?|pills?|puffs?|sprays?)\b/i
  },
  { name: "oxygen flow", re: /\b\d+(?:\.\d+)?\s?(?:l\/min|lpm|liters? per minute)\b/i },
  { name: "pain score", re: /\b\d+\s*\/\s*10\b/ },
  { name: "gcs components", re: /\be\d\s*v\d\s*m\d\b/i }
];

/**
 * Returns one hit per matched pattern. Ages (28-year-old), addresses
 * (Route 9 mile marker 14) and plain durations pass; anything vitals-like,
 * any dose and any score fails.
 */
export function findClinicalNumbers(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of NUMBER_PATTERNS) {
    const match = pattern.re.exec(text);
    if (match !== null) hits.push(`${pattern.name}: "${match[0].slice(0, 40)}"`);
  }
  return hits;
}

/** Dash check without writing one in this file (char codes). */
function hasDash(text: string): boolean {
  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  return text.includes(em) || text.includes(en);
}

// - skeleton -

export function validateSkeleton(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return fail(["skeleton must be an object"]);
  const s = value as Record<string, unknown>;
  if (s["version"] !== "dispatch-v1") errors.push("version must be dispatch-v1");
  if (typeof s["seed"] !== "number") errors.push("seed must be a number");
  if (s["level"] !== 1 && s["level"] !== 2) errors.push("level must be 1 or 2");
  const level = s["level"] === 1 ? 1 : 2;

  const complaint = loadComplaints().complaints.find((c) => c.id === s["complaintId"]);
  if (complaint === undefined) {
    errors.push(`unknown complaintId ${String(s["complaintId"])}`);
  } else if ((complaint.minLevel ?? 1) > level) {
    errors.push(`complaint ${complaint.id} needs level ${String(complaint.minLevel)}`);
  }

  const links = loadMechanisms().complaintMechanisms ?? [];
  const link = links.find(
    (l) =>
      l.complaintId === s["complaintId"] &&
      l.mechanismId === s["mechanismId"] &&
      l.subtypeId === s["subtypeId"]
  );
  if (link === undefined) {
    errors.push(
      `no complaintMechanism for ${String(s["complaintId"])}/${String(s["mechanismId"])}/${String(s["subtypeId"])}`
    );
  }

  const mapping = loadConditionsMap().mappings.find(
    (m) => m.mechanismId === s["mechanismId"] && m.subtypeId === s["subtypeId"]
  );
  if (mapping === undefined) {
    errors.push(`no conditions mapping for ${String(s["mechanismId"])}/${String(s["subtypeId"])}`);
  }
  const ready = generatorReadyIds();
  const ids = s["conditionIds"];
  if (!Array.isArray(ids)) {
    errors.push("conditionIds must be an array");
  } else {
    const listed = new Set((mapping?.conditions ?? []).map((e) => e.conditionId));
    const rules = new Map((mapping?.conditions ?? []).map((e) => [e.conditionId, e]));
    for (const id of ids) {
      if (typeof id !== "string") {
        errors.push("conditionIds must hold strings");
        continue;
      }
      if (!ready.has(id)) errors.push(`condition ${id} is not generatorReady`);
      if (!listed.has(id)) errors.push(`condition ${id} is not in the ${String(s["subtypeId"])} mapping`);
    }
    const drawn = new Set(ids.filter((id): id is string => typeof id === "string"));
    for (const id of drawn) {
      const rule = rules.get(id);
      if (rule === undefined) continue;
      for (const partner of rule.coOccursWith ?? []) {
        if (!drawn.has(partner)) errors.push(`condition ${id} requires co-occurring ${partner}`);
      }
      for (const drop of rule.excludes ?? []) {
        if (drawn.has(drop)) errors.push(`condition ${id} excludes ${drop}`);
      }
    }
  }

  const dist = loadPatients().distributions.find((d) => d.complaintId === s["complaintId"]);
  const patient = s["patient"];
  if (!isObject(patient) || dist === undefined) {
    errors.push("patient must be an object with a complaint distribution");
  } else {
    const range = dist.ageRange;
    const age = (patient as Record<string, unknown>)["age"];
    const sex = (patient as Record<string, unknown>)["sex"];
    const kilos = (patient as Record<string, unknown>)["weight_kg"];
    const kilosRange = dist.weight_kg as { min?: unknown; max?: unknown } | undefined;
    if (
      !Array.isArray(range) ||
      typeof age !== "number" ||
      age < (range[0] as number) ||
      age > (range[1] as number)
    ) {
      errors.push("patient age is outside the complaint range");
    }
    if (sex !== "M" && sex !== "F") errors.push("patient sex must be M or F");
    if (
      typeof kilos !== "number" ||
      typeof kilosRange?.min !== "number" ||
      typeof kilosRange?.max !== "number" ||
      kilos < kilosRange.min ||
      kilos > kilosRange.max
    ) {
      errors.push("patient weight is outside the complaint range");
    }
  }

  const comorbs = loadComorbidities().entries;
  const cids = s["comorbidityIds"];
  const meds = s["homeMeds"];
  if (!Array.isArray(cids) || !Array.isArray(meds)) {
    errors.push("comorbidityIds and homeMeds must be arrays");
  } else {
    if (new Set(cids).size !== cids.length) errors.push("comorbidityIds must be unique");
    for (const id of cids) {
      const entry = comorbs.find((e) => e.id === id);
      if (entry === undefined) errors.push(`unknown comorbidityId ${String(id)}`);
      else if ((entry.minLevel ?? 2) > level) errors.push(`comorbidity ${String(id)} needs level 2`);
    }
    if (meds.length !== cids.length) {
      errors.push("homeMeds must hold one med per comorbidity");
    }
    const known = new Set(
      cids.flatMap((id) => comorbs.find((e) => e.id === id)?.homeMeds ?? [])
    );
    const lower = new Set([...known].map((m) => m.toLowerCase()));
    for (const med of meds) {
      if (typeof med !== "string" || !lower.has(med.toLowerCase())) {
        errors.push(`homeMed ${String(med)} is not in a drawn comorbidity`);
      }
    }
  }

  const env = loadEnvironments().environments.find((e) => e.id === s["environmentId"]);
  if (env === undefined) {
    errors.push(`unknown environmentId ${String(s["environmentId"])}`);
  } else {
    if (!(env.complaintIds ?? []).includes(String(s["complaintId"]))) {
      errors.push(`environment ${env.id} does not admit complaint ${String(s["complaintId"])}`);
    }
    if (!(env.timesOfDay ?? []).includes(String(s["timeOfDay"]))) {
      errors.push(`timeOfDay ${String(s["timeOfDay"])} is not in ${env.id}`);
    }
    if (!(env.weather ?? []).includes(String(s["weather"]))) {
      errors.push(`weather ${String(s["weather"])} is not in ${env.id}`);
    }
  }

  const bystanderId = s["bystanderId"];
  if (bystanderId !== null) {
    const arch = loadBystanders().archetypes.find((a) => a.id === bystanderId);
    if (arch === undefined) errors.push(`unknown bystanderId ${String(bystanderId)}`);
    else if ((arch.minLevel ?? 1) > level) errors.push(`bystander ${arch.id} needs level 2`);
  }

  const complication = s["complication"];
  if (complication !== null) {
    if (level === 1) errors.push("L1 skeletons carry no complication");
    else if (!isObject(complication)) errors.push("complication must be an object or null");
    else {
      const c = complication as Record<string, unknown>;
      const entry = loadComplications().complications.find((e) => e.id === c["id"]);
      if (entry === undefined) errors.push(`unknown complication ${String(c["id"])}`);
      else {
        if (entry.v1Ready !== true) errors.push(`complication ${entry.id} is not v1Ready`);
        if ((entry.minLevel ?? 2) > 2) errors.push(`complication ${entry.id} needs a higher level`);
        const need = entry.requiresCondition;
        const drawn = new Set(
          (Array.isArray(ids) ? ids : []).filter((id): id is string => typeof id === "string")
        );
        if (typeof need === "string" && !drawn.has(need)) {
          errors.push(`complication ${entry.id} requires condition ${need}`);
        }
        const window = entry.onset_s;
        const onset = c["onset_s"];
        if (
          !Array.isArray(window) ||
          typeof onset !== "number" ||
          onset < (window[0] as number) ||
          onset > (window[1] as number)
        ) {
          errors.push(`complication ${entry.id} onset is outside its window`);
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : fail(errors);
}

// - assembly: skeleton plus narrative into the Oct 30 FixedCall shape -

function reqStr(flesh: string, obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v === "") throw new Error(`${flesh}.${key} must be a non-empty string`);
  return v;
}

function reqStrArray(flesh: string, obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) throw new Error(`${flesh}.${key} must be an array`);
  return v.map((entry) => {
    if (typeof entry !== "string") throw new Error(`${flesh}.${key} must hold strings`);
    return entry;
  });
}

/** Parses raw model text into LlmFlesh. Throws on any shape problem. */
export function parseFlesh(raw: string): LlmFlesh {
  const stripped = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("flesh has no JSON object");
  const root = JSON.parse(stripped.slice(start, end + 1)) as unknown;
  if (!isObject(root)) throw new Error("flesh root must be an object");
  for (const key of ["dispatch", "scene", "patient", "persona", "historyCard", "bystander", "expectedPathway"]) {
    if (root[key] === undefined) throw new Error(`flesh is missing ${key}`);
  }
  const dispatch = root["dispatch"];
  const scene = root["scene"];
  const patient = root["patient"];
  const card = root["historyCard"];
  const bystander = root["bystander"];
  if (!isObject(dispatch) || !isObject(scene) || !isObject(patient) || !isObject(card) || !isObject(bystander)) {
    throw new Error("flesh sections must be objects");
  }
  const sample = card["SAMPLE"];
  const opqrst = card["OPQRST"];
  const secrets = card["secrets"];
  if (!isObject(sample) || !isObject(opqrst) || !Array.isArray(secrets)) {
    throw new Error("historyCard must hold SAMPLE, OPQRST and secrets");
  }
  for (const key of ["signs_symptoms", "allergies", "medications", "past_history", "last_meal", "events"]) {
    reqStr("SAMPLE", sample as Record<string, unknown>, key);
  }
  for (const key of ["onset", "provokes", "quality", "radiates", "severity_words", "time"]) {
    reqStr("OPQRST", opqrst as Record<string, unknown>, key);
  }
  if (secrets.length === 0) throw new Error("historyCard.secrets must hold at least one secret");
  for (const secret of secrets) {
    if (!isObject(secret)) throw new Error("historyCard.secrets must hold objects");
    reqStr("secret", secret as Record<string, unknown>, "fact");
    reqStr("secret", secret as Record<string, unknown>, "revealWhen");
  }
  return {
    dispatch: {
      nature: reqStr("dispatch", dispatch as Record<string, unknown>, "nature"),
      address: reqStr("dispatch", dispatch as Record<string, unknown>, "address"),
      cadText: reqStr("dispatch", dispatch as Record<string, unknown>, "cadText"),
      updates: reqStrArray("dispatch", dispatch as Record<string, unknown>, "updates")
    },
    scene: { description: reqStr("scene", scene as Record<string, unknown>, "description") },
    patient: { name: reqStr("patient", patient as Record<string, unknown>, "name") },
    persona: reqStr("flesh", root, "persona"),
    historyCard: {
      SAMPLE: {
        signs_symptoms: sample["signs_symptoms"] as string,
        allergies: sample["allergies"] as string,
        medications: sample["medications"] as string,
        past_history: sample["past_history"] as string,
        last_meal: sample["last_meal"] as string,
        events: sample["events"] as string
      },
      OPQRST: {
        onset: opqrst["onset"] as string,
        provokes: opqrst["provokes"] as string,
        quality: opqrst["quality"] as string,
        radiates: opqrst["radiates"] as string,
        severity_words: opqrst["severity_words"] as string,
        time: opqrst["time"] as string
      },
      secrets: (secrets as Array<Record<string, unknown>>).map((secret) => ({
        fact: secret["fact"] as string,
        revealWhen: secret["revealWhen"] as string
      }))
    },
    bystander: {
      label: reqStr("bystander", bystander as Record<string, unknown>, "label"),
      lines: reqStrArray("bystander", bystander as Record<string, unknown>, "lines")
    },
    expectedPathway: reqStr("flesh", root, "expectedPathway")
  };
}

export function assembleCall(skeleton: CallSkeleton, flesh: LlmFlesh): FleshedCall {
  const env = loadEnvironments().environments.find((e) => e.id === skeleton.environmentId);
  if (env === undefined) throw new Error(`unknown environment ${skeleton.environmentId}`);
  const arch =
    skeleton.bystanderId === null
      ? undefined
      : loadBystanders().archetypes.find((a) => a.id === skeleton.bystanderId);
  if (skeleton.bystanderId !== null && arch === undefined) {
    throw new Error(`unknown bystander ${skeleton.bystanderId}`);
  }
  const left = skeleton.seed % 2 === 0;
  const injuries: FleshedCall["injuries"] = [];
  if (skeleton.conditionIds.includes("femoral_arterial_bleed")) {
    injuries.push({
      injuryId: "femoral_arterial_bleed",
      side: left ? "left" : "right",
      region: left ? "leg_left" : "leg_right",
      notes: "Partial arterial laceration, modeled bleed. Side alternates by seed parity."
    });
  }
  if (skeleton.conditionIds.includes("road_rash")) {
    injuries.push({
      injuryId: "road_rash",
      side: "right",
      region: "arm_right",
      notes: "Deep abrasion, capillary ooze."
    });
  }
  const marchFocus = ["R", "C", "H"];
  if (skeleton.conditionIds.includes("femoral_arterial_bleed")) marchFocus.unshift("M");
  if (skeleton.conditionIds.includes("crash_stress_offset")) marchFocus.push("P");
  return {
    id: `gen_${skeleton.seed}_L${skeleton.level}`,
    seed: skeleton.seed,
    patient: {
      name: flesh.patient.name,
      nameLocked: false,
      age: skeleton.patient.age,
      sex: skeleton.patient.sex,
      weight_kg: skeleton.patient.weight_kg,
      weightNote:
        "V1: weight is narrative-only; the engine runs 80 kg adult physiology for every patient.",
      complaint: skeleton.complaintId
    },
    dispatch: {
      nature: flesh.dispatch.nature,
      address: flesh.dispatch.address,
      cadText: flesh.dispatch.cadText,
      updates: flesh.dispatch.updates
    },
    scene: {
      location: env.location ?? env.id,
      timeOfDay: skeleton.timeOfDay,
      weather: skeleton.weather,
      mechanism: skeleton.mechanismId,
      mechanismSubtype: skeleton.subtypeId,
      hazards: env.hazards ?? [],
      description: flesh.scene.description
    },
    backstory: flesh.persona,
    injuries,
    conditions: [...skeleton.conditionIds],
    conditionsNote: "Dispatch Engine v1: generatorReady conditions only; see skeleton.",
    marchFocus,
    bystander:
      arch === undefined
        ? undefined
        : { archetypeId: arch.id, label: flesh.bystander.label, notes: arch.behavior },
    levels: [skeleton.level],
    skeleton,
    persona: flesh.persona,
    historyCard: flesh.historyCard,
    bystanderLines: arch === undefined ? [] : flesh.bystander.lines,
    expectedPathway: flesh.expectedPathway,
    complication: skeleton.complication
  };
}

// - fleshed call -

const CONDITION_KEYWORDS: Record<string, string[]> = {
  femoral_arterial_bleed: ["leg", "thigh", "femoral", "bleed", "blood", "tourniquet"],
  crash_stress_offset: ["pain", "hurt", "ache", "scared", "afraid", "fear", "anxious", "nervous"],
  road_rash: ["rash", "scrape", "abrasion", "gravel", "pavement", "road"],
  hypothermia_trauma: ["cold", "shiver", "chill", "wet", "hypotherm"]
};

const COMPLAINT_KEYWORDS: Record<string, RegExp> = {
  fall: /fall|fell|found down|tripped|slipped/i,
  mvc: /crash|collision|motorcycle|vehicle|car|bike|bicycle|struck|pedestrian|rollover|guardrail/i,
  assault: /assault|attack|fight|punched|beaten|altercation/i,
  stabbing: /stab|knife|laceration/i,
  gunshot: /shot|gunshot|gun\b|firearm|bullet/i,
  chest_pain: /chest|heart|cardiac/i,
  overdose: /overdose|unresponsive|needle|syringe|pills|drugs|heroin|opioid|fentanyl|unconscious|not waking/i,
  allergic_reaction: /allerg|sting|swell|hives|throat|anaphy/i
};

function nonEmpty(errors: string[], where: string, value: unknown, max: number): string {
  if (typeof value !== "string" || value === "") {
    errors.push(`${where} must be a non-empty string`);
    return "";
  }
  if (value.length > max) errors.push(`${where} is over ${max} chars`);
  return value;
}

export function validateFleshedCall(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return fail(["call must be an object"]);
  const call = value as Record<string, unknown>;
  const skel = validateSkeleton(call["skeleton"]);
  if (!skel.ok) {
    for (const e of skel.errors) errors.push(`skeleton: ${e}`);
    return fail(errors);
  }
  const s = call["skeleton"] as CallSkeleton;
  if (typeof call["id"] !== "string" || call["id"] === "") errors.push("call id must be non-empty");
  if (call["seed"] !== s.seed) errors.push("call seed must echo the skeleton seed");

  const patient = call["patient"];
  if (!isObject(patient)) {
    errors.push("patient must be an object");
  } else {
    const p = patient as Record<string, unknown>;
    nonEmpty(errors, "patient.name", p["name"], 80);
    if (p["age"] !== s.patient.age) errors.push("patient age must echo the skeleton");
    if (p["sex"] !== s.patient.sex) errors.push("patient sex must echo the skeleton");
    if (p["weight_kg"] !== s.patient.weight_kg) errors.push("patient weight must echo the skeleton");
  }

  const dispatch = call["dispatch"];
  if (!isObject(dispatch)) {
    errors.push("dispatch must be an object");
  } else {
    const d = dispatch as Record<string, unknown>;
    const nature = nonEmpty(errors, "dispatch.nature", d["nature"], 120);
    const address = nonEmpty(errors, "dispatch.address", d["address"], 160);
    const cadText = nonEmpty(errors, "dispatch.cadText", d["cadText"], 600);
    if (!Array.isArray(d["updates"])) errors.push("dispatch.updates must be an array");
    const want = COMPLAINT_KEYWORDS[s.complaintId];
    if (want !== undefined && !want.test(`${nature} ${cadText}`)) {
      errors.push(`CAD text never mentions the ${s.complaintId} complaint`);
    }
    void address;
  }

  const scene = call["scene"];
  if (!isObject(scene)) {
    errors.push("scene must be an object");
  } else {
    const sc = scene as Record<string, unknown>;
    nonEmpty(errors, "scene.description", sc["description"], 600);
    if (sc["timeOfDay"] !== s.timeOfDay) errors.push("scene timeOfDay must echo the skeleton");
    if (sc["weather"] !== s.weather) errors.push("scene weather must echo the skeleton");
    if (sc["mechanism"] !== s.mechanismId) errors.push("scene mechanism must echo the skeleton");
    if (sc["mechanismSubtype"] !== s.subtypeId) errors.push("scene subtype must echo the skeleton");
  }

  const injuries = call["injuries"];
  if (!Array.isArray(injuries)) {
    errors.push("injuries must be an array");
  } else {
    const hasFemoral = (injuries as Array<{ injuryId?: unknown }>).some(
      (i) => typeof i === "object" && i !== null && i.injuryId === "femoral_arterial_bleed"
    );
    const wantFemoral = s.conditionIds.includes("femoral_arterial_bleed");
    if (wantFemoral && !hasFemoral) errors.push("femoral bleed needs a matching injury entry");
    if (!wantFemoral && hasFemoral) errors.push("femoral injury without the femoral condition");
  }

  const conditions = call["conditions"];
  if (!Array.isArray(conditions)) {
    errors.push("conditions must be an array");
  } else {
    const a = new Set(conditions.filter((c): c is string => typeof c === "string"));
    const b = new Set(s.conditionIds);
    if (a.size !== b.size || [...a].some((id) => !b.has(id))) {
      errors.push("call conditions must match the skeleton");
    }
  }

  if (!Array.isArray(call["marchFocus"]) || (call["marchFocus"] as unknown[]).length === 0) {
    errors.push("marchFocus must be a non-empty array");
  }
  if (!Array.isArray(call["levels"]) || !(call["levels"] as unknown[]).includes(s.level)) {
    errors.push("call levels must include the skeleton level");
  }

  const bystander = call["bystander"];
  if (s.bystanderId === null) {
    if (bystander !== undefined) errors.push("call bystander must be absent when the skeleton has none");
    if (Array.isArray(call["bystanderLines"]) && (call["bystanderLines"] as unknown[]).length > 0) {
      errors.push("bystanderLines must be empty when the skeleton has no bystander");
    }
  } else {
    if (!isObject(bystander)) {
      errors.push("call bystander must be an object");
    } else if ((bystander as Record<string, unknown>)["archetypeId"] !== s.bystanderId) {
      errors.push("bystander archetype must echo the skeleton");
    }
    const lines = call["bystanderLines"];
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 6) {
      errors.push("bystanderLines must hold 1 to 6 lines");
    }
  }

  const persona = nonEmpty(errors, "persona", call["persona"], 800);
  const pathway = nonEmpty(errors, "expectedPathway", call["expectedPathway"], 800);

  const card = call["historyCard"];
  let meds = "";
  let story = "";
  if (!isObject(card)) {
    errors.push("historyCard must be an object");
  } else {
    const c = card as Record<string, unknown>;
    const sample = c["SAMPLE"];
    const opqrst = c["OPQRST"];
    const secrets = c["secrets"];
    if (!isObject(sample) || !isObject(opqrst) || !Array.isArray(secrets) || secrets.length === 0) {
      errors.push("historyCard must hold SAMPLE, OPQRST and non-empty secrets");
    } else {
      const sm = sample as Record<string, unknown>;
      meds = nonEmpty(errors, "SAMPLE.medications", sm["medications"], 400);
      story = [
        nonEmpty(errors, "SAMPLE.signs_symptoms", sm["signs_symptoms"], 400),
        nonEmpty(errors, "SAMPLE.allergies", sm["allergies"], 400),
        nonEmpty(errors, "SAMPLE.past_history", sm["past_history"], 400),
        nonEmpty(errors, "SAMPLE.last_meal", sm["last_meal"], 400),
        nonEmpty(errors, "SAMPLE.events", sm["events"], 400)
      ].join(" ");
      const oq = opqrst as Record<string, unknown>;
      story += ` ${nonEmpty(errors, "OPQRST.onset", oq["onset"], 400)}`;
      story += ` ${nonEmpty(errors, "OPQRST.provokes", oq["provokes"], 400)}`;
      story += ` ${nonEmpty(errors, "OPQRST.quality", oq["quality"], 400)}`;
      story += ` ${nonEmpty(errors, "OPQRST.radiates", oq["radiates"], 400)}`;
      story += ` ${nonEmpty(errors, "OPQRST.severity_words", oq["severity_words"], 400)}`;
      story += ` ${nonEmpty(errors, "OPQRST.time", oq["time"], 400)}`;
      for (const secret of secrets as unknown[]) {
        if (!isObject(secret)) {
          errors.push("historyCard.secrets must hold objects");
          break;
        }
        const sc2 = secret as Record<string, unknown>;
        nonEmpty(errors, "secret.fact", sc2["fact"], 400);
        nonEmpty(errors, "secret.revealWhen", sc2["revealWhen"], 200);
      }
    }
  }

  // History consistency: meds echoed, conditions storied, no bleed story
  // when no bleed was drawn.
  const medsLower = meds.toLowerCase();
  for (const med of s.homeMeds) {
    if (!medsLower.includes(med.toLowerCase())) {
      errors.push(`history never mentions home med ${med}`);
    }
  }
  const dispatchText = isObject(dispatch)
    ? String((dispatch as Record<string, unknown>)["cadText"] ?? "")
    : "";
  const storyLower = `${dispatchText} ${persona} ${story}`.toLowerCase();
  for (const id of s.conditionIds) {
    const keywords = CONDITION_KEYWORDS[id];
    if (keywords === undefined) {
      errors.push(`no keyword rule for condition ${id}`);
      continue;
    }
    if (!keywords.some((k) => storyLower.includes(k))) {
      errors.push(`history never stories the ${id} condition`);
    }
  }
  if (!s.conditionIds.includes("femoral_arterial_bleed")) {
    if (/arterial|spurting|tourniquet|femoral/i.test(storyLower)) {
      errors.push("bleed story present without the femoral condition");
    }
  }

  // No clinical numbers and no dashes in any LLM-composed field.
  const llmFields: Array<[string, unknown]> = [
    ["dispatch.nature", isObject(dispatch) ? (dispatch as Record<string, unknown>)["nature"] : ""],
    ["dispatch.address", isObject(dispatch) ? (dispatch as Record<string, unknown>)["address"] : ""],
    ["dispatch.cadText", dispatchText],
    ["scene.description", isObject(scene) ? (scene as Record<string, unknown>)["description"] : ""],
    ["persona", persona],
    ["history", story],
    ["medications", meds],
    ["expectedPathway", pathway]
  ];
  if (Array.isArray(call["bystanderLines"])) {
    (call["bystanderLines"] as unknown[]).forEach((line, i) => {
      llmFields.push([`bystanderLines[${i}]`, line]);
    });
  }
  if (isObject(dispatch) && Array.isArray((dispatch as Record<string, unknown>)["updates"])) {
    ((dispatch as Record<string, unknown>)["updates"] as unknown[]).forEach((line, i) => {
      llmFields.push([`updates[${i}]`, line]);
    });
  }
  for (const [where, text] of llmFields) {
    if (typeof text !== "string") continue;
    for (const hit of findClinicalNumbers(text)) errors.push(`${where} has a clinical number (${hit})`);
    if (hasDash(text)) errors.push(`${where} contains an em or en dash`);
  }

  // Ages in prose must match the skeleton.
  for (const text of [dispatchText, persona]) {
    const match = /(\d+)-year-old/.exec(text);
    if (match !== null && Number(match[1]) !== s.patient.age) {
      errors.push(`prose age ${match[1]} does not match skeleton age ${s.patient.age}`);
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : fail(errors);
}
