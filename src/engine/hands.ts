// First-person procedure hands. Simple procedural gloved hands in the
// foreground, lower center, holding a clone of the kit item for the running
// procedure. Visible only while sim.pending is set. Static pose, no motion:
// the rig appears when a procedure starts and clears when it ends, fails,
// or is cancelled. Held items are clones of the meshes already modeled in
// kit.ts, sharing their geometry and materials, so there are no new assets,
// no new dependencies, and no newly modeled items. Gloves match the kit
// nitrile purple: generic PPE, no skin tone or identity detail. The rig is
// its own scene group, never raycast, so patient and kit clicks pass by it.

import * as THREE from "three";
import type { KitItemId } from "./kit";
import type { PendingAction } from "../sim/types";

const GLOVE = 0x5b4fa8;
const CUFF = 0x2a2d33;

function mat(color: number, roughness = 0.65): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

/**
 * Held item per procedure id. Null means empty hands: the procedure has no
 * modeled kit item (exams, belt removal, IO drill, fetches and the like).
 */
export function heldItemForPending(id: string, label: string): KitItemId | null {
  switch (id) {
    case "apply_tq":
    case "apply_tq2":
      return "cat";
    case "pack":
      return label.includes("hemostatic") ? "zfold" : "kerlix";
    case "dressing":
      return "dressing";
    case "o2":
      return "nrb";
    case "tank_swap":
      return "o2";
    case "iv":
    case "hang":
      return "ns";
    case "opa":
    case "npa":
    case "sga":
    case "ett":
    case "secure_ett":
    case "suction":
      return "airway";
    case "drug":
      return "drugs";
    case "wrap":
      return "blanket";
    default:
      return null;
  }
}

/** Foreground scale per held item so small items read at arm's length. */
const HELD_SCALE: Record<KitItemId, number> = {
  cat: 1.8,
  kerlix: 1.8,
  zfold: 1.6,
  dressing: 1.5,
  gloves: 1,
  nrb: 1.4,
  o2: 0.85,
  ns: 1.3,
  blanket: 1.1,
  airway: 0.9,
  drugs: 1.3
};

/**
 * One low-poly glove in rig space (minus Z is view forward): palm roughly
 * flat, four distinct fingers pointing forward and tipping down, thumb on
 * the inner edge angled toward the item, wrist and cuff trailing back and
 * down toward the viewer so the hand has a direction and an anchor.
 */
function buildHand(side: -1 | 1): THREE.Group {
  const hand = new THREE.Group();
  const glove = mat(GLOVE, 0.6);
  const cuff = mat(CUFF, 0.85);
  function box(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    hand.add(mesh);
  }
  box(0.08, 0.022, 0.09, glove, 0, 0, 0, -0.1, 0, side * 0.08); // palm, front edge low
  for (let i = 0; i < 4; i++) {
    const fx = -0.028 + i * 0.019;
    box(0.015, 0.016, 0.06, glove, fx, -0.014, -0.068, -0.55, 0, 0); // fingers forward, tips down
  }
  box(0.016, 0.016, 0.05, glove, side * -0.048, -0.006, -0.015, -0.25, side * 0.5, 0); // inner thumb
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.1, 10), glove);
  wrist.position.set(side * 0.012, -0.035, 0.1);
  wrist.rotation.set(1.85, 0, side * -0.25);
  wrist.castShadow = false;
  wrist.receiveShadow = false;
  hand.add(wrist);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.09, 10), cuff);
  sleeve.position.set(side * 0.03, -0.078, 0.18);
  sleeve.rotation.set(1.85, 0, side * -0.25);
  sleeve.castShadow = false;
  sleeve.receiveShadow = false;
  hand.add(sleeve);
  return hand;
}

export class ProcedureHands {
  readonly group = new THREE.Group();
  private readonly mount = new THREE.Group();
  private shownKey: string | null = null;
  private readonly dir = new THREE.Vector3();
  private readonly down = new THREE.Vector3();

  constructor(private readonly kitRoot: THREE.Object3D) {
    this.group.name = "hands";
    this.group.visible = false;
    const left = buildHand(-1);
    left.position.set(-0.105, -0.055, 0);
    left.rotation.y = -0.3;
    const right = buildHand(1);
    right.position.set(0.105, -0.055, 0);
    right.rotation.y = 0.3;
    this.mount.position.set(0, 0.02, -0.01);
    this.group.add(left, right, this.mount);
  }

  /**
   * Called every frame. Shows the rig while a procedure runs, rebuilds the
   * held item only when the procedure changes, and hides on end, fail, or
   * cancel. Pause freezes the sim timer; the static rig simply stays put.
   */
  update(camera: THREE.Camera, pending: PendingAction | null): void {
    if (pending === null) {
      this.group.visible = false;
      this.shownKey = null;
      return;
    }
    const item = heldItemForPending(pending.id, pending.label);
    const key = `${pending.id}|${item ?? "hands"}`;
    if (key !== this.shownKey) {
      this.setHeld(item);
      this.shownKey = key;
    }
    camera.getWorldDirection(this.dir);
    this.down.set(0, -1, 0).applyQuaternion(camera.quaternion);
    this.group.position
      .copy(camera.position)
      .addScaledVector(this.dir, 0.5)
      .addScaledVector(this.down, 0.13);
    this.group.quaternion.copy(camera.quaternion);
    this.group.visible = true;
  }

  /**
   * Clone the tagged kit meshes into the mount, recentered and scaled for
   * foreground reading. Clones share kit geometry and materials; clearing
   * the mount never disposes them.
   */
  private setHeld(item: KitItemId | null): void {
    this.mount.clear();
    if (item === null) return;
    const held = new THREE.Group();
    this.kitRoot.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData["kitItem"] === item) held.add(o.clone());
    });
    if (held.children.length === 0) return;
    const center = new THREE.Box3().setFromObject(held).getCenter(new THREE.Vector3());
    for (const child of held.children) child.position.sub(center);
    held.scale.setScalar(HELD_SCALE[item]);
    held.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    this.mount.add(held);
  }
}
