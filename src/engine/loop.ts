// Frame loop. Owns resize, render and the small idle motions that keep the
// scene alive: chest rise for breathing. Honors reduced-motion by stilling it.

import * as THREE from "three";
import type { PatientModel } from "../patient/body";

const BREATH_PERIOD_S = 2.5; // placeholder rate until the Oct 28 engine ticks

export interface LoopRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  patient: PatientModel;
  onResize: () => void;
}

export function startLoop(refs: LoopRefs): void {
  const clock = new THREE.Clock();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const baseScale = refs.patient.chestMeshes.map((mesh) => mesh.scale.y);

  window.addEventListener("resize", () => {
    refs.renderer.setSize(window.innerWidth, window.innerHeight);
    refs.onResize();
  });

  refs.renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    if (!reducedMotion) {
      const lift = 1 + 0.035 * Math.sin((t / BREATH_PERIOD_S) * Math.PI * 2);
      refs.patient.chestMeshes.forEach((mesh, i) => {
        mesh.scale.y = (baseScale[i] ?? 1) * lift;
      });
    }
    refs.renderer.render(refs.scene, refs.camera);
  });
}
