// Procedural shark NPC model. Faces +z in local space; about 4.5 m long.
import * as THREE from 'three';

function std(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra }); }
function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }
function finShape(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export class Shark {
  constructor() {
    this.group = new THREE.Group();
    this.root = new THREE.Group();
    this.group.add(this.root);
    this.skin = std(0x7d8aa0);
    this.finMat = std(0x6b788e, { side: THREE.DoubleSide });
    this.time = Math.random() * 10;
    this.phase = 0;
    this.smoothSpeed = 0;
    this.pitch = 0;
    this.jaw = 0;
    this.flash = 0;
    this.deadRoll = 0;
    this.#build();
  }

  #build() {
    const r = this.root;
    this.body = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), this.skin));
    this.body.scale.set(0.55, 0.65, 2.2);
    r.add(this.body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), std(0xe3e9f0));
    belly.scale.set(0.5, 0.5, 2.0);
    belly.position.y = -0.25;
    r.add(belly);

    // jaw with teeth
    this.jawGroup = new THREE.Group();
    this.jawGroup.position.set(0, -0.25, 1.35);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), std(0x5c2a3a));
    jaw.scale.set(1, 0.45, 1.3);
    jaw.position.set(0, -0.1, 0.25);
    this.jawGroup.add(jaw);
    for (let i = 0; i < 8; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), std(0xffffff));
      const a = (i / 7 - 0.5) * 1.9;
      tooth.position.set(Math.sin(a) * 0.36, 0.02, 0.25 + Math.cos(a) * 0.42);
      this.jawGroup.add(tooth);
    }
    r.add(this.jawGroup);
    for (let i = 0; i < 8; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), std(0xffffff));
      const a = (i / 7 - 0.5) * 1.9;
      tooth.position.set(Math.sin(a) * 0.36, -0.22, 1.6 + Math.cos(a) * 0.42);
      tooth.rotation.x = Math.PI;
      r.add(tooth);
    }

    // eyes
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), std(0x111118, { roughness: 0.3 }));
      eye.position.set(sx * 0.42, 0.18, 1.3);
      r.add(eye);
    }
    // gills
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      const gill = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.35, 0.05), std(0x55627a));
      gill.position.set(sx * 0.53, 0.05, 0.55 - i * 0.14);
      gill.rotation.z = sx * 0.1;
      r.add(gill);
    }

    // dorsal fin
    const dorsalGeo = finShape([[0.5, 0], [0.1, 1.0], [-0.5, 0.75], [-0.7, 0]]);
    dorsalGeo.rotateY(-Math.PI / 2);
    const dorsal = shadowed(new THREE.Mesh(dorsalGeo, this.finMat));
    dorsal.position.set(0, 0.6, 0.1);
    r.add(dorsal);

    // pectoral fins
    for (const sx of [-1, 1]) {
      const geo = finShape([[0, 0], [1.1, -0.35], [1.25, -0.75], [0.35, -0.5]]);
      if (sx < 0) geo.scale(-1, 1, 1);
      geo.rotateX(Math.PI / 2); // lie flat, sweeping back
      const fin = shadowed(new THREE.Mesh(geo, this.finMat));
      fin.position.set(sx * 0.45, -0.15, 0.6);
      fin.rotation.z = sx * -0.35;
      r.add(fin);
    }

    // tail
    this.tail = new THREE.Group();
    this.tail.position.z = -2.0;
    const tailGeo = finShape([[0, 0], [-0.9, 1.1], [-0.55, 0.1], [-0.75, -0.7]]);
    tailGeo.rotateY(-Math.PI / 2);
    const tailMesh = shadowed(new THREE.Mesh(tailGeo, this.finMat));
    this.tail.add(tailMesh);
    const stalk = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), this.skin);
    stalk.scale.set(0.7, 0.8, 1.6);
    stalk.position.z = 0.2;
    this.tail.add(stalk);
    r.add(this.tail);
  }

  hitFlash() { this.flash = 1; }

  /** @param {{speed:number, vy:number, biting:boolean, dead:boolean}} s */
  update(dt, s) {
    this.time += dt;
    const t = this.time;
    const k = 1 - Math.exp(-dt * 6);
    this.smoothSpeed += (s.speed - this.smoothSpeed) * k;
    const run = Math.min(this.smoothSpeed / 6, 1.4);
    this.phase += dt * (2.2 + this.smoothSpeed * 1.1);
    this.tail.rotation.y = Math.sin(this.phase) * (0.25 + 0.3 * run);
    this.root.rotation.y = Math.sin(this.phase) * 0.05 * run;

    const targetPitch = -Math.atan2(s.vy, Math.max(s.speed, 1.5)) * 0.8;
    this.pitch += (targetPitch - this.pitch) * k;
    this.root.rotation.x = this.pitch;

    this.jaw += (((s.biting ? 0.75 : 0.08) + Math.sin(t * 2) * 0.03) - this.jaw) * (1 - Math.exp(-dt * 12));
    this.jawGroup.rotation.x = this.jaw;

    this.deadRoll += ((s.dead ? Math.PI : 0) - this.deadRoll) * (1 - Math.exp(-dt * 3));
    this.root.rotation.z = this.deadRoll + Math.sin(t * 0.9) * 0.03;

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4);
      this.skin.emissive.setRGB(this.flash, this.flash * 0.15, this.flash * 0.1);
    }
  }
}
