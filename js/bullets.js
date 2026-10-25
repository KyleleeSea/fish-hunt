// Client-side bullets: visual for everyone, hit detection for the shooter's own shots.
import * as THREE from 'three';
import { rayBox, raySphere } from './physics.js';

const SPEED = 46;
const LIFE = 1.5;

export class BulletSystem {
  /** @param {(kind:string, id:number, point:THREE.Vector3)=>void} onOwnHit */
  constructor(scene, colliders, onOwnHit) {
    this.scene = scene;
    this.colliders = colliders;
    this.onOwnHit = onOwnHit;
    this.bullets = [];
    this.puffs = [];
    this.geo = new THREE.CapsuleGeometry(0.06, 0.3, 3, 6);
    this.geo.rotateX(Math.PI / 2);
    this.mats = {
      hider: new THREE.MeshBasicMaterial({ color: 0xffb347 }),
      seeker: new THREE.MeshBasicMaterial({ color: 0x8ff5ff }),
      none: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    };
    this.puffGeo = new THREE.SphereGeometry(0.25, 8, 6);
    this.puffMat = new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.8 });
    this._p = new THREE.Vector3();
  }

  spawn(origin, dir, role, own) {
    const m = new THREE.Mesh(this.geo, this.mats[role] || this.mats.none);
    m.position.copy(origin);
    m.lookAt(origin.clone().add(dir));
    this.scene.add(m);
    this.bullets.push({ mesh: m, pos: origin.clone(), dir: dir.clone().normalize(), life: LIFE, own });
  }

  puff(point, scale = 1) {
    const m = new THREE.Mesh(this.puffGeo, this.puffMat.clone());
    m.position.copy(point);
    m.scale.setScalar(scale * 0.6);
    this.scene.add(m);
    this.puffs.push({ mesh: m, life: 0.35, scale });
  }

  /**
   * @param {Array<{kind:string,id:number,center:THREE.Vector3,radius:number}>} targets
   */
  update(dt, targets) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const step = SPEED * dt;
      let hitT = step;
      let hit = null;
      for (const c of this.colliders) {
        const t = rayBox(b.pos, b.dir, c);
        if (t < hitT) { hitT = t; hit = { kind: 'world' }; }
      }
      if (b.own) {
        for (const tg of targets) {
          const t = raySphere(b.pos, b.dir, tg.center, tg.radius);
          if (t < hitT) { hitT = t; hit = tg; }
        }
      }
      b.pos.addScaledVector(b.dir, hitT);
      b.mesh.position.copy(b.pos);
      b.life -= dt;
      if (hit || b.life <= 0 || b.pos.y < 0.05 || b.pos.y > 17.5) {
        if (hit) {
          this.puff(b.pos, hit.kind === 'world' ? 1 : 1.6);
          if (hit.kind !== 'world') this.onOwnHit(hit.kind, hit.id, b.pos);
        }
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      p.mesh.scale.addScalar(dt * 4 * p.scale);
      p.mesh.material.opacity = Math.max(0, p.life / 0.35) * 0.8;
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.material.dispose(); this.puffs.splice(i, 1); }
    }
  }
}
