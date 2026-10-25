// Authoritative game logic — runs in the HOST's browser. Rounds, damage, and shark NPCs.
//   player -> host : join {name}, move {pos,yaw,anim}, shoot {o,d}, hit {kind,id}, tag
//   host -> player : welcome, state, teleport, event {name,...}, full
import { sweep, lerpAngle } from './physics.js';

export const HIDE_TIME = 10;
export const SEEK_TIME = 100;
export const RESULT_TIME = 6;
export const TAG_RANGE = 2.0;
export const HITS_TO_CATCH = 3;
const SPAWNS = {
  hider:  { x: 0, y: 1, z: -2, yaw: 0 },
  seeker: { x: 0, y: 3, z: 28, yaw: Math.PI },
};
const SHARK = {
  count: 3, hp: 3, wander: 3.4, chase: 6.9, detect: 12, lose: 20, biteRange: 2.1, biteDmg: 20, biteCd: 2.2,
  respawn: 16, half: 0.7, height: 1.0, accel: 6, calmAfterBite: 4.5, calmAtRoundStart: 9, lureRange: 34,
};
const FLARE = { life: 12, cooldown: 15, throwDist: 5 };
const INK_COOLDOWN = 20;
const SONAR_COOLDOWN = 15;
const PEARL_SPOTS = [[-8, 1.2, -20], [22, 3, -8], [-26, 2, 24], [4, 8, 14], [14, 1.5, 26], [-4, 13, -4], [26, 2, 26], [-22, 5, -26]];
const PEARL = { radius: 1.4, heal: 50, boost: 6, respawn: 30 };
const PLAYER_HP = 100;
const DEATH_TIME = 3.5;

export class GameHost {
  /**
   * @param {(key:string, msg:object) => void} deliver
   * @param {{colliders: Array}} opts
   */
  constructor(deliver, opts) {
    this.deliver = deliver;
    this.colliders = opts.colliders;
    this.players = new Map();
    this.nextId = 1;
    this.game = { phase: 'lobby', timeLeft: 0, round: 0, lastResult: null };
    this.sharks = [];
    for (let i = 0; i < SHARK.count; i++) this.sharks.push(this.makeShark(i + 1));
    this.flares = [];
    this.nextFlare = 1;
    this.pearls = PEARL_SPOTS.map(([x, y, z], i) => ({ id: i + 1, pos: { x, y, z }, active: true, respawnAt: 0 }));
    this.last = performance.now();
    this.acc = 0;
    this.timer = setInterval(() => this.tick(), 1000 / 60);
  }

  destroy() { clearInterval(this.timer); }

  now() { return performance.now() / 1000; }

  // ---- players -----------------------------------------------------------
  addPlayer(key) {
    if (this.players.size >= 2) { this.deliver(key, { type: 'full' }); return null; }
    const id = this.nextId++;
    const p = {
      key, id, name: `Fish ${id}`, role: null, pos: { x: 0, y: 1, z: 0 }, yaw: 0, anim: 'idle', wins: 0, ready: false,
      hp: PLAYER_HP, hits: 0, dazedUntil: 0, deadUntil: 0, lastDamage: -99,
      lastFlare: -99, lastInk: -99, lastSonar: -99, boostUntil: 0,
    };
    this.players.set(key, p);
    this.deliver(key, { type: 'welcome', id, hideTime: HIDE_TIME, seekTime: SEEK_TIME });
    this.broadcast(this.snapshot());
    return p;
  }

  removePlayer(key) {
    const p = this.players.get(key);
    if (!p) return;
    this.players.delete(key);
    if (this.players.size < 2) this.toLobby();
    this.broadcast({ type: 'event', name: 'playerLeft', id: p.id });
    this.broadcast(this.snapshot());
  }

