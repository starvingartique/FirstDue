// Bundled cached-call fallbacks. The shipped generated calls ride with the
// client so Dispatch never strands the player when the server is unreachable.
// The server disk cache stays the primary fallback; this is the offline one.

import gen44 from "../../data/calls/cache/gen_44_L2.json";
import gen22 from "../../data/calls/cache/gen_22_L2.json";
import gen143 from "../../data/calls/cache/gen_143_L2.json";
import type { FleshedCall } from "./types";

function asCall(raw: unknown): FleshedCall {
  return raw as unknown as FleshedCall;
}

export const BUNDLED_CALLS: FleshedCall[] = [asCall(gen44), asCall(gen22), asCall(gen143)];

/** Deterministic bundled pick for a seed, preferring the active level. */
export function pickBundled(seed: number, level: 1 | 2): FleshedCall {
  const pool = BUNDLED_CALLS.filter((c) => c.skeleton.level === level);
  const list = pool.length > 0 ? pool : BUNDLED_CALLS;
  const pick = list[Math.abs(seed) % list.length];
  if (pick === undefined) throw new Error("bundled call cache is empty");
  return pick;
}
