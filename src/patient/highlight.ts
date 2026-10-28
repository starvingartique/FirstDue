// Selection highlight. Tinting emissive keeps the base color readable at
// night, which a wireframe or scale pop would not.

import * as THREE from "three";
import type { RegionId } from "./regions";
import type { PatientModel } from "./body";

const HIGHLIGHT_EMISSIVE = 0x8a5a00;

export class RegionHighlight {
  private selected: RegionId | null = null;
  private saved = new Map<THREE.Mesh, number>();

  constructor(private readonly patient: PatientModel) {}

  getSelected(): RegionId | null {
    return this.selected;
  }

  setSelected(region: RegionId | null): void {
    if (region === this.selected) return;
    this.clear();
    this.selected = region;
    if (region === null) return;
    const meshes = this.patient.regionMeshes.get(region) ?? [];
    for (const mesh of meshes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      this.saved.set(mesh, material.emissive.getHex());
      material.emissive.setHex(HIGHLIGHT_EMISSIVE);
    }
  }

  private clear(): void {
    for (const [mesh, hex] of this.saved) {
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(hex);
    }
    this.saved.clear();
    this.selected = null;
  }
}
