// Seeded sampler, code not LLM. Weighted draw in fixed order: complaint,
// mechanism, conditions (co-occurrence and exclusion rules applied), patient,
// comorbidities and meds, environment, bystanders, 0 to 1 complication.
// Deterministic: same seed and level always give the same skeleton.

import {
  loadBystanders,
  loadComplaints,
  loadComorbidities,
  loadComplications,
  loadConditions,
  loadConditionsMap,
  loadEnvironments,
  loadMechanisms,
  loadOct28Conditions,
  loadPatients
} from "../data/loaders";
import { Rng } from "../sim/rng";
import type { CallSkeleton } from "./types";

/** Every condition the generator may use: fully modeled and flagged true. */
export function generatorReadyIds(): Set<string> {
  const ready = new Set<string>();
  for (const c of loadOct28Conditions().conditions) {
    if (c.generatorReady) ready.add(c.id);
  }
  for (const c of loadConditions().conditions) {
    if (c.generatorReady) ready.add(c.id);
  }
  return ready;
}

/** Shared daily-call seed convention: YYYYMMDD as a number. */
export function dailySeed(today = new Date()): number {
  return today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
}

function pickWeighted<T>(rng: Rng, items: T[], weight: (item: T) => number): T {
  const last = items[items.length - 1];
  if (last === undefined) throw new Error("pickWeighted needs a non-empty pool");
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return last;
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll < 0) return item;
  }
  return last;
}

function pickUniform<T>(rng: Rng, items: T[]): T {
  const item = items[Math.floor(rng.next() * items.length)];
  if (item === undefined) throw new Error("pickUniform needs a non-empty pool");
  return item;
}

export interface ConditionRules {
  coOccursWith: string[];
  excludes: string[];
}

/**
 * Applies co-occurrence and exclusion rules in candidate order. Kept ids pull
 * in their co-occurring partners; excluded ids are dropped even if already
 * kept. Deterministic for a given order.
 */
