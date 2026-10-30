// Night roadside world: ground, road, shoulder, guardrail, downed bike with a
// live headlight, lamp post, jump bag and staged kit, bystander, cones,
// stars and tree line. One scene type rendered well; depth lives in data
// (brief section 0).

import * as THREE from "three";
import { buildKit } from "./kit";

export interface World {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
}

function mat(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

export function buildWorld(canvas: HTMLCanvasElement): World {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b16);
  scene.fog = new THREE.FogExp2(0x070b16, 0.026);

  // - light: cool moon and sky fill, warm lamp key, cool headlight rim -
  scene.add(new THREE.HemisphereLight(0x33415e, 0x0a0c12, 0.7));
  const moon = new THREE.DirectionalLight(0x8fa8d8, 0.6);
  moon.position.set(-6, 10, -4);
  scene.add(moon);

  const lampSpot = new THREE.SpotLight(0xffd9a0, 90, 30, 0.55, 0.5, 1.8);
  lampSpot.position.set(2.5, 4.4, -2.5);
  lampSpot.target.position.set(0, 0, -0.1);
  lampSpot.castShadow = true;
  lampSpot.shadow.mapSize.set(1024, 1024);
  scene.add(lampSpot, lampSpot.target);

  const headlight = new THREE.SpotLight(0xcfe4ff, 40, 20, 0.4, 0.6, 1.8);
  headlight.position.set(-2.5, 0.5, -2.2);
  headlight.target.position.set(0, 0.1, -0.2);
  scene.add(headlight, headlight.target);

  // - ground layers: grass base, asphalt road, gravel shoulder -
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat(0x11150f));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(4, 60), mat(0x1a1d22, 0.95));
  road.rotation.x = -Math.PI / 2;
  road.position.set(-3, 0.005, 0);
  road.receiveShadow = true;
  scene.add(road);

  const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 60), mat(0x23262b));
  shoulder.rotation.x = -Math.PI / 2;
  shoulder.position.set(0.3, 0.004, 0);
  shoulder.receiveShadow = true;
  scene.add(shoulder);

  // - guardrail along the road edge -
  const railMat = new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.4, metalness: 0.8 });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 40), railMat);
  rail.position.set(-5.2, 0.62, 0);
  rail.castShadow = true;
  scene.add(rail);
  for (let z = -18; z <= 18; z += 3) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), railMat);
    post.position.set(-5.2, 0.37, z);
    post.castShadow = true;
    scene.add(post);
  }

  // - downed motorcycle: wheels, frame, bars, glowing headlight -
  const bike = new THREE.Group();
  bike.position.set(-2.5, 0, -2.2);
  bike.rotation.y = 0.7;
  const wheelGeo = new THREE.TorusGeometry(0.3, 0.07, 12, 24);
  const wheelMat = mat(0x141416, 0.7);
  const wheelA = new THREE.Mesh(wheelGeo, wheelMat);
  wheelA.position.set(0, 0.3, 0.55);
  const wheelB = new THREE.Mesh(wheelGeo, wheelMat);
  wheelB.position.set(0, 0.3, -0.55);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 1.1), mat(0x7a1f1f, 0.5));
  frame.position.set(0, 0.42, 0);
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 10), railMat);
  bars.rotation.z = Math.PI / 2;
  bars.position.set(0, 0.62, 0.55);
  const lampLens = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 14, 12),
    new THREE.MeshStandardMaterial({
      color: 0xd8ecff,
      emissive: 0xbfe0ff,
      emissiveIntensity: 2.2,
      roughness: 0.3
    })
  );
  lampLens.position.set(0, 0.55, 0.62);
  bike.add(wheelA, wheelB, frame, bars, lampLens);
  bike.rotation.z = Math.PI / 2 - 0.12; // lying on its side
  bike.position.y = 0.32;
  bike.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });
  scene.add(bike);

  // - lamp post with a warm head -
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.4, 12), mat(0x2a2d33, 0.6));
  pole.position.set(2.5, 2.2, -2.5);
  pole.castShadow = true;
  scene.add(pole);
  const lampHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.12, 0.24),
    new THREE.MeshStandardMaterial({
      color: 0x444444,
      emissive: 0xffd9a0,
      emissiveIntensity: 1.6
    })
  );
  lampHead.position.set(2.35, 4.42, -2.4);
  scene.add(lampHead);

  // - jump bag and staged kit at the patient right side -
  scene.add(buildKit());

  // - bystander witness by the road edge -
  const witness = new THREE.Group();
  witness.position.set(-1.8, 0, 1.7);
  witness.rotation.y = 2.6;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 6, 14), mat(0x4a3b2a));
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 14), mat(0xb98d63, 0.6));
  head.position.y = 1.68;
  torso.castShadow = true;
  head.castShadow = true;
  witness.add(torso, head);
  scene.add(witness);

  // - traffic cones around the scene -
  for (const [x, z] of [[-1.4, -3.4], [-1.2, 2.6], [-3.4, 0.6]] as const) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 16), mat(0xd8621a, 0.7));
    cone.position.set(x, 0.28, z);
    cone.castShadow = true;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.34), mat(0xc25a18, 0.8));
    base.position.set(x, 0.025, z);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 16), mat(0xe8e8e8, 0.5));
    band.position.set(x, 0.32, z);
    scene.add(cone, base, band);
  }

  // - stars and a dark tree line so no view ends in a void -
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(300 * 3);
  for (let i = 0; i < 300; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.45;
    const r = 45;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi) + 2;
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  scene.add(
    new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xafc4e8, size: 0.12, sizeAttenuation: true })
    )
  );
  for (let i = 0; i < 14; i++) {
    const theta = (i / 14) * Math.PI * 2;
    const tree = new THREE.Mesh(new THREE.ConeGeometry(1.6, 5, 8), mat(0x0d130c));
    tree.position.set(Math.cos(theta) * 24, 2.2, Math.sin(theta) * 24);
    scene.add(tree);
  }

  return { scene, renderer };
}
