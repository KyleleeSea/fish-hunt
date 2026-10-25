// Procedural LeBron NPC: a blocky basketball player swimming freestyle, face down, facing +z.
import * as THREE from 'three';

const PURPLE = 0x552583, GOLD = 0xfdb927, SKIN = 0x6b4a33, DARK = 0x1d1410;

function std(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra }); }
function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }

function jerseyTexture(text, number) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#552583';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#fdb927';
  ctx.font = '700 44px Fredoka, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 70);
  ctx.font = '700 150px Fredoka, Arial, sans-serif';
  ctx.fillText(number, 128, 210);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class LeBron {
  constructor() {
    this.group = new THREE.Group();
    this.root = new THREE.Group();          // flips to horizontal swimming pose
    this.group.add(this.root);
    this.body = new THREE.Group();          // built upright
    this.root.add(this.body);
    this.skin = std(SKIN);
    this.jersey = std(PURPLE);
    this.time = Math.random() * 10;
    this.phase = Math.random() * 6;
    this.smoothSpeed = 0;
    this.pitch = 0;
    this.dunk = 0;
    this.flash = 0;
    this.deadRoll = 0;
    this.#build();
    this.root.rotation.x = Math.PI / 2;     // lie flat: head toward +z, face down
    this.group.scale.setScalar(1.3);
  }

  #build() {
    const b = this.body;
    // legs + sneakers
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.17, 0.95, 0);
      const legGeo = new THREE.CapsuleGeometry(0.11, 0.7, 4, 8);
      legGeo.translate(0, -0.45, 0);
      hip.add(shadowed(new THREE.Mesh(legGeo, this.skin)));
      const shoe = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.32), std(0xffffff)));
      shoe.position.set(0, -0.9, 0.06);
      hip.add(shoe);
      const swoosh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.2), std(GOLD));
      swoosh.position.set(0, -0.9, 0.06);
      hip.add(swoosh);
      b.add(hip);
      this.legs.push(hip);
    }
    // shorts
    const shorts = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.38), this.jersey));
    shorts.position.y = 1.0;
    b.add(shorts);
    const shortsTrim = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.4), std(GOLD));
    shortsTrim.position.y = 0.8;
    b.add(shortsTrim);
    // torso with numbered jersey
    const front = jerseyTexture('LAKERS', '23');
    const back = jerseyTexture('JAMES', '23');
    const side = this.jersey;
    const torso = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.72, 0.36), [side, side, side, side,
      new THREE.MeshStandardMaterial({ map: front, roughness: 0.85 }), new THREE.MeshStandardMaterial({ map: back, roughness: 0.85 })]));
    torso.position.y = 1.56;
    b.add(torso);
    this.torso = torso;
    for (const sx of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.38), std(GOLD));
      strap.position.set(sx * 0.22, 1.93, 0);
      b.add(strap);
    }
    // arms: left reaches forward with the ball, right windmills
    this.arms = [];
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * 0.4, 1.86, 0);
      const armGeo = new THREE.CapsuleGeometry(0.085, 0.62, 4, 8);
      armGeo.translate(0, -0.38, 0);
      shoulder.add(shadowed(new THREE.Mesh(armGeo, this.skin)));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), this.skin);
      hand.position.y = -0.76;
      shoulder.add(hand);
      if (sx < 0) {
        // basketball in the left hand
        const ball = new THREE.Group();
        ball.position.set(0, -0.9, 0.08);
        ball.add(shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), std(0xe8702a, { roughness: 0.7 }))));
        for (const rot of [[0, 0, 0], [Math.PI / 2, 0, 0], [0, 0, Math.PI / 2]]) {
          const seam = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 6, 24), std(0x2a1a10));
          seam.rotation.set(...rot);
          ball.add(seam);
        }
        shoulder.add(ball);
        this.ball = ball;
      }
      shoulder.userData.side = sx;
      b.add(shoulder);
      this.arms.push(shoulder);
    }
    // head
    const head = new THREE.Group();
    head.position.y = 2.25;
    b.add(head);
    this.head = head;
    head.add(shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 12), this.skin)));
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.275, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), std(DARK));
    hair.position.y = 0.03;
    head.add(hair);
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), std(DARK));
    beard.position.z = 0.04;
    head.add(beard);
    const headband = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.045, 8, 24), std(0xffffff));
    headband.rotation.x = Math.PI / 2;
    headband.position.y = 0.1;
    head.add(headband);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), std(0xffffff, { roughness: 0.3 }));
      eye.position.set(sx * 0.1, 0.02, 0.24);
      head.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), std(0x111111));
      pupil.position.set(sx * 0.1, 0.02, 0.28);
      head.add(pupil);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.03), std(DARK));
      brow.position.set(sx * 0.1, 0.09, 0.25);
      brow.rotation.z = sx * -0.25;
      head.add(brow);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), std(0x3a1a1a));
    mouth.position.set(0, -0.12, 0.25);
    head.add(mouth);
    this.mouth = mouth;
    // center the figure: feet at y≈0, so shift down so the hips are the pivot
    b.position.y = -1.2;
  }

  hitFlash() { this.flash = 1; }

  /** @param {{speed:number, vy:number, biting:boolean, dead:boolean}} s */
  update(dt, s) {
    this.time += dt;
    const t = this.time;
    const k = 1 - Math.exp(-dt * 6);
    this.smoothSpeed += (s.speed - this.smoothSpeed) * k;
    const run = Math.min(this.smoothSpeed / 6, 1.4);
    this.phase += dt * (2.5 + this.smoothSpeed * 1.4);
    this.dunk += ((s.biting ? 1 : 0) - this.dunk) * (1 - Math.exp(-dt * 10));

    // freestyle: right arm windmills, left arm reaches forward with the ball (both arms up to dunk)
    for (const arm of this.arms) {
      const sx = arm.userData.side;
      let rx = sx > 0 ? this.phase : Math.PI - 0.2 + Math.sin(t * 2) * 0.1; // rotation about x: forward reach ≈ π
      rx = THREE.MathUtils.lerp(rx, Math.PI, this.dunk);
      arm.rotation.x = rx;
      arm.rotation.z = sx * -0.15 - sx * this.dunk * 0.4;
    }
    // flutter kick
    this.legs[0].rotation.x = Math.sin(this.phase * 2) * 0.35 * (0.3 + run);
    this.legs[1].rotation.x = -Math.sin(this.phase * 2) * 0.35 * (0.3 + run);
    // head lifts to look at prey
    this.head.rotation.x = -0.6 - this.dunk * 0.5 + Math.sin(t * 1.5) * 0.05;
    this.mouth.scale.y = 1 + this.dunk * 4;

    // pitch follows vertical motion; dead = roll onto back
    const targetPitch = -Math.atan2(s.vy, Math.max(s.speed, 1.5)) * 0.8;
    this.pitch += (targetPitch - this.pitch) * k;
    this.deadRoll += ((s.dead ? Math.PI : 0) - this.deadRoll) * (1 - Math.exp(-dt * 3));
    this.root.rotation.x = Math.PI / 2 + this.pitch;
    this.root.rotation.z = this.deadRoll + Math.sin(t * 0.9) * 0.04 + Math.sin(this.phase) * 0.08 * run;
    this.root.position.y = Math.sin(t * 1.6) * 0.05;

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4);
      this.skin.emissive.setRGB(this.flash, this.flash * 0.15, this.flash * 0.1);
      this.jersey.emissive.setRGB(this.flash, this.flash * 0.15, this.flash * 0.1);
    }
  }
}