export function applyConditionRules(
  candidates: string[],
  rules: Map<string, ConditionRules>
): string[] {
  const kept: string[] = [];
  const excluded = new Set<string>();
  const queue = [...candidates];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (excluded.has(id) || kept.includes(id)) continue;
    kept.push(id);
    const rule = rules.get(id);
    if (rule === undefined) continue;
    for (const drop of rule.excludes) excluded.add(drop);
    for (const partner of rule.coOccursWith) {
      if (!kept.includes(partner) && !queue.includes(partner)) queue.push(partner);
    }
  }
  return kept.filter((id) => !excluded.has(id));
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function sampleSkeleton(seed: number, level: 1 | 2): CallSkeleton {
  const rng = new Rng(seed >>> 0);

  // 1. Complaint within the level pool.
  const complaints = loadComplaints().complaints.filter((c) => (c.minLevel ?? 1) <= level);
  const complaint = pickWeighted(rng, complaints, (c) => asNumber(c.weight));

  // 2. Mechanism and subtype for that complaint.
  const links = (loadMechanisms().complaintMechanisms ?? []).filter(
    (l) => l.complaintId === complaint.id
  );
  if (links.length === 0) throw new Error(`no complaintMechanisms for complaint ${complaint.id}`);
  const link = pickWeighted(rng, links, (l) => l.weight);

  // 3. Conditions: probability draw, then co-occurrence and exclusion rules.
  // Only generatorReady ids can land in a skeleton, whatever the map holds.
  const mapping = loadConditionsMap().mappings.find(
    (m) => m.mechanismId === link.mechanismId && m.subtypeId === link.subtypeId
  );
  if (mapping === undefined) {
    throw new Error(`no conditions mapping for ${link.mechanismId}/${link.subtypeId}`);
  }
  const ready = generatorReadyIds();
  const rules = new Map<string, ConditionRules>();
  const candidates: string[] = [];
  for (const entry of mapping.conditions) {
    rules.set(entry.conditionId, {
      coOccursWith: entry.coOccursWith ?? [],
      excludes: entry.excludes ?? []
    });
    const p = typeof entry.probability === "number" ? entry.probability : 0;
    if (ready.has(entry.conditionId) && rng.next() < p) candidates.push(entry.conditionId);
  }
  const conditionIds = applyConditionRules(candidates, rules).filter((id) => ready.has(id));

  // 4. Patient: age, sex, weight from the complaint distribution.
  const dist = loadPatients().distributions.find((d) => d.complaintId === complaint.id);
  if (dist === undefined) throw new Error(`no patient distribution for complaint ${complaint.id}`);
  const range = dist.ageRange;
  if (!Array.isArray(range)) throw new Error(`ageRange for ${complaint.id} must be [min, max]`);
  const split = dist.sexSplit as { M?: unknown; F?: unknown } | undefined;
  const shareM = typeof split?.M === "number" ? split.M : 0.5;
  const kilos = dist.weight_kg as { min?: unknown; max?: unknown } | undefined;
  const wMin = typeof kilos?.min === "number" ? kilos.min : 60;
  const wMax = typeof kilos?.max === "number" ? kilos.max : 100;
  const patient = {
    age: Math.floor(rng.range(range[0] as number, (range[1] as number) + 1)),
    sex: (rng.next() < shareM ? "M" : "F") as "M" | "F",
    weight_kg: Math.floor(rng.range(wMin, wMax + 1))
  };

  // 5. Comorbidities and home meds. L1 draws at most one from the L1 pool.
  const comorbPool = loadComorbidities().entries.filter((e) => (e.minLevel ?? 2) <= level);
  let comorbCount: number;
  if (level === 1) {
    comorbCount = rng.next() < 0.15 ? 1 : 0;
  } else {
    const r = rng.next();
    comorbCount = r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
  }
  const comorbidityIds: string[] = [];
  const homeMeds: string[] = [];
  const remaining = [...comorbPool];
  for (let i = 0; i < comorbCount && remaining.length > 0; i++) {
    const entry = pickWeighted(rng, remaining, (e) => asNumber(e.weight));
    remaining.splice(remaining.indexOf(entry), 1);
    comorbidityIds.push(entry.id);
    const meds = entry.homeMeds ?? [];
    if (meds.length > 0) homeMeds.push(pickUniform(rng, meds));
  }

  // 6. Environment compatible with the complaint, then time and weather.
  const envPool = loadEnvironments().environments.filter((e) =>
    (e.complaintIds ?? []).includes(complaint.id)
  );
  if (envPool.length === 0) throw new Error(`no environment admits complaint ${complaint.id}`);
  const env = pickWeighted(rng, envPool, (e) => asNumber(e.weight));
  const timeOfDay = pickUniform(rng, env.timesOfDay ?? []);
  const weather = pickUniform(rng, env.weather ?? []);

  // 7. Bystanders: 25 percent none on arrival, else one level-filtered draw.
  let bystanderId: string | null = null;
  if (rng.next() >= 0.25) {
    const pool = loadBystanders().archetypes.filter((a) => (a.minLevel ?? 1) <= level);
    bystanderId = pickWeighted(rng, pool, (a) => asNumber(a.weight)).id;
  }

  // 8. Complication: L1 draws none, L2 draws 0 to 1 from v1Ready entries.
  let complication: CallSkeleton["complication"] = null;
  if (level === 2 && rng.next() >= 0.6) {
    const eligible = loadComplications().complications.filter(
      (c) =>
        c.v1Ready === true &&
        (c.minLevel ?? 2) <= 2 &&
        (c.requiresCondition === null ||
          c.requiresCondition === undefined ||
          conditionIds.includes(c.requiresCondition))
    );
    if (eligible.length > 0) {
      const drawn = pickWeighted(rng, eligible, (c) => asNumber(c.weight));
      const window = drawn.onset_s ?? [300, 600];
      complication = {
        id: drawn.id,
        onset_s: Math.floor(rng.range(window[0], window[1] + 1))
      };
    }
  }

  return {
    version: "dispatch-v1",
    seed,
    level,
    complaintId: complaint.id,
    mechanismId: link.mechanismId,
    subtypeId: link.subtypeId,
    conditionIds,
    patient,
    comorbidityIds,
    homeMeds,
    environmentId: env.id,
    timeOfDay,
    weather,
    bystanderId,
    complication
  };
}
