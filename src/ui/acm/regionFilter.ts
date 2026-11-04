// Region to action filter, implemented from scratch Nov 4. Pure mapping
// only: when no region is selected the menu shows the full list, and when
// a region is selected the action list shows only rows strictly linked to
// that part. Filtering hides rows, it never deletes an action and never
// changes a dose, timing, or effect. Links come from existing code only:
// exam inspect text per region, the femoral left-thigh bleed, airway and
// O2 mask placement on the face and neck, line site anchors, and monitor
// probe sites. Systemic rows return null and stay in the full list only.

import type { RegionId } from "../../patient/regions";
import type { AcmCategory } from "./types";

const ARMS: RegionId[] = ["arm_left", "arm_right"];
const CHEST: RegionId[] = ["chest_left", "chest_right"];
const LEGS: RegionId[] = ["leg_left", "leg_right"];
const FACE_NECK: RegionId[] = ["face", "neck"];
const HEAD_FACE: RegionId[] = ["head", "face"];
const ARM_NECK: RegionId[] = ["arm_left", "arm_right", "neck"];
const ARM_LEG_CHEST: RegionId[] = ["arm_left", "arm_right", "leg_left", "leg_right", "chest_left", "chest_right"];

/**
 * Regions where one action row shows. Null means systemic or unmapped:
 * full list only, hidden on any region filter. Dynamic exam rows that are
 * built only for the open region (inspect, palpate, expose, logroll) use
 * the wildcard "*", meaning show whenever built.
 */
export function rowRegions(category: AcmCategory, rowId: string): RegionId[] | null | "*" {
  if (rowId === "inspect" || rowId === "palpate" || rowId === "expose" || rowId === "logroll") return "*";
  if (category === "triage") return null;
  if (category === "meds") return null;
  if (category === "examine") {
    if (rowId === "takeover") return ["leg_left"];
    if (rowId === "assess-pulse") return [...ARM_NECK];
    if (rowId === "assess-lungs") return [...CHEST];
    if (rowId === "assess-bp") return [...ARMS];
    if (rowId === "assess-cap") return [...ARMS];
    return null;
  }
  if (category === "bleeding") return ["leg_left"];
  if (category === "airway") return [...FACE_NECK];
  if (category === "breathing") {
    if (rowId === "tank") return null;
    return ["face"];
  }
  if (category === "lines") {
    if (rowId === "iv") return [...ARMS];
    if (rowId === "io") return [...ARM_LEG_CHEST];
    if (rowId === "bloodkit") return null;
    return null;
  }
  if (category === "monitor") {
    if (rowId === "spo2on" || rowId === "spo2read") return [...ARMS];
    if (rowId === "etco2on") return [...FACE_NECK];
    if (rowId === "pads") return [...CHEST];
    if (rowId === "nibp") return [...ARMS];
    if (rowId === "pulse") return [...ARM_NECK];
    if (rowId === "rr") return [...CHEST];
    if (rowId === "bpausc" || rowId === "bppalp") return [...ARMS];
    if (rowId === "caprefill") return [...ARMS];
    if (rowId === "pupils") return [...HEAD_FACE];
    if (rowId === "glucose") return [...ARMS];
    if (rowId === "temp") return [...HEAD_FACE];
    if (rowId === "lungs") return [...CHEST];
    if (rowId === "gcs") return [...HEAD_FACE];
    return null;
  }
  return null;
}

/**
 * Categories that render their full content under any region pick.
 * Meds only: no drug carries a body-region link in code, so filtering
 * would zero the whole tab for being systemic. Implemented from scratch
 * Nov 3 night.
 */
export function categoryIgnoresRegion(category: AcmCategory): boolean {
  return category === "meds";
}

/** True when a row shows for the open region. Null region shows all. */
export function rowAllowed(category: AcmCategory, rowId: string, region: RegionId | null): boolean {
  if (region === null) return true;
  const link = rowRegions(category, rowId);
  if (link === "*") return true;
  if (link === null) return false;
  return link.includes(region);
}

/**
 * Regions where a line site shows. Limb sites cover both sides by
 * convention: the engine tracks no laterality and the doll anchors limb
 * lines on the right (see bodyDoll.ts), so filtering to one side would
 * strand the line. Sternal covers both chest sides (midline).
 */
export function lineSiteRegions(site: string): RegionId[] {
  if (site === "ac" || site === "forearm" || site === "hand" || site === "humeral") return [...ARMS];
  if (site === "tibial") return [...LEGS];
  if (site === "sternal") return [...CHEST];
  return [];
}

/** True when a line card shows for the open region. Null shows all. */
export function lineAllowed(site: string, region: RegionId | null): boolean {
  if (region === null) return true;
  return lineSiteRegions(site).includes(region);
}
