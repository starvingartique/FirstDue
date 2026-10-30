// Staged jump bag and kit items for the night roadside scene. Procedural
// low-poly shapes in the same style as the rest of the world: boxes,
// cylinders, spheres, torus arcs and tube lines with flat standard materials.
// This group never joins the patient group, so region picking is untouched.
// Each staged item carries a kitItem tag for click picking and label anchors.
// Item choice mirrors the equipment.json jump_bag stash: CAT tourniquet,
// gauze rolls and z-fold packing, pressure dressing, non-rebreather with a
// D cylinder, NS bag and drip line, and the folded hypothermia blanket.
// Gloves are untracked BSI dressing, visual only, not an equipment.json item.
// Kit zone is about x 0.55 to 1.71, z 0.3 to 1.61: clear of the patient
// (max x about 0.32), the wound and the blood pool.

import * as THREE from "three";

/** Staged items with labels. The jump bag shell itself is untagged. */
export type KitItemId =
  | "cat"
  | "kerlix"
  | "zfold"
  | "dressing"
  | "gloves"
  | "nrb"
  | "o2"
  | "ns"
  | "blanket"
  | "airway"
  | "drugs";

export function isKitItemId(value: unknown): value is KitItemId {
  return (
    value === "cat" ||
    value === "kerlix" ||
    value === "zfold" ||
    value === "dressing" ||
    value === "gloves" ||
    value === "nrb" ||
    value === "o2" ||
    value === "ns" ||
    value === "blanket" ||
    value === "airway" ||
    value === "drugs"
  );
}

/** World-space anchor per item for the HTML label overlay. Above the item. */
export const KIT_ANCHORS: Record<KitItemId, [number, number, number]> = {
  cat: [0.85, 0.1, 0.75],
  kerlix: [0.85, 0.11, 0.98],
  zfold: [1.03, 0.09, 0.64],
  dressing: [0.82, 0.11, 1.52],
  gloves: [0.73, 0.07, 0.63],
  nrb: [1.62, 0.15, 0.63],
  o2: [1.62, 0.47, 1.12],
  ns: [0.68, 0.11, 1.1],
  blanket: [1.3, 0.13, 0.42],
  airway: [1.18, 0.27, 1.45],
  drugs: [0.8, 0.15, 1.35]
};

const BAG_RED = 0x7a1515;
const BAG_DARK = 0x5f1010;
const WEBBING = 0x17181c;
const LINING = 0x0f0d0c;
const CREAM = 0xe4dcc4;
const PACKET_TAN = 0xcbb98f;
const GLOVE = 0x5b4fa8;
const O2_GREEN = 0x1f7a3a;
const WINDLASS = 0xd8621a;
const CROSS_RED = 0xa11f1f;
const STEEL = 0x8b9096;

/** Top face of the staging tarp. Loose items rest on this, not on y 0. */
const DECK = 0.012;

