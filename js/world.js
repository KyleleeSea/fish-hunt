// Builds the pastel reef and its collision boxes.
import * as THREE from 'three';
import { ARENA } from './physics.js';

export const colliders = [];    // physics boxes { min, max }
export const camBlockers = [];  // boxes the camera must not sit behind
export const hideVolumes = [];  // kelp/coral volumes that fade when you are inside { box, mats }

const materials = new Map();
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra }));
  return materials.get(key);
}
function mesh(geo, color, extra) {
  const m = new THREE.Mesh(geo, mat(color, extra));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function box(w, h, d, color, extra) { return mesh(new THREE.BoxGeometry(w, h, d), color, extra); }

export function collider(cx, y0, cz, w, h, d, opts = {}) {
  const c = { min: new THREE.Vector3(cx - w / 2, y0, cz - d / 2), max: new THREE.Vector3(cx + w / 2, y0 + h, cz + d / 2) };
  if (!opts.cameraOnly) colliders.push(c);
  camBlockers.push(c);
  return c;
}

const animated = []; // { update(t, dt) }
const CORAL = [0xf27d9d, 0xf8a35d, 0xb48ee6, 0x62d3c9, 0xfbe56a, 0xff6f91];

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x1f7cb6);
  scene.fog = new THREE.Fog(0x1f7cb6, 8, 75);

  scene.add(new THREE.HemisphereLight(0xa8e0ff, 0x1b4f72, 1.0));
  const sun = new THREE.DirectionalLight(0xd8f4ff, 1.5);
  sun.position.set(10, 40, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 5; sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42; sun.shadow.camera.top = 42; sun.shadow.camera.bottom = -42;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // sand
  const sand = mesh(new THREE.PlaneGeometry(260, 260), 0xe6d7a6);
  sand.rotation.x = -Math.PI / 2;
  sand.castShadow = false;
  scene.add(sand);
  for (let i = 0; i < 24; i++) {
    const ripple = mesh(new THREE.PlaneGeometry(1.6 + Math.random() * 3, 0.35), 0xd9c995);
    ripple.rotation.x = -Math.PI / 2;
    ripple.rotation.z = Math.random() * 0.6 - 0.3;
    ripple.position.set((Math.random() - 0.5) * 66, 0.01, (Math.random() - 0.5) * 66);
    ripple.castShadow = false;
    scene.add(ripple);
  }

  // surface, seen from below
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(300, 300, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xbfeeff, roughness: 0.2, side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false }));
  surface.rotation.x = Math.PI / 2;
  surface.position.y = ARENA.surface + 0.3;
  scene.add(surface);

  // light shafts
  const shaftMat = new THREE.MeshBasicMaterial({ color: 0xcdf3ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  for (let i = 0; i < 9; i++) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.6 + Math.random(), 2.5 + Math.random() * 2, 20, 8, 1, true), shaftMat);
    shaft.position.set((Math.random() - 0.5) * 60, ARENA.surface - 8, (Math.random() - 0.5) * 60);
    shaft.rotation.z = (Math.random() - 0.5) * 0.25;
    shaft.userData.phase = Math.random() * 10;
    scene.add(shaft);
    animated.push({ update(t) { shaft.material.opacity = 0.05 + Math.sin(t * 0.7 + shaft.userData.phase) * 0.025; } });
  }

  addBubbles(scene);

  // ---- structures ----
  addWreck(scene, -14, -10, 0.35);
  addCave(scene, 16, 14, 0);
  addCave(scene, -20, 18, Math.PI / 2);
  addArch(scene, 10, -16);
  addTreasure(scene, 20, -22);

  // rock formations
  const rocks = [
    [-26, -24, 2.4], [24, 4, 2.0], [-6, 22, 2.2], [2, -26, 1.8], [-30, 4, 1.6], [28, -10, 1.9], [6, 6, 1.4], [-10, 6, 1.2],
    [14, 26, 1.7], [-24, -6, 1.3], [30, 24, 2.2], [-30, 30, 2.0], [30, -30, 2.0], [-30, -30, 1.8],
  ];
  for (const [x, z, s] of rocks) addRock(scene, x, z, s);
  for (const [x, z, h] of [[-4, -4, 7], [22, 20, 6], [-16, 2, 5], [8, 22, 8], [-28, 14, 6]]) addPillar(scene, x, z, h);

  // kelp forests (hide inside)
  for (const [x, z, r, n] of [[-6, -20, 5, 22], [22, -6, 4, 16], [-26, 24, 5, 20], [4, 14, 4, 16], [-18, -28, 4, 14], [28, 28, 3, 10]]) addKelp(scene, x, z, r, n);

  // coral gardens
  for (const [x, z] of [[-12, -2], [14, -4], [0, 26], [-22, 8], [24, 12], [6, -8], [-8, 14], [18, -26], [-28, -14], [12, 10], [-16, 26], [26, -20], [0, -14]]) addCoralCluster(scene, x, z);
  for (const [x, z] of [[-2, 8], [18, 2], [-24, -18], [10, -24], [-12, 20]]) addTableCoral(scene, x, z);

  // more places to hide
  addPipe(scene, -24, -2, 0);
  addPipe(scene, 12, 18, Math.PI / 2);
  addClam(scene, -14, 14);
  addClam(scene, 26, -14);
  addClam(scene, 2, -30);
  addRowboat(scene, 20, -2);
  addRowboat(scene, -30, -20);
  addBarrels(scene, -8, -14);
  addBarrels(scene, 8, 26);
  addBarrels(scene, 30, 10);
  addCave(scene, 6, 30, Math.PI / 2);
  for (const [x, z, r, n] of [[-30, -8, 3, 10], [16, 30, 3.5, 12], [30, -4, 3, 10]]) addKelp(scene, x, z, r, n);
  for (const [x, z, r] of [[-20, -22, 4], [14, -14, 3.5], [-2, 18, 3.5], [24, 22, 3], [-12, 28, 3], [28, -28, 3]]) addSeagrass(scene, x, z, r);

  addSchools(scene);
  addStarfishAndShells(scene);

  return { colliders, camBlockers, hideVolumes };
}

