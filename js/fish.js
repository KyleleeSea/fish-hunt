// Procedural low-poly fish with a gun. Faces +z in local space.
import * as THREE from 'three';

const PALETTE = {
  hider:  { body: 0xf28c38, fin: 0xf6b26b, accent: 0xffffff },
  seeker: { body: 0x3f7fd9, fin: 0xfbe56a, accent: 0x2a4f8f },
  none:   { body: 0x62d3c9, fin: 0x9fe8e0, accent: 0xffffff },
};

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}
function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }

function finShape(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export class Fish {
  constructor(role = null) {
    this.group = new THREE.Group();   // position + yaw
    this.root = new THREE.Group();    // pitch, roll, wiggle
    this.group.add(this.root);
    this.bodyMat = std(PALETTE.none.body);
    this.finMat = std(PALETTE.none.fin, { side: THREE.DoubleSide });
    this.accentMat = std(PALETTE.none.accent);
    this.time = Math.random() * 10;
    this.phase = 0;
    this.smoothSpeed = 0;
    this.pitch = 0;
    this.roll = 0;
    this.coverAmt = 0;
    this.flash = 0;
    this.#build();
    this.setRole(role);
  }

  #build() {
    const r = this.root;
    this.body = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), this.bodyMat));
    this.body.scale.set(0.5, 0.7, 1);
    r.add(this.body);

    // stripes (hider only; hidden otherwise)
    this.stripes = [];
    for (const z of [0.22, -0.18]) {
      const f = Math.sqrt(1 - (z / 0.6) ** 2);
      const s = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 24), this.accentMat);
      s.scale.set(0.3 * f * 1.03, 0.42 * f * 1.03, 1);
      s.position.z = z;
      r.add(s);
      this.stripes.push(s);
    }

    // tail
    this.tail = new THREE.Group();
    this.tail.position.z = -0.55;
    const tailGeo = finShape([[0, 0], [-0.55, 0.42], [-0.4, 0], [-0.55, -0.42]]);
    tailGeo.rotateY(-Math.PI / 2); // shape was in x/y; put it in z/y so -x points back (-z)
    const tailMesh = shadowed(new THREE.Mesh(tailGeo, this.finMat));
    this.tail.add(tailMesh);
    r.add(this.tail);

    // dorsal fin
    const dorsalGeo = finShape([[0.25, 0], [0.05, 0.38], [-0.25, 0.28], [-0.3, 0]]);
    dorsalGeo.rotateY(-Math.PI / 2);
    const dorsal = shadowed(new THREE.Mesh(dorsalGeo, this.finMat));
    dorsal.position.set(0, 0.38, -0.05);
    r.add(dorsal);

    // pectoral fins (pivot at the body side)
    this.fins = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * 0.26, -0.05, 0.18);
      const geo = finShape([[0, 0], [0.32, -0.12], [0.36, -0.3], [0.12, -0.26]]);
      if (sx < 0) geo.scale(-1, 1, 1);
      geo.rotateX(Math.PI / 2); // lie flat, sweeping back
      const fin = shadowed(new THREE.Mesh(geo, this.finMat));
      fin.rotation.z = sx * -0.25;
      g.add(fin);
      g.userData.side = sx;
      r.add(g);
      this.fins.push(g);
    }

    // eyes
    for (const sx of [-1, 1]) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), std(0xffffff, { roughness: 0.3 }));
      white.position.set(sx * 0.21, 0.12, 0.38);
      r.add(white);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0x1b1b24, { roughness: 0.3 }));
      pupil.position.set(sx * 0.25, 0.13, 0.46);
      r.add(pupil);
    }
    // lips
    const lips = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.035, 8, 14), std(0xf7b8a8));
    lips.position.set(0, -0.02, 0.6);
    r.add(lips);

    // gun strapped to the right side
    this.gun = new THREE.Group();
    this.gun.position.set(0.3, 0.05, 0.1);
    const gunMat = std(0x3a3f4a, { roughness: 0.5, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.3), gunMat);
    this.gun.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.5, 8), gunMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.35;
    this.gun.add(barrel);
    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.015, 6, 10), this.accentMat);
    muzzleRing.position.z = 0.59;
    this.gun.add(muzzleRing);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), gunMat);
    grip.position.set(0, -0.13, -0.05);
    this.gun.add(grip);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.z = 0.62;
    this.gun.add(this.muzzle);
    r.add(this.gun);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 24), std(0x4a3a2a));
    const sf = Math.sqrt(1 - (0.1 / 0.6) ** 2); // body is a 0.6 sphere scaled (0.5, 0.7, 1)
    strap.scale.set(0.3 * sf * 1.01, 0.42 * sf * 1.01, 1);
    strap.position.z = 0.1;
    r.add(strap);

    // muzzle flash
    this.flashMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 0 }));
    this.flashMesh.position.z = 0.64;
    this.gun.add(this.flashMesh);
  }

  setRole(role) {
    this.role = role;
    const p = PALETTE[role] || PALETTE.none;
    this.bodyMat.color.setHex(p.body);
    this.finMat.color.setHex(p.fin);
    this.accentMat.color.setHex(p.accent);
    for (const s of this.stripes) s.visible = role === 'hider';
  }

  /** World-space muzzle position and the gun's forward direction. */
  muzzleWorld(out = new THREE.Vector3()) {
    return this.muzzle.getWorldPosition(out);
  }

  fireFlash() { this.flashMesh.material.opacity = 1; this.flashMesh.scale.setScalar(1.4); }
  hurtFlash() { this.flash = 1; }

  /**
   * @param {number} dt
   * @param {{speed:number, vy:number, turn:number, cover:boolean, dead:boolean}} s
   */
  update(dt, s) {
    this.time += dt;
    const t = this.time;
    const k = 1 - Math.exp(-dt * 8);
    this.smoothSpeed += (s.speed - this.smoothSpeed) * k;
    const run = Math.min(this.smoothSpeed / 6, 1.5);
    this.phase += dt * (3.5 + this.smoothSpeed * 2.4);

    // pitch nose toward vertical motion, roll into turns
    const targetPitch = -Math.atan2(s.vy, Math.max(Math.hypot(s.speed, 0.001), 1.2)) * 0.9;
    this.pitch += (targetPitch - this.pitch) * k;
    const targetRoll = THREE.MathUtils.clamp(-s.turn * 0.18, -0.5, 0.5);
    this.roll += (targetRoll - this.roll) * k;
    this.root.rotation.x = this.pitch;
    this.root.rotation.z = this.roll + Math.sin(t * 1.1) * 0.03;
    this.root.rotation.y = Math.sin(this.phase) * 0.07 * run;
    this.root.position.y = Math.sin(t * 1.8) * 0.03;

    // tail and fins
    this.tail.rotation.y = Math.sin(this.phase) * (0.25 + 0.45 * run);
    this.coverAmt += ((s.cover ? 1 : 0) - this.coverAmt) * k;
    for (const f of this.fins) {
      const sx = f.userData.side;
      let rz = Math.sin(t * 3.2 + sx) * 0.35 * (0.4 + run) * -sx;
      let ry = 0;
      // cover eyes: fins swing forward and up over the face
      rz = THREE.MathUtils.lerp(rz, sx * 1.3, this.coverAmt);
      ry = THREE.MathUtils.lerp(ry, sx * -1.1, this.coverAmt);
      f.rotation.z = rz;
      f.rotation.y = ry;
      f.position.z = THREE.MathUtils.lerp(0.18, 0.42, this.coverAmt);
      f.position.y = THREE.MathUtils.lerp(-0.05, 0.12, this.coverAmt);
    }

    // dead: belly up
    const deadRoll = s.dead ? Math.PI : 0;
    this.root.rotation.z += deadRoll;

    // flashes
    this.flashMesh.material.opacity = Math.max(0, this.flashMesh.material.opacity - dt * 10);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3);
      this.bodyMat.emissive.setRGB(this.flash * 0.9, this.flash * 0.1, this.flash * 0.05);
    }
  }
}
