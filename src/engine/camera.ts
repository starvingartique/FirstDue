// Fixed kneeling camera with three preset spots and drag-to-look offsets.
// No walking, no physics: position is fixed per spot, only the view angles
// move (brief section 2).

import * as THREE from "three";

export type SpotId = "patient" | "kit" | "bystander";

export const SPOT_IDS: SpotId[] = ["patient", "kit", "bystander"];

interface Spot {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const SPOTS: Record<SpotId, Spot> = {
  patient: {
    position: new THREE.Vector3(1.12, 0.92, 0.5),
    target: new THREE.Vector3(-0.25, 0.08, -0.35)
  },
  kit: {
    position: new THREE.Vector3(0.4, 0.85, -0.15),
    target: new THREE.Vector3(1.18, 0.12, 1.12)
  },
  bystander: {
    position: new THREE.Vector3(0.35, 0.8, -0.1),
    target: new THREE.Vector3(-1.8, 1.1, 1.7)
  }
};

// Clamp keeps the horizon sane and stops the player looking through the ground.
const YAW_LIMIT = 1.15;
const PITCH_LIMIT = 0.7;

export class SpotCamera {
  readonly camera: THREE.PerspectiveCamera;
  private spot: SpotId = "patient";
  private yawOffset = 0;
  private pitchOffset = 0;
  private baseYaw = 0;
  private basePitch = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(
      68,
      window.innerWidth / window.innerHeight,
      0.05,
      120
    );
    this.applySpot("patient");
  }

  getSpot(): SpotId {
    return this.spot;
  }

  applySpot(spot: SpotId): void {
    this.spot = spot;
    this.yawOffset = 0;
    this.pitchOffset = 0;
    const { position, target } = SPOTS[spot];
    this.camera.position.copy(position);
    const dir = target.clone().sub(position).normalize();
    this.baseYaw = Math.atan2(-dir.x, -dir.z);
    this.basePitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.update();
  }

  /** Drag deltas in pixels. Positive dx looks right, positive dy looks down. */
  addLook(dx: number, dy: number): void {
    this.yawOffset = THREE.MathUtils.clamp(this.yawOffset - dx * 0.0026, -YAW_LIMIT, YAW_LIMIT);
    this.pitchOffset = THREE.MathUtils.clamp(
      this.pitchOffset - dy * 0.0026,
      -PITCH_LIMIT,
      PITCH_LIMIT
    );
    this.update();
  }

  private update(): void {
    const yaw = this.baseYaw + this.yawOffset;
    const pitch = this.basePitch + this.pitchOffset;
    const dir = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    );
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
