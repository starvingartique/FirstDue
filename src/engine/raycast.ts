// Raycast picking against the patient group. Walks up from the hit mesh so a
// child mesh without its own tag still resolves to its region.

import * as THREE from "three";
import { isRegionId, type RegionId } from "../patient/regions";
import { isKitItemId, type KitItemId } from "./kit";

const raycaster = new THREE.Raycaster();

/** Minimal canvas box. getBoundingClientRect fills this in the game. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Client point to NDC across the canvas's own visible box. The text-size
 * zoom scales the canvas layout box while clientX and window.innerWidth
 * stay in unscaled viewport pixels, so mapping against the rect (which
 * the browser reports scaled) keeps the same tap on the same pixel at
 * every zoom. Pure, so the zoom sizes are unit-tested headless.
 */
export function ndcFromClient(
  clientX: number,
  clientY: number,
  rect: ClientRect
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1
  };
}

export function pickRegion(
  camera: THREE.Camera,
  patient: THREE.Object3D,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement
): RegionId | null {
  const point = ndcFromClient(clientX, clientY, canvas.getBoundingClientRect());
  const ndc = new THREE.Vector2(point.x, point.y);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(patient, true);
  for (const hit of hits) {
    let node: THREE.Object3D | null = hit.object;
    while (node !== null) {
      const tag: unknown = node.userData["regionId"];
      if (isRegionId(tag)) return tag;
      node = node.parent;
    }
  }
  return null;
}

/**
 * Kit picking against the kit group. Walks up from the hit mesh so a
 * child mesh inside a tagged group still resolves. Returns null for the
 * tarp and the jump bag shell, which carry no tag.
 */
export function pickKitItem(
  camera: THREE.Camera,
  kit: THREE.Object3D,
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement
): KitItemId | null {
  const point = ndcFromClient(clientX, clientY, canvas.getBoundingClientRect());
  const ndc = new THREE.Vector2(point.x, point.y);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(kit, true);
  for (const hit of hits) {
    let node: THREE.Object3D | null = hit.object;
    while (node !== null) {
      const tag: unknown = node.userData["kitItem"];
      if (isKitItemId(tag)) return tag;
      node = node.parent;
    }
  }
  return null;
}