export function updateWorld(t, dt) {
  for (const a of animated) a.update(t, dt);
}

// -------------------------------------------------------------------------
function addBubbles(scene) {
  const n = 400;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 80;
    pos[i * 3 + 1] = Math.random() * ARENA.surface;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xdff6ff, size: 0.12, transparent: true, opacity: 0.6, sizeAttenuation: true }));
  scene.add(pts);
  animated.push({
    update(t, dt) {
      const p = geo.attributes.position.array;
      for (let i = 0; i < n; i++) {
        p[i * 3 + 1] += dt * (0.5 + (i % 5) * 0.15);
        p[i * 3] += Math.sin(t * 1.3 + i) * dt * 0.2;
        if (p[i * 3 + 1] > ARENA.surface) p[i * 3 + 1] = 0.2;
      }
      geo.attributes.position.needsUpdate = true;
    },
  });
}

function addRock(scene, x, z, s) {
  const r = mesh(new THREE.DodecahedronGeometry(s, 1), 0x6b7f9a, { flatShading: true });
  r.position.set(x, s * 0.55, z);
  r.scale.set(1.3, 0.8, 1.1);
  r.rotation.set(Math.random(), Math.random(), Math.random() * 0.3);
  scene.add(r);
  collider(x, 0, z, s * 2.1, s * 1.25, s * 1.8);
}

function addPillar(scene, x, z, h) {
  const r = mesh(new THREE.CylinderGeometry(1.2, 1.7, h, 8), 0x5f738f, { flatShading: true });
  r.position.set(x, h / 2, z);
  scene.add(r);
  const cap = mesh(new THREE.DodecahedronGeometry(1.5, 0), 0x6b7f9a, { flatShading: true });
  cap.position.set(x, h, z);
  cap.scale.set(1.2, 0.6, 1.2);
  scene.add(cap);
  collider(x, 0, z, 2.8, h + 0.6, 2.8);
  // anemone on top
  addAnemone(scene, x + 0.4, h + 0.6, z - 0.3, 0.6);
}

function addArch(scene, x, z) {
  for (const sx of [-1, 1]) {
    const leg = mesh(new THREE.CylinderGeometry(1.1, 1.4, 5, 8), 0x5f738f, { flatShading: true });
    leg.position.set(x + sx * 3.2, 2.5, z);
    scene.add(leg);
    collider(x + sx * 3.2, 0, z, 2.4, 5, 2.4);
  }
  const top = mesh(new THREE.BoxGeometry(9, 1.6, 2.6), 0x6b7f9a, { flatShading: true });
  top.position.set(x, 5.4, z);
  scene.add(top);
  collider(x, 4.6, z, 9, 1.6, 2.6);
}

