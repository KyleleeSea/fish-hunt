// Local swimming controller (3D movement, no gravity) and smoothed remote fish.
import * as THREE from 'three';
import { sweep, lerpAngle } from './physics.js';

export const PLAYER_HALF = 0.4;
export const PLAYER_HEIGHT = 0.7;
const SPRINT_TIME = 1.5;
const SPRINT_REFILL = 4;

export class LocalPlayer {
  constructor(fish, colliders) {
    this.fish = fish;
    this.colliders = colliders;
    this.pos = new THREE.Vector3(0, 1, 0);   // bottom-center of the collision box
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.prevYaw = 0;
    this.frozen = false;
    this.dazed = false;
    this.dead = false;
    this.cover = false;
    this.baseSpeed = 6.5;
    this.anim = 'idle';
    this._wish = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this.tangled = false;
    this.torpedoUntil = 0;   // seconds (performance.now()/1000) until the torpedo dash ends
    this.torpedoDir = new THREE.Vector3();
    this.stamina = 1;        // 0..1, drained by sprinting
    this.exhausted = false;  // after running dry, wait for a partial refill
    this.sprinting = false;
  }

  /** World-space center of the fish. */
  center(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + PLAYER_HEIGHT / 2, this.pos.z); }

  teleport(pos, yaw) {
    this.pos.set(pos.x, pos.y, pos.z);
    this.vel.set(0, 0, 0);
    this.yaw = this.prevYaw = yaw;
    this.apply();
  }

  apply() {
    this.fish.group.position.set(this.pos.x, this.pos.y + PLAYER_HEIGHT / 2, this.pos.z);
    this.fish.group.rotation.y = this.yaw;
  }

  /**
   * @param {{f:number,b:number,l:number,r:number,up:number,down:number,sprint:boolean}} input
   * @param {THREE.Vector3} camForward full 3D camera forward
   * @param {THREE.Vector3} camRight horizontal camera right
   */
  update(dt, input, camForward, camRight) {
    const wish = this._wish.set(0, 0, 0);
    const canMove = !this.frozen && !this.dead;
    if (canMove) {
      wish.addScaledVector(camForward, input.f - input.b);
      wish.addScaledVector(camRight, input.r - input.l);
      wish.y += input.up - input.down;
      if (wish.lengthSq() > 1) wish.normalize();
    }
    // short sprint burst: ~1.5 s of boost, ~4 s to refill
    const wantsSprint = input.sprint && canMove && wish.lengthSq() > 0;
    if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    this.sprinting = wantsSprint && !this.exhausted && this.stamina > 0;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt / SPRINT_TIME);
      if (this.stamina <= 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt / SPRINT_REFILL);
    }
    let maxSpeed = this.baseSpeed * (this.sprinting ? 1.9 : 1);
    if (this.dazed) maxSpeed *= 0.45;
    if (this.tangled) maxSpeed *= 0.15;

    const nowS = performance.now() / 1000;
    if (nowS < this.torpedoUntil && canMove) {
      // torpedo dash: locked to the aim direction at high speed
      this.vel.copy(this.torpedoDir).multiplyScalar(this.tangled ? 6 : 24);
    } else {
      const accel = wish.lengthSq() > 0 ? 22 : 12; // water drag when coasting
      this.vel.x = approach(this.vel.x, wish.x * maxSpeed, accel * dt);
      this.vel.y = approach(this.vel.y, wish.y * maxSpeed, accel * dt);
      this.vel.z = approach(this.vel.z, wish.z * maxSpeed, accel * dt);
    }
    if (this.dead) { this.vel.set(0, 0, 0); }

    const delta = this._delta.copy(this.vel).multiplyScalar(dt);
    const blocked = sweep(this.pos, PLAYER_HALF, PLAYER_HEIGHT, delta, this.colliders);
    if (blocked.x) this.vel.x = 0;
    if (blocked.y) this.vel.y = 0;
    if (blocked.z) this.vel.z = 0;

    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    this.prevYaw = this.yaw;
    if (hspeed > 0.4) this.yaw = lerpAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 1 - Math.exp(-dt * 9));
    const turn = lerpAngle(0, this.yaw - this.prevYaw, 1) / Math.max(dt, 1e-4);

    const speed = this.vel.length();
    this.anim = this.cover ? 'cover' : this.dead ? 'dead' : speed > 0.5 ? 'swim' : 'idle';
    this.torpedoing = nowS < this.torpedoUntil;
    this.apply();
    this.fish.update(dt, { speed, vy: this.vel.y, turn, cover: this.cover, dead: this.dead });
  }
}

function approach(v, target, maxDelta) {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}

/** Smoothed remote fish or shark driven by host snapshots. */
export class RemoteActor {
  constructor(model, yOffset = 0) {
    this.model = model;
    this.yOffset = yOffset;
    this.target = new THREE.Vector3();
    this.targetYaw = 0;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.prevYaw = 0;
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.anim = 'idle';
    this.first = true;
    this.extra = {};
  }

  setTarget(p, yaw, anim, extra = {}) {
    this.target.set(p.x, p.y, p.z);
    this.targetYaw = yaw;
    this.anim = anim;
    this.extra = extra;
    if (this.first) { this.pos.copy(this.target); this.yaw = yaw; this.first = false; }
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 12);
    this.prev.copy(this.pos);
    this.pos.lerp(this.target, k);
    this.prevYaw = this.yaw;
    this.yaw = lerpAngle(this.yaw, this.targetYaw, k);
    const inst = this.pos.clone().sub(this.prev).divideScalar(Math.max(dt, 1e-4));
    this.vel.lerp(inst, 1 - Math.exp(-dt * 8));
    this.model.group.position.set(this.pos.x, this.pos.y + this.yOffset, this.pos.z);
    this.model.group.rotation.y = this.yaw;
    const turn = lerpAngle(0, this.yaw - this.prevYaw, 1) / Math.max(dt, 1e-4);
    this.model.update(dt, {
      speed: this.vel.length(), vy: this.vel.y, turn,
      cover: this.anim === 'cover', dead: this.anim === 'dead' || this.extra.dead === true,
      biting: this.extra.biting === true,
    });
  }
}