function mat(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

export function buildKit(): THREE.Group {
  const kit = new THREE.Group();
  kit.name = "kit";

  // Item tag stamped on every mesh placed while it is set. Null for the
  // tarp and the jump bag shell, which are not labeled or clickable.
  let current: KitItemId | null = null;

  function put(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    castShadow = true
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    if (current !== null) mesh.userData["kitItem"] = current;
    kit.add(mesh);
    return mesh;
  }

  function box(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    castShadow = true
  ): THREE.Mesh {
    return put(new THREE.BoxGeometry(w, h, d), material, x, y, z, castShadow);
  }

  function cyl(
    rTop: number,
    rBottom: number,
    h: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    seg = 16
  ): THREE.Mesh {
    return put(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material, x, y, z);
  }

  function tube(points: Array<[number, number, number]>, r: number, material: THREE.Material): void {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
    );
    put(new THREE.TubeGeometry(curve, 24, r, 8, false), material, 0, 0, 0, false);
  }

  // - staging tarp under the loose items -
  box(1.15, DECK, 1.3, mat(0x1a2233, 0.95), 1.13, DECK / 2, 0.95, false);

  // - jump bag: open box shell, lid folded back flat, handles, straps,
  //   pockets and a reflective strip. Center (1.28, 0.82), rim at 0.29. -
  const bx = 1.28;
  const bz = 0.82;
  const bagMat = mat(BAG_RED, 0.85);
  const darkMat = mat(BAG_DARK, 0.85);
  const webMat = mat(WEBBING, 0.9);
  const tapeMat = new THREE.MeshStandardMaterial({
    color: 0xd8dce2,
    emissive: 0x9aa0a8,
    emissiveIntensity: 0.4,
    roughness: 0.4,
    metalness: 0
  });
  box(0.55, 0.03, 0.34, bagMat, bx, 0.015, bz); // bottom
  box(0.55, 0.26, 0.03, bagMat, bx, 0.16, bz - 0.155); // front wall
  box(0.55, 0.26, 0.03, bagMat, bx, 0.16, bz + 0.155); // back wall
  box(0.03, 0.26, 0.28, bagMat, bx - 0.26, 0.16, bz); // left wall
  box(0.03, 0.26, 0.28, bagMat, bx + 0.26, 0.16, bz); // right wall
  box(0.49, 0.02, 0.28, mat(LINING, 1), bx, 0.04, bz, false); // dark lining
  box(0.55, 0.03, 0.3, bagMat, bx, 0.03, bz + 0.32); // lid folded back flat
  box(0.06, 0.04, 0.03, webMat, bx - 0.13, 0.28, bz + 0.16); // hinges
  box(0.06, 0.04, 0.03, webMat, bx + 0.13, 0.28, bz + 0.16);
  // Contents peeking over the rim: a gauze roll and a folded drape.
  cyl(0.04, 0.04, 0.3, mat(CREAM, 0.9), bx - 0.1, 0.16, bz - 0.04);
  box(0.18, 0.2, 0.12, mat(0x2e4a6b, 0.9), bx + 0.12, 0.13, bz + 0.02);
  // Carry handles arched across the opening.
  const handleGeo = new THREE.TorusGeometry(0.15, 0.014, 8, 20, Math.PI);
  for (const hx of [bx - 0.13, bx + 0.13]) {
    const handle = put(handleGeo, webMat, hx, 0.29, bz);
    handle.rotation.y = Math.PI / 2;
  }
  // Front straps with buckles, front pocket, end pocket.
  for (const sx of [bx - 0.13, bx + 0.13]) {
    box(0.05, 0.27, 0.014, webMat, sx, 0.16, bz - 0.177);
    box(0.056, 0.03, 0.018, mat(STEEL, 0.5), sx, 0.18, bz - 0.177);
  }
  box(0.3, 0.14, 0.06, darkMat, bx, 0.11, bz - 0.2);
  box(0.06, 0.14, 0.2, darkMat, bx + 0.305, 0.11, bz);
  // Reflective strip around all four walls.
  box(0.55, 0.035, 0.006, tapeMat, bx, 0.245, bz - 0.173, false);
  box(0.55, 0.035, 0.006, tapeMat, bx, 0.245, bz + 0.173, false);
  box(0.006, 0.035, 0.28, tapeMat, bx - 0.278, 0.245, bz, false);
  box(0.006, 0.035, 0.28, tapeMat, bx + 0.278, 0.245, bz, false);

  // - airway pouch: small closed bag behind the jump bag -
  current = "airway";
  box(0.42, 0.2, 0.26, darkMat, 1.18, 0.1, 1.45);
  box(0.43, 0.02, 0.27, webMat, 1.18, 0.19, 1.45); // lid seam
  const pouchHandle = put(new THREE.TorusGeometry(0.11, 0.012, 8, 18, Math.PI), webMat, 1.18, 0.2, 1.45);
  pouchHandle.rotation.y = Math.PI / 2;
  box(0.42, 0.03, 0.006, tapeMat, 1.18, 0.13, 1.318, false);

  // - drug box with a red cross on the lid -
  current = "drugs";
  const drugMat = mat(0xd8d8d8, 0.6);
  box(0.3, 0.1, 0.2, drugMat, 0.8, 0.05, 1.35);
  box(0.09, 0.006, 0.03, mat(CROSS_RED, 0.6), 0.8, 0.103, 1.35, false);
  box(0.03, 0.006, 0.09, mat(CROSS_RED, 0.6), 0.8, 0.103, 1.35, false);
  box(0.04, 0.03, 0.01, mat(STEEL, 0.5), 0.8, 0.06, 1.246);

  // - CAT tourniquet: strap loop, orange windlass, white time band -
  current = "cat";
  const catLoop = put(new THREE.TorusGeometry(0.055, 0.013, 8, 24), webMat, 0.85, DECK + 0.014, 0.75);
  catLoop.rotation.x = -Math.PI / 2;
  catLoop.scale.set(1, 0.62, 1);
  const windlass = cyl(0.011, 0.011, 0.11, mat(WINDLASS, 0.6), 0.85, DECK + 0.026, 0.75, 10);
  windlass.rotation.z = Math.PI / 2;
  box(0.05, 0.008, 0.028, mat(0xf0f0f0, 0.6), 0.85, DECK + 0.016, 0.712);

  // - Kerlix roll and hemostatic z-fold packet -
  current = "kerlix";
  const kerlix = cyl(0.035, 0.035, 0.1, mat(CREAM, 0.9), 0.85, DECK + 0.035, 0.98);
  kerlix.rotation.z = Math.PI / 2;
  current = "zfold";
  const packet = box(0.16, 0.025, 0.11, mat(PACKET_TAN, 0.9), 0.98, DECK + 0.013, 0.64);
  packet.rotation.y = 0.3;
  const packetStripe = box(0.16, 0.027, 0.03, mat(CROSS_RED, 0.8), 0.98, DECK + 0.013, 0.64);
  packetStripe.rotation.y = 0.3;

  // - pressure dressing: elastic roll, flat pad, pressure bar -
  current = "dressing";
  const wrapRoll = cyl(0.045, 0.045, 0.09, mat(CREAM, 0.9), 0.9, DECK + 0.045, 1.52);
  wrapRoll.rotation.z = Math.PI / 2;
  box(0.14, 0.02, 0.1, mat(CREAM, 0.9), 0.74, DECK + 0.01, 1.52);
  box(0.03, 0.024, 0.104, mat(0x6a6f75, 0.7), 0.74, DECK + 0.012, 1.52);

  // - glove pair: palms, fingers, thumbs and cuffs, purple nitrile -
  current = "gloves";
  const gloveMat = mat(GLOVE, 0.55);
  for (const side of [-1, 1] as const) {
    const gx = 0.775 + side * 0.04;
    const glove = new THREE.Group();
    glove.userData["kitItem"] = "gloves";
    glove.position.set(gx, 0, 0.63);
    glove.rotation.y = side * 0.15;
    kit.add(glove);
    function gloveBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gloveMat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      glove.add(mesh);
      return mesh;
    }
    gloveBox(0.07, 0.012, 0.075, 0, DECK + 0.006, 0); // palm
    for (const fx of [-0.024, -0.008, 0.008, 0.024]) {
      gloveBox(0.013, 0.01, 0.05, fx, DECK + 0.005, 0.062); // fingers
    }
    const thumb = gloveBox(0.013, 0.01, 0.04, side * 0.045, DECK + 0.005, 0.01);
    thumb.rotation.y = side * 0.6;
    gloveBox(0.075, 0.014, 0.03, 0, DECK + 0.007, -0.05); // cuff
  }

  // - O2 D cylinder with valve, regulator and gauge -
  current = "o2";
  const o2Mat = mat(O2_GREEN, 0.5);
  cyl(0.05, 0.05, 0.3, o2Mat, 1.62, DECK + 0.15, 1.12);
  cyl(0.018, 0.05, 0.05, o2Mat, 1.62, DECK + 0.325, 1.12);
  cyl(0.012, 0.012, 0.05, mat(STEEL, 0.4), 1.62, DECK + 0.375, 1.12, 10);
  box(0.05, 0.04, 0.04, mat(0x3a3d42, 0.6), 1.585, DECK + 0.363, 1.12);
  cyl(0.016, 0.016, 0.008, mat(0xf0f0f0, 0.5), 1.585, DECK + 0.387, 1.12, 12);

  // - non-rebreather: clear cup, strap, green reservoir bag, O2 line -
  current = "nrb";
  const clearMat = new THREE.MeshStandardMaterial({
    color: 0xe8f0f2,
    transparent: true,
    opacity: 0.55,
    roughness: 0.3,
    metalness: 0,
    side: THREE.DoubleSide
  });
  put(new THREE.CylinderGeometry(0.028, 0.058, 0.06, 16, 1, true), clearMat, 1.62, DECK + 0.03, 0.63, false);
  const maskRim = put(new THREE.TorusGeometry(0.058, 0.006, 8, 20), mat(0xdfe4e8, 0.5), 1.62, DECK + 0.006, 0.63);
  maskRim.rotation.x = -Math.PI / 2;
  cyl(0.012, 0.012, 0.03, o2Mat, 1.62, DECK + 0.07, 0.63, 10);
  const maskStrap = put(new THREE.TorusGeometry(0.06, 0.005, 8, 18, Math.PI), webMat, 1.62, DECK + 0.04, 0.63);
  maskStrap.rotation.y = Math.PI / 2;
  const reservoir = put(
    new THREE.SphereGeometry(0.05, 16, 12),
    new THREE.MeshStandardMaterial({
      color: O2_GREEN,
      transparent: true,
      opacity: 0.75,
      roughness: 0.5,
      metalness: 0
    }),
    1.5,
    DECK + 0.062,
    0.7,
    false
  );
  reservoir.scale.set(1, 1.25, 1);
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0x9fd8b4,
    transparent: true,
    opacity: 0.85,
    roughness: 0.4,
    metalness: 0
  });
  tube(
    [
      [1.6, 0.36, 1.1],
      [1.66, 0.1, 0.95],
      [1.66, 0.025, 0.78],
      [1.62, 0.05, 0.66]
    ],
    0.006,
    lineMat
  );

  // - NS bag flat on the tarp: bag, label, port, drip chamber, coiled line.
  //   The line ends well short of the patient: staged, not connected. -
  current = "ns";
  const ivMat = new THREE.MeshStandardMaterial({
    color: 0xdce8ec,
    transparent: true,
    opacity: 0.85,
    roughness: 0.25,
    metalness: 0
  });
  box(0.16, 0.028, 0.22, ivMat, 0.68, DECK + 0.014, 1.1, false);
  box(0.1, 0.03, 0.12, mat(0xf4f6f8, 0.5), 0.68, DECK + 0.015, 1.1, false);
  const port = cyl(0.01, 0.01, 0.03, mat(0x2e6fb0, 0.5), 0.68, DECK + 0.014, 1.225, 10);
  port.rotation.x = Math.PI / 2;
  cyl(0.012, 0.012, 0.06, clearMat, 0.68, DECK + 0.03, 1.24, 10).castShadow = false;
  tube(
    [
      [0.68, 0.02, 1.26],
      [0.62, 0.016, 1.05],
      [0.57, 0.016, 0.85],
      [0.52, 0.016, 0.68]
    ],
    0.005,
    lineMat
  );

  // - hypothermia blanket, folded stack with a gold edge showing -
  current = "blanket";
  const foilMat = new THREE.MeshStandardMaterial({
    color: 0xdde2e8,
    roughness: 0.45,
    metalness: 0.35,
    emissive: 0x33373d,
    emissiveIntensity: 1
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd8b13a,
    roughness: 0.45,
    metalness: 0.4,
    emissive: 0x3a2f12,
    emissiveIntensity: 1
  });
  box(0.28, 0.018, 0.22, foilMat, 1.3, DECK + 0.009, 0.42);
  const foldB = box(0.28, 0.018, 0.22, foilMat, 1.295, DECK + 0.027, 0.415);
  foldB.rotation.y = 0.04;
  const foldC = box(0.28, 0.018, 0.22, foilMat, 1.305, DECK + 0.045, 0.425);
  foldC.rotation.y = -0.05;
  box(0.28, 0.019, 0.025, goldMat, 1.3, DECK + 0.027, 0.517, false);

  return kit;
}