  handle(key, msg) {
    const p = this.players.get(key);
    if (!p || !msg || typeof msg !== 'object') return;
    const now = this.now();
    switch (msg.type) {
      case 'join':
        if (typeof msg.name === 'string' && msg.name.trim()) p.name = msg.name.trim().slice(0, 16);
        p.ready = true;
        this.broadcast(this.snapshot());
        break;
      case 'move':
        if (msg.pos && Number.isFinite(msg.pos.x) && Number.isFinite(msg.pos.y) && Number.isFinite(msg.pos.z)) p.pos = { x: msg.pos.x, y: msg.pos.y, z: msg.pos.z };
        if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
        if (typeof msg.anim === 'string') p.anim = msg.anim.slice(0, 12);
        break;
      case 'shoot':
        if (Array.isArray(msg.o) && Array.isArray(msg.d)) {
          for (const q of this.players.values()) if (q.key !== key) this.deliver(q.key, { type: 'event', name: 'shot', o: msg.o, d: msg.d, by: p.id, role: p.role });
        }
        break;
      case 'hit':
        this.onHit(p, msg);
        break;
      case 'flare': {
        if (this.isFrozen(p) || this.isDead(p) || now - p.lastFlare < FLARE.cooldown) break;
        p.lastFlare = now;
        let pos = { x: p.pos.x + Math.sin(p.yaw) * FLARE.throwDist, y: 0.35, z: p.pos.z + Math.cos(p.yaw) * FLARE.throwDist };
        pos.x = Math.max(-32, Math.min(32, pos.x)); pos.z = Math.max(-32, Math.min(32, pos.z));
        if (this.colliders.some(c => pos.x > c.min.x && pos.x < c.max.x && pos.y > c.min.y && pos.y < c.max.y && pos.z > c.min.z && pos.z < c.max.z)) pos = { x: p.pos.x, y: Math.max(0.35, p.pos.y), z: p.pos.z };
        const f = { id: this.nextFlare++, pos, until: now + FLARE.life, by: p.id };
        this.flares.push(f);
        this.broadcast({ type: 'event', name: 'flare', id: f.id, pos, from: p.pos, by: p.id });
        break;
      }
      case 'ink':
        if (p.role !== 'hider' || this.isFrozen(p) || this.isDead(p) || now - p.lastInk < INK_COOLDOWN) break;
        p.lastInk = now;
        this.broadcast({ type: 'event', name: 'inkCloud', pos: { x: p.pos.x, y: p.pos.y + 0.35, z: p.pos.z }, secs: 9, by: p.id });
        break;
      case 'sonar': {
        if (p.role !== 'seeker' || this.game.phase !== 'seek' || this.isDead(p) || now - p.lastSonar < SONAR_COOLDOWN) break;
        const h = this.hider();
        if (!h) break;
        p.lastSonar = now;
        this.deliver(key, { type: 'event', name: 'sonar', pos: h.pos, dist: Math.round(dist(h.pos, p.pos)) });
        this.deliver(h.key, { type: 'event', name: 'pinged' });
        break;
      }
      case 'tag': {
        if (this.game.phase !== 'seek' || p.role !== 'seeker') break;
        const h = this.hider();
        if (!h) break;
        if (dist(h.pos, p.pos) <= TAG_RANGE) this.endRound('seeker', `${p.name} tagged ${h.name}!`);
        else this.deliver(key, { type: 'event', name: 'tagMiss' });
        break;
      }
    }
  }

  onHit(p, msg) {
    const now = this.now();
    if (this.isDead(p)) return;
    if (msg.kind === 'shark') {
      const s = this.sharks.find(s => s.id === msg.id);
      if (!s || s.state === 'dead' || dist(s.pos, p.pos) > 50) return;
      s.hp -= 1;
      s.targetKey = p.key;   // sharks get angry at whoever shoots them
      s.calmUntil = 0;
      this.broadcast({ type: 'event', name: 'sharkHit', id: s.id, by: p.id, hp: s.hp });
      if (s.hp <= 0) {
        s.state = 'dead';
        s.respawnAt = now + SHARK.respawn;
        s.vel = { x: 0, y: 0, z: 0 };
        this.broadcast({ type: 'event', name: 'sharkDied', id: s.id, by: p.id });
      }
    } else if (msg.kind === 'player') {
      if (this.game.phase !== 'seek') return;
      const target = [...this.players.values()].find(q => q.id === msg.id);
      if (!target || target === p || this.isDead(target) || dist(target.pos, p.pos) > 50) return;
      if (p.role === 'seeker' && target.role === 'hider') {
        target.hits += 1;
        this.broadcast({ type: 'event', name: 'playerHit', victim: target.id, by: p.id, hits: target.hits });
        if (target.hits >= HITS_TO_CATCH) this.endRound('seeker', `${p.name} shot ${target.name} out of hiding!`);
      } else if (p.role === 'hider' && target.role === 'seeker') {
        target.dazedUntil = now + 2.5;
        this.broadcast({ type: 'event', name: 'dazed', victim: target.id, by: p.id });
      }
    }
  }

