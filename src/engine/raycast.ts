// Raycast picking against the patient group. Walks up from the hit mesh so a
// child mesh without its own tag still resolves to its region.

import * as THREE from "three";
import { isRegionId, type RegionId } from "../patient/regions";
import { isKitItemId, type KitItemId } from "./kit";

const raycaster = new THREE.Raycaster();

export function pickRegion(
  camera: THREE.Camera,
  patient: THREE.Object3D,
  clientX: number,
  clientY: number
): RegionId | null {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
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
  clientY: number
): KitItemId | null {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
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