function addCave(scene, x, z, yaw) {
  // a hollow boulder: three walls + roof, open on one side (-z before rotation)
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const w = 7, h = 4, d = 7;
  const rockMat = { flatShading: true };
  const shell = mesh(new THREE.DodecahedronGeometry(5.2, 1), 0x5f738f, rockMat);
  shell.scale.set(1, 0.75, 1);
  shell.position.y = 1.2;
  g.add(shell);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(w - 1.2, h - 0.6, d), new THREE.MeshStandardMaterial({ color: 0x2b3648, side: THREE.BackSide, roughness: 1 }));
  inner.position.set(0, (h - 0.6) / 2, -0.6);
  g.add(inner);
  const opening = new THREE.Mesh(new THREE.BoxGeometry(w - 1.6, h - 1, 2.6), new THREE.MeshStandardMaterial({ color: 0x1b2433, side: THREE.BackSide, roughness: 1 }));
  opening.position.set(0, (h - 1) / 2, -d / 2 - 0.2);
  g.add(opening);
  scene.add(g);
  // colliders computed in world space for yaw 0 or 90°
  const rot = Math.abs(Math.sin(yaw)) > 0.5;
  const parts = [
    [0, 0, d / 2, w, h, 1.2],          // back
    [-w / 2 + 0.3, 0, 0, 1.2, h, d],   // left
    [w / 2 - 0.3, 0, 0, 1.2, h, d],    // right
    [0, h - 0.6, 0, w, 1.4, d],        // roof
  ];
  for (const [px, py, pz, pw, ph, pd] of parts) {
    if (rot) collider(x + pz, py, z - px, pd, ph, pw);
    else collider(x + px, py, z + pz, pw, ph, pd);
  }
  if (rot) g.rotation.y = yaw;
  addAnemone(scene, x + (rot ? -4.2 : 0.5), 0, z + (rot ? 0.5 : -4.2), 0.9);
}

function addWreck(scene, x, z, yaw) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const L = 16, W = 6, H = 4;
  const hullMat = 0x8a5a3c, trim = 0x5e3a24;
  // hull floor + walls, open bow section for swimming in
  const floor = box(L, 0.5, W, hullMat); floor.position.y = 0.25; g.add(floor);
  for (const sz of [-1, 1]) {
    const wall = box(L, H, 0.5, hullMat); wall.position.set(0, H / 2, sz * (W / 2 - 0.25)); g.add(wall);
  }
  const stern = box(0.5, H + 1.5, W + 0.4, trim); stern.position.set(L / 2 - 0.25, (H + 1.5) / 2, 0); g.add(stern);
  const deckA = box(L * 0.45, 0.4, W, trim); deckA.position.set(L * 0.275, H, 0); g.add(deckA);
  const deckB = box(L * 0.25, 0.4, W, trim); deckB.position.set(-L * 0.375, H, 0); g.add(deckB);
  const mast = mesh(new THREE.CylinderGeometry(0.25, 0.35, 11, 8), trim); mast.position.set(2, H + 5, 0); g.add(mast);
  const yard = box(7, 0.25, 0.25, trim); yard.position.set(2, H + 8, 0); g.add(yard);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 4), new THREE.MeshStandardMaterial({ color: 0xe9e2cf, side: THREE.DoubleSide, roughness: 1 }));
  sail.position.set(2, H + 5.8, 0.05); sail.rotation.y = 0.1; g.add(sail);
  const bow = mesh(new THREE.ConeGeometry(W / 2, 4, 4), hullMat); bow.rotation.z = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(-L / 2 - 1.5, H / 2, 0); g.add(bow);
  const wheel = mesh(new THREE.TorusGeometry(0.6, 0.08, 8, 12), trim); wheel.position.set(5, H + 1.2, 0); wheel.rotation.y = Math.PI / 2; g.add(wheel);
  for (let i = 0; i < 4; i++) {
    const port = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.6, 10), 0x7fd0e8, { roughness: 0.3 });
    port.rotation.x = Math.PI / 2; port.position.set(-5 + i * 3.5, 2.2, W / 2); g.add(port);
  }
  // barnacles / coral growth
  for (let i = 0; i < 8; i++) {
    const c = mesh(new THREE.SphereGeometry(0.35 + Math.random() * 0.4, 8, 6), CORAL[i % CORAL.length]);
    c.position.set(-L / 2 + Math.random() * L, 0.2 + Math.random() * 4, (Math.random() > 0.5 ? 1 : -1) * W / 2);
    g.add(c);
  }
  g.rotation.y = yaw;
  g.rotation.z = -0.06;
  scene.add(g);
  // colliders approximate the hull un-rotated (yaw is small)
  collider(x, 0, z, L, 0.5, W);
  collider(x, 0, z - W / 2 + 0.25, L, H, 0.5);
  collider(x, 0, z + W / 2 - 0.25, L, H, 0.5);
  collider(x + L / 2, 0, z, 0.5, H + 1.5, W);
  collider(x + L * 0.275, H - 0.2, z, L * 0.45, 0.4, W);
  collider(x - L * 0.375, H - 0.2, z, L * 0.25, 0.4, W);
  collider(x + 2, H, z, 0.6, 11, 0.6);
}