  damagePlayer(p, amount, source) {
    const now = this.now();
    if (this.isDead(p)) return;
    p.hp = Math.max(0, p.hp - amount);
    p.lastDamage = now;
    this.broadcast({ type: 'event', name: 'hurt', victim: p.id, amount, source, hp: p.hp });
    if (p.hp <= 0) {
      p.deadUntil = now + DEATH_TIME;
      this.broadcast({ type: 'event', name: 'eaten', victim: p.id });
      if (this.game.phase === 'seek' && p.role === 'hider') {
        const s = this.seeker();
        if (s) this.deliver(s.key, { type: 'event', name: 'reveal', pos: p.pos, secs: 8 });
      }
    }
  }

  isDead(p) { return p.deadUntil > this.now(); }
  isFrozen(p) {
    const ph = this.game.phase;
    return ph === 'lobby' || ph === 'result' || (ph === 'hide' && p.role === 'seeker');
  }

  // ---- sharks ------------------------------------------------------------
  makeShark(id) {
    const a = (id / SHARK.count) * Math.PI * 2;
    return {
      id, pos: { x: Math.cos(a) * 26, y: 5 + id, z: Math.sin(a) * 26 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0,
      state: 'wander', hp: SHARK.hp, target: this.randomPoint(), targetKey: null, biteCd: 0, biteAnimUntil: 0,
      stuck: 0, respawnAt: 0, calmUntil: 0,
    };
  }

  randomPoint() { return { x: (Math.random() - 0.5) * 58, y: 1.5 + Math.random() * 11, z: (Math.random() - 0.5) * 58 }; }

  respawnShark(s) {
    let p;
    for (let i = 0; i < 20; i++) {
      p = { x: (Math.random() - 0.5) * 62, y: 3 + Math.random() * 9, z: (Math.random() - 0.5) * 62 };
      if ([...this.players.values()].every(q => dist(q.pos, p) > 18)) break;
    }
    s.pos = p; s.vel = { x: 0, y: 0, z: 0 }; s.hp = SHARK.hp; s.state = 'wander'; s.target = this.randomPoint(); s.targetKey = null; s.stuck = 0;
  }

  updateSharks(dt) {
    const now = this.now();
    const huntable = this.game.phase === 'hide' || this.game.phase === 'seek';
    const prey = huntable ? [...this.players.values()].filter(p => !this.isDead(p) && !this.isFrozen(p)) : [];
    for (const s of this.sharks) {
      if (s.state === 'dead') {
        s.pos.y = Math.max(0.8, s.pos.y - dt * 0.7);
        if (now >= s.respawnAt) this.respawnShark(s);
        continue;
      }
      s.biteCd = Math.max(0, s.biteCd - dt);
      const center = { x: s.pos.x, y: s.pos.y, z: s.pos.z };

      // choose a target
      let target = null;
      if (now >= s.calmUntil) {
        let best = Infinity;
        for (const p of prey) {
          const c = { x: p.pos.x, y: p.pos.y + 0.35, z: p.pos.z };
          const d = dist(center, c);
          const limit = s.targetKey === p.key ? SHARK.lose : SHARK.detect;
          if (d < limit && d < best) { best = d; target = p; }
        }
      }
      // flares are irresistible
      let lure = null, lureD = SHARK.lureRange;
      for (const f of this.flares) { const d = dist(center, f.pos); if (d < lureD) { lureD = d; lure = f; } }
      if (lure) target = null;
      s.targetKey = target ? target.key : null;
      s.state = target || lure ? 'chase' : 'wander';
      s.lured = !!lure;

      let goal, speed;
      if (lure) {
        goal = { x: lure.pos.x, y: lure.pos.y + 1.2, z: lure.pos.z };
        speed = lureD < 2.5 ? 1.2 : SHARK.chase;
      } else if (target) {
        goal = { x: target.pos.x, y: target.pos.y + 0.35, z: target.pos.z };
        speed = SHARK.chase;
        const d = dist(center, goal);
        if (d <= SHARK.biteRange && s.biteCd <= 0) {
          this.damagePlayer(target, SHARK.biteDmg, 'shark');
          s.biteCd = SHARK.biteCd;
          s.biteAnimUntil = now + 0.5;
          this.broadcast({ type: 'event', name: 'bite', id: s.id, victim: target.id });
          // swing away after a bite so the prey can react
          s.calmUntil = now + SHARK.calmAfterBite;
          s.target = { x: s.pos.x + (Math.random() - 0.5) * 30, y: 1.5 + Math.random() * 10, z: s.pos.z + (Math.random() - 0.5) * 30 };
        }
      } else {
        goal = s.target;
        speed = SHARK.wander;
        if (dist(center, goal) < 2.5 || s.stuck > 1.2) { s.target = this.randomPoint(); s.stuck = 0; }
      }

      // steer
      const dx = goal.x - center.x, dy = goal.y - center.y, dz = goal.z - center.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const tv = { x: dx / len * speed, y: dy / len * speed, z: dz / len * speed };
      s.vel.x = approach(s.vel.x, tv.x, SHARK.accel * dt);
      s.vel.y = approach(s.vel.y, tv.y, SHARK.accel * dt);
      s.vel.z = approach(s.vel.z, tv.z, SHARK.accel * dt);

      // integrate as a box whose bottom is below the center
      const box = { x: s.pos.x, y: s.pos.y - SHARK.height / 2, z: s.pos.z };
      const blocked = sweep(box, SHARK.half, SHARK.height, { x: s.vel.x * dt, y: s.vel.y * dt, z: s.vel.z * dt }, this.colliders);
      s.pos = { x: box.x, y: box.y + SHARK.height / 2, z: box.z };
      if (blocked.x || blocked.z) {
        s.stuck += dt;
        if (blocked.x) s.vel.x *= -0.3;
        if (blocked.z) s.vel.z *= -0.3;
        if (target && s.stuck > 1.5) { s.calmUntil = now + 1.5; s.target = this.randomPoint(); s.stuck = 0; }
      } else s.stuck = Math.max(0, s.stuck - dt);
      if (blocked.y) s.vel.y = 0;

      const hs = Math.hypot(s.vel.x, s.vel.z);
      if (hs > 0.3) s.yaw = lerpAngle(s.yaw, Math.atan2(s.vel.x, s.vel.z), 1 - Math.exp(-dt * 4));
    }
  }

  // ---- rounds ------------------------------------------------------------
  broadcast(msg) { for (const p of this.players.values()) this.deliver(p.key, msg); }
  hider()  { return [...this.players.values()].find(p => p.role === 'hider'); }
  seeker() { return [...this.players.values()].find(p => p.role === 'seeker'); }

  snapshot() {
    const g = this.game, now = this.now();
    return {
      type: 'state', phase: g.phase, timeLeft: Math.ceil(g.timeLeft), round: g.round, lastResult: g.lastResult,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, role: p.role, pos: p.pos, yaw: p.yaw, anim: p.anim, wins: p.wins,
        hp: Math.round(p.hp), hits: p.hits, dazed: p.dazedUntil > now, dead: p.deadUntil > now, boost: p.boostUntil > now,
        cd: { flare: Math.max(0, FLARE.cooldown - (now - p.lastFlare)), ink: Math.max(0, INK_COOLDOWN - (now - p.lastInk)), sonar: Math.max(0, SONAR_COOLDOWN - (now - p.lastSonar)) },
      })),
      sharks: this.sharks.map(s => ({
        id: s.id, pos: s.pos, yaw: s.yaw, state: s.state, hp: s.hp, tgt: s.targetKey ? this.players.get(s.targetKey)?.id ?? null : null,
        biting: s.biteAnimUntil > now, lured: !!s.lured,
      })),
      flares: this.flares.map(f => ({ id: f.id, pos: f.pos, left: Math.max(0, f.until - now) })),
      pearls: this.pearls.map(q => ({ id: q.id, pos: q.pos, active: q.active })),
    };
  }

  resetPlayer(p) {
    const s = SPAWNS[p.role] || SPAWNS.hider;
    p.pos = { x: s.x, y: s.y, z: s.z };
    p.yaw = s.yaw;
    p.hp = PLAYER_HP;
    p.hits = 0;
    p.dazedUntil = 0;
    p.deadUntil = 0;
    this.deliver(p.key, { type: 'teleport', pos: p.pos, yaw: p.yaw });
  }

  assignRoles(swap) {
    const list = [...this.players.values()];
    if (list.length < 2) return;
    if (swap && list[0].role) for (const p of list) p.role = p.role === 'hider' ? 'seeker' : 'hider';
    else { list[0].role = 'hider'; list[1].role = 'seeker'; }
    for (const p of list) this.resetPlayer(p);
  }

  startRound(swap) {
    this.game.round += 1;
    this.assignRoles(swap);
    this.game.phase = 'hide';
    this.game.timeLeft = HIDE_TIME;
    this.game.lastResult = null;
    // sharks relocate away from the spawns and give everyone a head start
    for (const s of this.sharks) { if (s.state !== 'dead') this.respawnShark(s); s.calmUntil = this.now() + SHARK.calmAtRoundStart; }
    this.broadcast({ type: 'event', name: 'roundStart', round: this.game.round });
    this.broadcast(this.snapshot());
  }

  endRound(winner, reason) {
    const w = winner === 'hider' ? this.hider() : this.seeker();
    if (w) w.wins += 1;
    this.game.phase = 'result';
    this.game.timeLeft = RESULT_TIME;
    this.game.lastResult = { winner, reason };
    this.broadcast({ type: 'event', name: 'roundEnd', winner, reason });
    this.broadcast(this.snapshot());
  }

  toLobby() {
    this.game.phase = 'lobby';
    this.game.timeLeft = 0;
    this.game.lastResult = null;
    for (const p of this.players.values()) p.role = null;
    this.broadcast(this.snapshot());
  }

  tick() {
    const nowMs = performance.now();
    const dt = Math.min((nowMs - this.last) / 1000, 0.1);
    this.last = nowMs;
    const g = this.game, now = this.now();

    if (g.phase !== 'lobby') {
      if (this.players.size < 2) { this.toLobby(); return; }
      g.timeLeft -= dt;
      if (g.timeLeft <= 0) {
        if (g.phase === 'hide') { g.phase = 'seek'; g.timeLeft = SEEK_TIME; this.broadcast({ type: 'event', name: 'seekStart' }); }
        else if (g.phase === 'seek') this.endRound('hider', 'The seeker ran out of time!');
        else if (g.phase === 'result') this.startRound(true);
      }
    } else if (this.players.size >= 2 && [...this.players.values()].every(p => p.ready)) {
      this.startRound(false);
    }

    // respawns + regen
    for (const p of this.players.values()) {
      if (p.deadUntil && p.deadUntil <= now && p.hp <= 0) {
        p.hp = PLAYER_HP;
        p.deadUntil = 0;
        const s = SPAWNS[p.role] || SPAWNS.hider;
        p.pos = { x: s.x, y: s.y, z: s.z };
        this.deliver(p.key, { type: 'teleport', pos: p.pos, yaw: s.yaw });
        this.broadcast({ type: 'event', name: 'respawn', id: p.id });
      } else if (p.hp > 0 && p.hp < PLAYER_HP && now - p.lastDamage > 4) {
        p.hp = Math.min(PLAYER_HP, p.hp + 10 * dt);
      }
    }

    // flares burn out
    this.flares = this.flares.filter(f => f.until > now);

    // pearls: heal + speed boost
    for (const q of this.pearls) {
      if (!q.active) { if (now >= q.respawnAt) q.active = true; continue; }
      for (const p of this.players.values()) {
        if (this.isDead(p) || this.isFrozen(p)) continue;
        if (dist({ x: p.pos.x, y: p.pos.y + 0.35, z: p.pos.z }, q.pos) <= PEARL.radius) {
          q.active = false; q.respawnAt = now + PEARL.respawn;
          p.hp = Math.min(PLAYER_HP, p.hp + PEARL.heal);
          p.boostUntil = now + PEARL.boost;
          this.broadcast({ type: 'event', name: 'pearl', id: q.id, by: p.id });
          break;
        }
      }
    }

    this.updateSharks(dt);

    this.acc += dt;
    if (this.acc >= 1 / 20) { this.acc = 0; this.broadcast(this.snapshot()); }
  }
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function approach(v, target, maxDelta) {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}
