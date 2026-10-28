// Body region ids. Brief section 8: head, face, neck, chest L/R, abdomen in
// 4 quadrants, pelvis, each arm, each leg, back. The log roll that exposes
// the back lands after Oct 27; until then the back is selected from the chips.

export const REGION_IDS = [
  "head",
  "face",
  "neck",
  "chest_left",
  "chest_right",
  "abd_ruq",
  "abd_luq",
  "abd_rlq",
  "abd_llq",
  "pelvis",
  "arm_left",
  "arm_right",
  "leg_left",
  "leg_right",
  "back"
] as const;

export type RegionId = (typeof REGION_IDS)[number];

export const REGION_LABELS: Record<RegionId, string> = {
  head: "Head",
  face: "Face",
  neck: "Neck",
  chest_left: "Chest left",
  chest_right: "Chest right",
  abd_ruq: "Abdomen RUQ",
  abd_luq: "Abdomen LUQ",
  abd_rlq: "Abdomen RLQ",
  abd_llq: "Abdomen LLQ",
  pelvis: "Pelvis",
  arm_left: "Arm left",
  arm_right: "Arm right",
  leg_left: "Leg left",
  leg_right: "Leg right",
  back: "Back"
};

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === "string" && (REGION_IDS as readonly string[]).includes(value);
}