function addTreasure(scene, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const chest = box(1.6, 1.0, 1.0, 0x8a5a3c); chest.position.y = 0.5; g.add(chest);
  const lid = box(1.6, 0.5, 1.0, 0x6e4530); lid.position.set(0, 1.15, -0.3); lid.rotation.x = -0.9; g.add(lid);
  for (let i = 0; i < 14; i++) {
    const coin = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 8), 0xfbd260, { roughness: 0.3, metalness: 0.4 });
    coin.position.set((Math.random() - 0.5) * 1.3, 1.0 + Math.random() * 0.25, (Math.random() - 0.5) * 0.7);
    coin.rotation.set(Math.random(), Math.random(), 0);
    g.add(coin);
  }
  for (const band of [-0.5, 0.5]) { const b = box(0.1, 1.05, 1.05, 0xd9b45a, { metalness: 0.3 }); b.position.set(band, 0.5, 0); g.add(b); }
  scene.add(g);
  collider(x, 0, z, 1.6, 1.0, 1.0);
}

function addKelp(scene, cx, cz, radius, count) {
  const greens = [0x3f9a5e, 0x4caf6e, 0x2f8a52, 0x5cbf7a];
  const mats = greens.map(c => mat(c).clone());
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const segs = 6 + Math.floor(Math.random() * 4);
    const segLen = 1.3 + Math.random() * 0.5;
    const m = mats[k % mats.length];
    let parent = new THREE.Group();
    parent.position.set(x, 0, z);
    parent.rotation.y = Math.random() * Math.PI;
    scene.add(parent);
    const joints = [];
    for (let i = 0; i < segs; i++) {
      const j = new THREE.Group();
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.16 - i * 0.012, segLen, 3, 6), m);
      seg.position.y = segLen / 2;
      seg.castShadow = true;
      j.add(seg);
      if (i % 2 === 1) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), m);
        leaf.scale.set(0.25, 1, 1.2);
        leaf.position.set(0.35 * (i % 4 === 1 ? 1 : -1), segLen * 0.5, 0);
        leaf.rotation.z = 0.5 * (i % 4 === 1 ? -1 : 1);
        j.add(leaf);
      }
      parent.add(j);
      const next = new THREE.Group();
      next.position.y = segLen;
      j.add(next);
      joints.push(j);
      parent = next;
    }
    const phase = Math.random() * 10;
    animated.push({
      update(t) {
        for (let i = 0; i < joints.length; i++) {
          joints[i].rotation.x = Math.sin(t * 0.9 + phase + i * 0.5) * 0.09 + 0.04;
          joints[i].rotation.z = Math.cos(t * 0.7 + phase + i * 0.4) * 0.07;
        }
      },
    });
  }
  hideVolumes.push({
    box: { min: new THREE.Vector3(cx - radius - 0.5, 0, cz - radius - 0.5), max: new THREE.Vector3(cx + radius + 0.5, 11, cz + radius + 0.5) },
    mats,
  });
}

