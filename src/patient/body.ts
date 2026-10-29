// Procedural supine patient. One mesh (or a small set of meshes) per body
// region, each tagged with userData.regionId for raycast picking. Proportions
// are rough on purpose: depth lives in data and menus, not 3D (brief section 0).
// Layout: head toward -Z, feet toward +Z, lying on y = 0.

import * as THREE from "three";
import type { RegionId } from "./regions";

export interface PatientModel {
  group: THREE.Group;
  /** Every mesh per region, used by picking and highlight. */
  regionMeshes: Map<RegionId, THREE.Mesh[]>;
  /** Chest meshes, used for the idle breathing motion. */
  chestMeshes: THREE.Mesh[];
  /** Engine-driven blood pool: scale grows with cumulative mL lost. */
  bloodPool: THREE.Mesh;
  /** Femoral wound marker: pulses while arterial bleeding is uncontrolled. */
  wound: THREE.Mesh;
}

const SKIN = 0xc9a07a;
const SHIRT = 0x2e5f5d;
const PANTS = 0x2b3550;
const BOOT = 0x1c1c20;
const WOUND = 0x8a1212;
const BLOOD = 0x7d1111;

function mat(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

export function buildPatient(): PatientModel {
  const group = new THREE.Group();
  group.name = "patient";
  const regionMeshes = new Map<RegionId, THREE.Mesh[]>();
  const chestMeshes: THREE.Mesh[] = [];

  function add(
    region: RegionId,
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
    x: number,
    y: number,
    z: number
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData["regionId"] = region;
    group.add(mesh);
    const list = regionMeshes.get(region) ?? [];
    list.push(mesh);
    regionMeshes.set(region, list);
    return mesh;
  }

  // Head: sphere with a slightly flattened face plate on top (supine).
  add("head", new THREE.SphereGeometry(0.11, 24, 18), mat(SKIN, 0.6), 0, 0.12, -0.78);
  const face = add(
    "face",
    new THREE.SphereGeometry(0.085, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4),
    mat(0xcf9a6e, 0.6),
    0,
    0.155,
    -0.76
  );
  face.rotation.x = -0.35;

  // Neck: short cylinder between head and chest.
  const neck = add("neck", new THREE.CylinderGeometry(0.05, 0.06, 0.12, 16), mat(SKIN, 0.6), 0, 0.1, -0.6);
  neck.rotation.x = Math.PI / 2;

  // Chest: two boxes so left and right pick separately.
  const chestGeo = new THREE.BoxGeometry(0.17, 0.2, 0.3);
  chestMeshes.push(add("chest_left", chestGeo, mat(SHIRT), -0.095, 0.15, -0.37));
  chestMeshes.push(add("chest_right", chestGeo.clone(), mat(SHIRT), 0.095, 0.15, -0.37));

  // Abdomen: 2x2 quadrants. Patient left is -X here (head at -Z, supine).
  const quadGeo = new THREE.BoxGeometry(0.16, 0.18, 0.14);
  add("abd_luq", quadGeo, mat(SHIRT), -0.09, 0.14, -0.15);
  add("abd_ruq", quadGeo.clone(), mat(SHIRT), 0.09, 0.14, -0.15);
  add("abd_llq", quadGeo.clone(), mat(SHIRT), -0.09, 0.14, -0.01);
  add("abd_rlq", quadGeo.clone(), mat(SHIRT), 0.09, 0.14, -0.01);

  // Pelvis and belt line.
  add("pelvis", new THREE.BoxGeometry(0.34, 0.2, 0.28), mat(PANTS), 0, 0.14, 0.2);

  // Arms: one capsule plus a hand sphere per side, same region id.
  for (const side of [-1, 1] as const) {
    const region: RegionId = side < 0 ? "arm_left" : "arm_right";
    const arm = add(
      region,
      new THREE.CapsuleGeometry(0.05, 0.42, 6, 14),
      mat(SHIRT),
      side * 0.27,
      0.09,
      -0.18
    );
    arm.rotation.x = Math.PI / 2;
    add(region, new THREE.SphereGeometry(0.05, 14, 12), mat(SKIN, 0.6), side * 0.27, 0.07, 0.14);
  }

  // Legs: thigh capsule, shin capsule and boot box per side.
  for (const side of [-1, 1] as const) {
    const region: RegionId = side < 0 ? "leg_left" : "leg_right";
    const thigh = add(
      region,
      new THREE.CapsuleGeometry(0.075, 0.3, 6, 14),
      mat(PANTS),
      side * 0.11,
      0.11,
      0.53
    );
    thigh.rotation.x = Math.PI / 2;
    const shin = add(
      region,
      new THREE.CapsuleGeometry(0.06, 0.3, 6, 14),
      mat(PANTS),
      side * 0.11,
      0.09,
      0.9
    );
    shin.rotation.x = Math.PI / 2;
    add(region, new THREE.BoxGeometry(0.11, 0.1, 0.24), mat(BOOT, 0.7), side * 0.11, 0.07, 1.16);
  }

  // Back: thin shell under the torso. Hidden while supine; selectable from the
  // region chips until the log roll lands.
  const back = add("back", new THREE.BoxGeometry(0.36, 0.04, 0.62), mat(SHIRT), 0, 0.03, -0.2);
  back.castShadow = false;

  // Wound marker on the left thigh plus the engine-driven blood pool. The
  // loop rescales the pool from cumulative mL lost every tick (unit circle
  // geometry scaled to the engine radius, so growth is exact).
  const wound = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.055, 0.02, 16),
    mat(WOUND, 0.4)
  );
  wound.position.set(-0.11, 0.185, 0.5);
  group.add(wound);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat(BLOOD, 0.35));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(-0.14, 0.006, 0.52);
  pool.scale.setScalar(0.33);
  pool.receiveShadow = true;
  group.add(pool);

  return { group, regionMeshes, chestMeshes, bloodPool: pool, wound };
}
