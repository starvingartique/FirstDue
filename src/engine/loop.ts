// Frame loop. Owns resize, render, the 1 Hz physiology tick, and the small
// engine-driven motions: chest rise at the live RR, blood pool scaled from
// cumulative mL lost, wound pulsing with HR while bleeding is uncontrolled.
// Honors reduced-motion by stilling the idle motions (the tick still runs).

import * as THREE from "three";
import type { PatientModel } from "../patient/body";
import type { Sim } from "../sim/engine";
import { bloodPoolRadius_m } from "../sim/physiology";

export interface LoopRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  patient: PatientModel;
  sim: Sim;
  onResize: () => void;
  /** Fires once per sim-second for HUD, menu and overlay refresh. */
  onTick: () => void;
  /** When true the sim clock holds (transport skip, end card). Rendering never stops. */
  paused?: () => boolean;
  /** Sim seconds per real second: 0.5, 1, or 2 from the speed bar. */
  rate?: () => number;
  /** Per-frame UI hook (kit label projection). Runs even while paused. */
  onFrame?: () => void;
}

/**
 * One frame of sim debt. Rate changes only the real-time pace at which
 * sim-seconds accrue; tick() still advances exactly one sim-second, so no
 * sim duration, bleed rate, or procedure length changes at any speed.
 */
export function advanceDebt(debt_s: number, dt_s: number, rate: number): number {
  const safe = Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 4) : 1;
  return debt_s + dt_s * safe;
}

export function startLoop(refs: LoopRefs): void {
  const clock = new THREE.Clock();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const baseScale = refs.patient.chestMeshes.map((mesh) => mesh.scale.y);
  let simDebt_s = 0;

  window.addEventListener("resize", () => {
    refs.renderer.setSize(window.innerWidth, window.innerHeight);
    refs.onResize();
  });

  // Pool starts at the scene-start loss, not zero.
  refs.patient.bloodPool.scale.setScalar(bloodPoolRadius_m(refs.sim.loss_mL));

  refs.renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.25);
    const t = clock.getElapsedTime();

    // Fixed 1 sim-second tick, decoupled from frame rate. The speed bar
    // scales only how fast debt accrues; pause zeroes it.
    if (refs.paused?.() === true) {
      simDebt_s = 0;
    } else {
      simDebt_s = advanceDebt(simDebt_s, dt, refs.rate?.() ?? 1);
    }
    while (simDebt_s >= 1) {
      simDebt_s -= 1;
      refs.sim.tick();
      refs.patient.bloodPool.scale.setScalar(bloodPoolRadius_m(refs.sim.loss_mL));
      refs.onTick();
    }

    if (!reducedMotion) {
      // Chest rise follows the live RR; agonal/apneic stills the chest.
      const rr = refs.sim.vitals.rr_per_min;
      const period = rr > 2 ? 60 / rr : 1e9;
      const lift = rr > 2 ? 1 + 0.035 * Math.sin((t / period) * Math.PI * 2) : 1;
      refs.patient.chestMeshes.forEach((mesh, i) => {
        mesh.scale.y = (baseScale[i] ?? 1) * lift;
      });
      // Arterial wound pulses with HR while uncontrolled; still when occluded.
      const rate = refs.sim.bleedRate_mL_per_min();
      const hr = refs.sim.vitals.hr_bpm;
      const pulse = rate > 30 && hr > 10 ? 1 + 0.12 * Math.max(0, Math.sin((t * hr) / 60 * Math.PI * 2)) : 1;
      refs.patient.wound.scale.set(pulse, 1, pulse);
    }
    refs.onFrame?.();
    refs.renderer.render(refs.scene, refs.camera);
  });
}