function addPipe(scene, x, z, yaw) {
  // a rusty open pipe lying on the sand — swim through it or hide inside
  const R = 1.25, L = 6.5;
  const g = new THREE.Group();
  g.position.set(x, R - 0.1, z);
  g.rotation.y = yaw;
  const outer = mesh(new THREE.CylinderGeometry(R, R, L, 18, 1, true), 0x8a7a6a);
  outer.rotation.z = Math.PI / 2;
  g.add(outer);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.12, R - 0.12, L, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a3430, side: THREE.BackSide, roughness: 1 }));
  inner.rotation.z = Math.PI / 2;
  g.add(inner);
  for (const sx of [-1, 1]) {
    const rim = mesh(new THREE.TorusGeometry(R, 0.1, 8, 24), 0xa36a3a);
    rim.rotation.y = Math.PI / 2;
    rim.position.x = sx * L / 2;
    g.add(rim);
  }
  for (let i = 0; i < 5; i++) {
    const rust = mesh(new THREE.SphereGeometry(0.3 + Math.random() * 0.3, 7, 5), 0xa36a3a);
    const a = Math.random() * Math.PI * 2;
    rust.position.set((Math.random() - 0.5) * L, Math.cos(a) * R, Math.sin(a) * R);
    rust.scale.y = 0.4;
    g.add(rust);
  }
  scene.add(g);
  const along = Math.abs(Math.sin(yaw)) > 0.5; // pipe runs along z instead of x
  const wall = (cx, cz, w, d) => collider(cx, 0, cz, w, 2 * R - 0.1, d);
  if (!along) { wall(x, z - R + 0.1, L, 0.4); wall(x, z + R - 0.1, L, 0.4); collider(x, 2 * R - 0.55, z, L, 0.5, 2 * R); }
  else { wall(x - R + 0.1, z, 0.4, L); wall(x + R - 0.1, z, 0.4, L); collider(x, 2 * R - 0.55, z, 2 * R, 0.5, L); }
}

function addClam(scene, x, z) {
  // giant clam, open: swim in between the shells
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = Math.random() * Math.PI * 2;
  const shellMat = mat(0xd9c7b2, { flatShading: true });
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(1.9, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shellMat);
  bottom.scale.set(1, 0.45, 1);
  bottom.position.y = 0.85;
  bottom.castShadow = true; bottom.receiveShadow = true;
  g.add(bottom);
  const lip = mesh(new THREE.TorusGeometry(1.9, 0.12, 8, 24), 0xcbb59a);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.85;
  g.add(lip);
  const flesh = mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.25, 20), 0xf27d9d);
  flesh.position.y = 0.8;
  g.add(flesh);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.9, -1.9);
  hinge.rotation.x = -1.15;
  const top = new THREE.Mesh(new THREE.SphereGeometry(1.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
  top.scale.set(1, 0.45, 1);
  top.position.set(0, 0, 1.9);
  top.castShadow = true;
  hinge.add(top);
  g.add(hinge);
  for (let i = 0; i < 8; i++) {
    const ridge = mesh(new THREE.BoxGeometry(0.1, 0.1, 3.6), 0xcbb59a);
    ridge.rotation.y = (i / 8) * Math.PI;
    ridge.position.y = 0.2;
    ridge.scale.y = 0.5;
    g.add(ridge);
  }
  scene.add(g);
  collider(x, 0, z, 3.4, 0.85, 3.4);                       // sit on the bottom shell
  collider(x, 2.4, z, 3.6, 2.0, 3.6, { cameraOnly: true }); // top shell shades the camera
}

function addRowboat(scene, x, z) {
  // an upturned rowboat propped on rocks — hide underneath
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const hull = mesh(new THREE.BoxGeometry(5, 1.1, 2.2), 0x7f5236);
  hull.position.y = 1.9;
  g.add(hull);
  const bow = mesh(new THREE.ConeGeometry(1.1, 1.6, 4), 0x7f5236);
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.x = Math.PI / 4;
  bow.position.set(3.2, 1.9, 0);
  bow.scale.y = 1;
  g.add(bow);
  const keel = mesh(new THREE.BoxGeometry(5.6, 0.14, 0.2), 0x5c3a24);
  keel.position.y = 2.5;
  g.add(keel);
  for (const sz of [-1, 1]) {
    const plank = mesh(new THREE.BoxGeometry(5.2, 0.08, 0.1), 0x9a6a46);
    plank.position.set(0, 2.1, sz * 1.1);
    g.add(plank);
  }
  for (const [rx, rz] of [[-1.8, 0.4], [1.9, -0.5]]) {
    const rock = mesh(new THREE.DodecahedronGeometry(0.8, 0), 0x6b7f9a, { flatShading: true });
    rock.position.set(rx, 0.6, rz);
    rock.scale.set(1, 1.2, 1);
    g.add(rock);
    collider(x + rx, 0, z + rz, 1.4, 1.4, 1.4);
  }
  scene.add(g);
  collider(x, 1.35, z, 5.4, 1.2, 2.2);
}

function addBarrels(scene, x, z) {
  const colors = [0x7f5236, 0x5c3a24, 0x8a6a4a];
  const spots = [[0, 0, true], [1.1, 0.3, true], [0.5, 1.2, true], [-1.0, 0.9, false], [1.7, -0.9, false], [-0.9, -1.0, true]];
  spots.forEach(([dx, dz, standing], i) => {
    const barrel = mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12), colors[i % colors.length]);
    const bx = x + dx * 1.3, bz = z + dz * 1.3;
    if (standing) { barrel.position.set(bx, 0.55, bz); collider(bx, 0, bz, 1.0, 1.1, 1.0); }
    else { barrel.rotation.z = Math.PI / 2; barrel.rotation.y = i; barrel.position.set(bx, 0.5, bz); collider(bx, 0, bz, 1.1, 1.0, 1.1); }
    scene.add(barrel);
    for (const yy of [-0.35, 0.35]) {
      const band = mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 16), 0x4a4a52);
      band.rotation.x = Math.PI / 2;
      band.position.y = yy;
      barrel.add(band);
    }
  });
}

function addSeagrass(scene, cx, cz, radius) {
  const m = mat(0x5fbf7a).clone();
  const blades = [];
  const n = Math.floor(radius * radius * 2.2);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
    const h = 1.6 + Math.random() * 1.4;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.12, h, 4), m);
    blade.position.set(cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r);
    blade.rotation.y = Math.random() * Math.PI;
    blade.userData.ph = Math.random() * 6;
    blade.castShadow = true;
    scene.add(blade);
    blades.push(blade);
  }
  animated.push({ update(t) { for (const b of blades) { b.rotation.x = Math.sin(t * 1.1 + b.userData.ph) * 0.12; b.rotation.z = Math.cos(t * 0.8 + b.userData.ph) * 0.1; } } });
  hideVolumes.push({ box: { min: new THREE.Vector3(cx - radius - 0.4, 0, cz - radius - 0.4), max: new THREE.Vector3(cx + radius + 0.4, 3.2, cz + radius + 0.4) }, mats: [m] });
}

function addCoralCluster(scene, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = Math.random() * Math.PI * 2;
  const n = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const c = CORAL[Math.abs(i + Math.floor(x + z)) % CORAL.length];
    const px = (Math.random() - 0.5) * 4, pz = (Math.random() - 0.5) * 4;
    const kind = i % 4;
    if (kind === 0) { // brain coral
      const b = mesh(new THREE.SphereGeometry(0.8 + Math.random() * 0.6, 10, 8), c);
      b.scale.y = 0.7; b.position.set(px, 0.3, pz); g.add(b);
    } else if (kind === 1) { // branching
      for (let k = 0; k < 5; k++) {
        const br = mesh(new THREE.ConeGeometry(0.16, 1.4 + Math.random(), 6), c);
        br.position.set(px + (Math.random() - 0.5) * 0.8, 0.7, pz + (Math.random() - 0.5) * 0.8);
        br.rotation.set((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7);
        g.add(br);
      }
    } else if (kind === 2) { // tube coral
      for (let k = 0; k < 4; k++) {
        const h = 0.6 + Math.random() * 1.2;
        const tube = mesh(new THREE.CylinderGeometry(0.22, 0.28, h, 8, 1, true), c, { side: THREE.DoubleSide });
        tube.position.set(px + (Math.random() - 0.5) * 0.9, h / 2, pz + (Math.random() - 0.5) * 0.9);
        g.add(tube);
      }
    } else { // fan coral
      const fan = mesh(new THREE.CircleGeometry(1.1, 10, 0, Math.PI), c, { side: THREE.DoubleSide });
      fan.position.set(px, 0.1, pz); fan.rotation.y = Math.random() * Math.PI; g.add(fan);
    }
  }
  scene.add(g);
  const big = mesh(new THREE.SphereGeometry(1.3, 10, 8), CORAL[Math.floor(Math.abs(x * 7 + z)) % CORAL.length]);
  big.scale.y = 0.6; big.position.set(x + 2.2, 0.3, z - 1.5);
  scene.add(big);
  collider(x + 2.2, 0, z - 1.5, 2.2, 1.0, 2.2);
}

function addTableCoral(scene, x, z) {
  const c = CORAL[Math.floor(Math.abs(x * 3 + z * 5)) % CORAL.length];
  const stem = mesh(new THREE.CylinderGeometry(0.5, 0.8, 2.4, 8), c); stem.position.set(x, 1.2, z); scene.add(stem);
  const top = mesh(new THREE.CylinderGeometry(3.2, 2.6, 0.5, 12), c); top.position.set(x, 2.65, z); scene.add(top);
  for (let i = 0; i < 6; i++) {
    const bump = mesh(new THREE.SphereGeometry(0.3, 6, 5), c);
    const a = i / 6 * Math.PI * 2;
    bump.position.set(x + Math.cos(a) * 2.4, 2.95, z + Math.sin(a) * 2.4);
    scene.add(bump);
  }
  collider(x, 0, z, 1.2, 2.4, 1.2);
  collider(x, 2.4, z, 5.6, 0.5, 5.6);
}

function addAnemone(scene, x, y, z, s) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const c = [0xf27d9d, 0x62d3c9, 0xb48ee6][Math.floor(Math.abs(x + z)) % 3];
  const base = mesh(new THREE.CylinderGeometry(0.4 * s, 0.5 * s, 0.4 * s, 8), c); base.position.y = 0.2 * s; g.add(base);
  const tents = [];
  for (let i = 0; i < 14; i++) {
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.06 * s, 0.7 * s, 2, 5), mat(c));
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.3 * s;
    t.position.set(Math.cos(a) * r, 0.75 * s, Math.sin(a) * r);
    t.rotation.set((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8);
    t.userData.rx = t.rotation.x; t.userData.rz = t.rotation.z;
    g.add(t); tents.push(t);
  }
  scene.add(g);
  const phase = Math.random() * 10;
  animated.push({ update(t) { for (let i = 0; i < tents.length; i++) { tents[i].rotation.x = tents[i].userData.rx + Math.sin(t * 1.5 + phase + i) * 0.15; tents[i].rotation.z = tents[i].userData.rz + Math.cos(t * 1.2 + phase + i) * 0.15; } } });
}

function addSchools(scene) {
  const geo = new THREE.ConeGeometry(0.12, 0.45, 5);
  geo.rotateX(Math.PI / 2);
  const schools = [
    { c: [-10, 8, 10], r: 9, color: 0xfbe56a, n: 40, speed: 0.35 },
    { c: [16, 6, -12], r: 7, color: 0x7fd0e8, n: 30, speed: -0.45 },
    { c: [0, 12, 0], r: 14, color: 0xf8a35d, n: 50, speed: 0.25 },
  ];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (const sch of schools) {
    const inst = new THREE.InstancedMesh(geo, mat(sch.color), sch.n);
    scene.add(inst);
    const offs = [];
    for (let i = 0; i < sch.n; i++) offs.push([(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, Math.random() * 6]);
    animated.push({
      update(t) {
        for (let i = 0; i < sch.n; i++) {
          const a = t * sch.speed + i * 0.05;
          const [ox, oy, oz, ph] = offs[i];
          p.set(sch.c[0] + Math.cos(a) * sch.r + ox, sch.c[1] + oy + Math.sin(t + ph) * 0.4, sch.c[2] + Math.sin(a) * sch.r + oz);
          const heading = a + Math.PI / 2 * Math.sign(sch.speed);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
          m.compose(p, q, s);
          inst.setMatrixAt(i, m);
        }
        inst.instanceMatrix.needsUpdate = true;
      },
    });
  }
}

function addStarfishAndShells(scene) {
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const c = [0xf27d9d, 0xf8a35d, 0xb48ee6][i % 3];
    for (let k = 0; k < 5; k++) {
      const arm = box(0.7, 0.12, 0.2, c);
      arm.position.x = 0.3; arm.rotation.y = 0;
      const pivot = new THREE.Group();
      pivot.rotation.y = k / 5 * Math.PI * 2;
      pivot.add(arm); g.add(pivot);
    }
    g.position.set((Math.random() - 0.5) * 60, 0.08, (Math.random() - 0.5) * 60);
    scene.add(g);
  }
  for (let i = 0; i < 20; i++) {
    const shell = mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xfff1dc);
    shell.position.set((Math.random() - 0.5) * 64, 0.02, (Math.random() - 0.5) * 64);
    shell.scale.set(1, 0.6, 1.2);
    scene.add(shell);
  }
}
