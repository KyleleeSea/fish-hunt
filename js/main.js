import * as THREE from 'three';
import { buildWorld, updateWorld } from './world.js';
import { Fish } from './fish.js';
import { LeBron } from './lebron.js';
import { LocalPlayer, RemoteActor, PLAYER_HEIGHT } from './player.js';
import { BulletSystem } from './bullets.js';
import { P2P, randomCode } from './net.js';
import { sfx } from './audio.js';
import { rayBox, raySphere, ARENA } from './physics.js';
import { HITS_TO_CATCH } from './host.js';

// ---- Renderer / scene ----------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 200);
const { colliders, camBlockers, hideVolumes } = buildWorld(scene);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---- UI ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), role: $('role-badge'), timer: $('timer'), score: $('score'), phase: $('phase-label'),
  center: $('center-msg'), sub: $('sub-msg'), hint: $('hint'), danger: $('danger'), hurt: $('hurt'), ink: $('ink'), crosshair: $('crosshair'),
  sense: $('sense'), senseArrow: $('sense-arrow'), senseText: $('sense-text'), sharkWarn: $('shark-warn'),
  health: $('health-bar'), healthText: $('health-text'), eaten: $('eaten'), hitmark: $('hitmark'), staminaBar: $('stamina-bar'),
  chipFlare: $('chip-flare'), chipSpecial: $('chip-special'),
  blindfold: $('blindfold'), blindCount: $('blind-count'),
  lobby: $('lobby'), joinForm: $('join-form'), lobbyStatus: $('lobby-status'), statusText: $('status-text'),
  name: $('name'), code: $('code'), join: $('join'), host: $('host'), formError: $('form-error'),
  roomInfo: $('room-info'), roomCode: $('room-code'), shareUrl: $('share-url'), copy: $('copy'),
};
let msgTimer = 0;
function banner(text, sub = '', secs = 3) {
  ui.center.textContent = text; ui.sub.textContent = sub;
  ui.center.classList.add('show'); ui.sub.classList.toggle('show', !!sub);
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { ui.center.classList.remove('show'); ui.sub.classList.remove('show'); }, secs * 1000);
}

// ---- Input ---------------------------------------------------------------
const keys = new Set();
let tagQueued = false, shootHeld = false, shootQueued = false, flareQueued = false, specialQueued = false;
addEventListener('keydown', (e) => {
  if (e.target === ui.name || e.target === ui.code) return;
  keys.add(e.code);
  if (e.code === 'Space' || e.code === 'KeyC') e.preventDefault();
  if (e.code === 'KeyE') tagQueued = true;
  if (e.code === 'KeyF') shootQueued = true;
  if (e.code === 'KeyQ') flareQueued = true;
  if (e.code === 'KeyR') specialQueued = true;
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); shootHeld = false; });
const cam = { theta: Math.PI, pitch: 0.25, dist: 6, curDist: 6 };
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  else { shootHeld = true; shootQueued = true; }
});
addEventListener('mouseup', (e) => { if (e.button === 0) shootHeld = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  cam.theta -= e.movementX * 0.0028;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch + e.movementY * 0.0028, -1.2, 1.25);
});
addEventListener('wheel', (e) => { cam.dist = THREE.MathUtils.clamp(cam.dist + e.deltaY * 0.004, 3, 10); }, { passive: true });

// ---- Actors --------------------------------------------------------------
const myFish = new Fish();
scene.add(myFish.group);
const me = new LocalPlayer(myFish, colliders);
me.frozen = true;
/** @type {Map<number, RemoteActor>} */
const remotes = new Map();
/** @type {Map<number, RemoteActor>} */
const sharks = new Map();

const state = {
  myId: null, phase: 'lobby', timeLeft: 0, round: 0, role: null, wins: 0, hp: 100, hits: 0, dazed: false, dead: false,
  hideTime: 10, seekTime: 100, joined: false, lastTick: -1, otherName: '', revealUntil: 0, revealPos: null, revealText: '', inkUntil: 0,
  boost: false, cd: { flare: 0, ink: 0, sonar: 0 }, flares: [], pearls: [],
};

const bullets = new BulletSystem(scene, colliders, (kind, id) => {
  net.send({ type: 'hit', kind, id });
  sfx.hit();
  ui.hitmark.classList.remove('show'); void ui.hitmark.offsetWidth; ui.hitmark.classList.add('show');
});

// ---- Networking ----------------------------------------------------------
const net = new P2P({
  onMessage,
  onStatus(text, kind) {
    ui.statusText.textContent = text;
    if (kind === 'closed') {
      ui.lobby.classList.remove('hidden'); ui.hud.classList.add('hidden'); ui.blindfold.classList.add('hidden');
      ui.lobbyStatus.classList.remove('hidden'); ui.joinForm.classList.add('hidden'); ui.roomInfo.classList.add('hidden');
      document.querySelector('.spinner')?.classList.add('hidden');
    }
  },
});

function onMessage(msg) {
  switch (msg.type) {
    case 'welcome': state.myId = msg.id; state.hideTime = msg.hideTime; state.seekTime = msg.seekTime; break;
    case 'full': ui.statusText.textContent = 'The reef is full — only two fish fit!'; ui.lobbyStatus.classList.remove('hidden'); ui.joinForm.classList.add('hidden'); break;
    case 'teleport': me.teleport(msg.pos, msg.yaw); cam.theta = msg.yaw + Math.PI; cam.pitch = 0.25; break;
    case 'state': applyState(msg); break;
    case 'event': onEvent(msg); break;
  }
}

function applyState(s) {
  const prevPhase = state.phase;
  state.phase = s.phase; state.timeLeft = s.timeLeft; state.round = s.round;
  const seen = new Set();
  for (const p of s.players) {
    seen.add(p.id);
    if (p.id === state.myId) {
      if (state.role !== p.role) { state.role = p.role; myFish.setRole(p.role); }
      state.wins = p.wins; state.hp = p.hp; state.hits = p.hits; state.dazed = p.dazed; state.dead = p.dead; state.boost = !!p.boost; if (p.cd) state.cd = p.cd;
      continue;
    }
    let r = remotes.get(p.id);
    if (!r) { const f = new Fish(p.role); scene.add(f.group); r = new RemoteActor(f, PLAYER_HEIGHT / 2); remotes.set(p.id, r); }
    if (r.model.role !== p.role) r.model.setRole(p.role);
    r.setTarget(p.pos, p.yaw, p.anim, { dead: p.dead });
    r.wins = p.wins; r.name = p.name; r.id = p.id; r.hp = p.hp; r.hits = p.hits;
    state.otherName = p.name;
  }
  for (const [id, r] of remotes) if (!seen.has(id)) { scene.remove(r.model.group); remotes.delete(id); }

  const seenSharks = new Set();
  for (const sh of s.sharks || []) {
    seenSharks.add(sh.id);
    let r = sharks.get(sh.id);
    if (!r) { const m = new LeBron(); scene.add(m.group); r = new RemoteActor(m, 0); sharks.set(sh.id, r); }
    r.setTarget(sh.pos, sh.yaw, sh.state, { dead: sh.state === 'dead', biting: sh.biting });
    r.id = sh.id; r.state = sh.state; r.tgt = sh.tgt; r.hp = sh.hp; r.lured = sh.lured;
  }
  for (const [id, r] of sharks) if (!seenSharks.has(id)) { scene.remove(r.model.group); sharks.delete(id); }
  state.flares = s.flares || [];
  state.pearls = s.pearls || [];
  syncFlares(); syncPearls();

  if (prevPhase !== s.phase) onPhaseChange(prevPhase, s.phase, s);
  updateHud();
}

function onPhaseChange(prev, phase, s) {
  const amHider = state.role === 'hider';
  ui.blindfold.classList.add('hidden');
  ui.sense.classList.remove('show');
  state.revealUntil = 0;
  switch (phase) {
    case 'lobby':
      ui.lobby.classList.remove('hidden'); ui.hud.classList.add('hidden');
      if (state.joined) {
        ui.joinForm.classList.add('hidden'); ui.lobbyStatus.classList.remove('hidden');
        ui.statusText.textContent = prev === 'lobby' ? 'Waiting for another fish…' : 'The other fish left. Waiting for a new one…';
      }
      break;
    case 'hide':
      ui.lobby.classList.add('hidden'); ui.hud.classList.remove('hidden');
      if (amHider) { banner('You\'re the HIDER! 🐠', '10 seconds! Vanish into the reef. Watch out for LeBron!', 3); sfx.bubble(); }
      else { ui.blindfold.classList.remove('hidden'); sfx.thump(); }
      break;
    case 'seek':
      if (amHider) banner('The seeker is coming! 👀', `${HITS_TO_CATCH} hits and you're caught. Your shots ink their view.`, 3.5);
      else banner('GO FIND THAT FISH! 🔫', `Land ${HITS_TO_CATCH} shots or tag with E. ${state.seekTime}s on the clock.`, 3.5);
      sfx.whistle();
      break;
    case 'result': {
      const r = s.lastResult; if (!r) break;
      const iWon = r.winner === state.role;
      banner(r.winner === 'seeker' ? 'CAUGHT! 🐟' : 'HIDER WINS! 🐠', r.reason + (iWon ? '  You win this round!' : ''), 5.5);
      iWon ? sfx.win() : sfx.found();
      break;
    }
  }
}

function onEvent(e) {
  const now = performance.now() / 1000;
  switch (e.name) {
    case 'tagMiss': sfx.miss(); break;
    case 'shot': {
      const o = new THREE.Vector3(...e.o), d = new THREE.Vector3(...e.d);
      bullets.spawn(o, d, e.role, false);
      const r = remotes.get(e.by); if (r) r.model.fireFlash();
      break;
    }
    case 'sharkHit': { const s = sharks.get(e.id); if (s) s.model.hitFlash(); break; }
    case 'sharkDied': { sfx.sharkDie(); if (e.by === state.myId) banner('LEBRON DOWN! 🏀', 'He\'ll be back for the fourth quarter…', 2); break; }
    case 'flare': { sfx.bubble(); if (e.by !== state.myId) banner('', `${state.otherName} threw a flare 🔥`, 1.5); break; }
    case 'inkCloud': spawnInk(e.pos, e.secs, e.by === state.myId); if (e.by !== state.myId) sfx.ink(); break;
    case 'sonar': state.revealUntil = now + 2.5; state.revealPos = e.pos; state.revealText = `Sonar: hider ${e.dist} m away`; sfx.tick(); break;
    case 'pinged': banner('PING! 📡', 'The seeker just scanned for you — move!', 2); sfx.tick(); break;
    case 'pearl':
      if (e.by === state.myId) { banner('PEARL! 🫧', '+50 health and a speed boost!', 2); sfx.win(); }
      break;
    case 'bite': { const s = sharks.get(e.id); if (e.victim === state.myId) { sfx.chomp(); } break; }
    case 'hurt':
      if (e.victim === state.myId) { ui.hurt.style.opacity = 1; myFish.hurtFlash(); sfx.hurt(); state.hp = e.hp; }
      else { const r = remotes.get(e.victim); if (r) r.model.hurtFlash(); }
      break;
    case 'eaten':
      if (e.victim === state.myId) { ui.eaten.classList.remove('hidden'); sfx.roar(); }
      else banner(`${state.otherName} got dunked on! 🏀`, state.role === 'seeker' ? 'They respawn at their start — go!' : 'Serves them right.', 3);
      break;
    case 'respawn':
      if (e.id === state.myId) ui.eaten.classList.add('hidden');
      break;
    case 'reveal':
      state.revealUntil = now + (e.secs || 6); state.revealPos = e.pos; state.revealText = 'The hider respawned over there!'; break;
    case 'playerHit':
      if (e.victim === state.myId) { ui.hurt.style.opacity = 1; myFish.hurtFlash(); sfx.hurt(); banner(`HIT! ${e.hits}/${HITS_TO_CATCH}`, 'Move! One more and you\'re caught.'.replace('One more', e.hits === HITS_TO_CATCH - 1 ? 'One more' : `${HITS_TO_CATCH - e.hits} more`), 1.5); }
      else { const r = remotes.get(e.victim); if (r) r.model.hurtFlash(); banner(`HIT ${e.hits}/${HITS_TO_CATCH}!`, '', 1.2); }
      break;
    case 'dazed':
      if (e.victim === state.myId) { state.inkUntil = now + 2.5; sfx.ink(); banner('INKED! 🦑', 'You can barely see…', 1.5); }
      else { const r = remotes.get(e.victim); if (r) r.model.hurtFlash(); }
      break;
  }
}

// ---- Lobby ---------------------------------------------------------------
function myName() { return ui.name.value.trim() || `Fish ${Math.floor(Math.random() * 90 + 10)}`; }
function showError(text) { ui.formError.textContent = text; ui.formError.classList.toggle('hidden', !text); ui.host.disabled = ui.join.disabled = false; }
function enterYard() {
  const name = myName();
  try { localStorage.setItem('fishName', name); } catch {}
  myFish.name = name;
  net.send({ type: 'join', name });
  state.joined = true;
}
async function hostGame() {
  showError(''); ui.host.disabled = ui.join.disabled = true;
  ui.statusText.textContent = 'Opening the reef…'; ui.joinForm.classList.add('hidden'); ui.lobbyStatus.classList.remove('hidden');
  sfx.unlock();
  try {
    const code = await net.host(randomCode(), { colliders });
    const link = new URL(location.href); link.search = `?room=${code}`;
    ui.roomCode.textContent = code; ui.shareUrl.textContent = link.toString();
    ui.roomInfo.classList.remove('hidden'); ui.statusText.textContent = 'Waiting for another fish to join…';
    enterYard();
  } catch (err) { ui.lobbyStatus.classList.add('hidden'); ui.joinForm.classList.remove('hidden'); showError(err.message); }
}
async function joinGame() {
  const code = ui.code.value.trim().toUpperCase();
  if (code.length !== 4) { showError('Enter the 4-letter room code from the host.'); ui.code.focus(); return; }
  showError(''); ui.host.disabled = ui.join.disabled = true;
  ui.statusText.textContent = `Swimming into room ${code}…`; ui.joinForm.classList.add('hidden'); ui.lobbyStatus.classList.remove('hidden');
  sfx.unlock();
  try { await net.join(code); ui.statusText.textContent = 'Connected! Starting…'; enterYard(); }
  catch (err) { ui.lobbyStatus.classList.add('hidden'); ui.joinForm.classList.remove('hidden'); showError(err.message); }
}
ui.host.addEventListener('click', hostGame);
ui.join.addEventListener('click', joinGame);
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
ui.code.addEventListener('input', () => { ui.code.value = ui.code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
ui.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') (ui.code.value ? joinGame() : hostGame()); });
ui.copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(ui.shareUrl.textContent); ui.copy.textContent = 'Copied!'; } catch { ui.copy.textContent = 'Select & copy'; }
  setTimeout(() => (ui.copy.textContent = 'Copy'), 1500);
});
{
  try { const saved = localStorage.getItem('fishName'); if (saved) ui.name.value = saved; } catch {}
  const room = new URLSearchParams(location.search).get('room');
  if (room) ui.code.value = room.toUpperCase().slice(0, 4);
  ui.name.focus();
}

// ---- HUD -----------------------------------------------------------------
function fmt(sec) { sec = Math.max(0, sec | 0); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
function updateHud() {
  const amHider = state.role === 'hider';
  ui.role.textContent = amHider ? '🐠 HIDER' : state.role === 'seeker' ? '🔫 SEEKER' : '—';
  ui.role.className = 'pill ' + (state.role || '');
  ui.timer.textContent = fmt(state.timeLeft);
  ui.timer.classList.toggle('urgent', state.phase === 'seek' && state.timeLeft <= 10);
  const other = [...remotes.values()][0];
  const hitsTxt = state.phase === 'seek' ? (amHider ? ` · hits ${state.hits}/${HITS_TO_CATCH}` : ` · hits ${other?.hits ?? 0}/${HITS_TO_CATCH}`) : '';
  ui.score.textContent = `${myFish.name || 'You'} ${state.wins} · ${other?.wins ?? 0} ${state.otherName || '…'}${hitsTxt}`;
  ui.phase.textContent = state.phase === 'hide' ? `Round ${state.round} — hiding time` : state.phase === 'seek' ? `Round ${state.round} — seeking!` : state.phase === 'result' ? 'Next round soon…' : '';
  ui.blindCount.textContent = state.timeLeft;
  ui.health.style.width = `${state.hp}%`;
  ui.health.classList.toggle('low', state.hp <= 30);
  ui.healthText.textContent = state.hp;
  if (state.phase === 'hide' && state.timeLeft <= 5 && state.timeLeft !== state.lastTick) sfx.tick();
  state.lastTick = state.timeLeft;
}

// ---- Camera --------------------------------------------------------------
const camTarget = new THREE.Vector3(), camDir = new THREE.Vector3(), camForward = new THREE.Vector3(), camRight = new THREE.Vector3(), camFlat = new THREE.Vector3();
const SHOULDER = new THREE.Vector3();
function updateCamera(dt) {
  camRight.set(Math.cos(cam.theta), 0, -Math.sin(cam.theta));
  // over-the-shoulder: look past the fish so it never sits under the crosshair
  me.center(camTarget).addScaledVector(camRight, 1.1).add(SHOULDER.set(0, 0.45, 0));
  const cp = Math.cos(cam.pitch);
  camDir.set(Math.sin(cam.theta) * cp, Math.sin(cam.pitch), Math.cos(cam.theta) * cp);
  let dist = cam.dist;
  for (const b of camBlockers) { const t = rayBox(camTarget, camDir, b); if (t < dist) dist = Math.max(0.7, t - 0.3); }
  if (camTarget.y + camDir.y * dist < 0.3) dist = Math.max(0.7, (0.3 - camTarget.y) / camDir.y);
  if (camTarget.y + camDir.y * dist > ARENA.surface - 0.2) dist = Math.max(0.7, (ARENA.surface - 0.2 - camTarget.y) / camDir.y);
  cam.curDist += (dist - cam.curDist) * (dist < cam.curDist ? 1 : 1 - Math.exp(-dt * 6));
  camera.position.copy(camTarget).addScaledVector(camDir, cam.curDist);
  camera.lookAt(camTarget);
  camForward.copy(camDir).negate();
  camFlat.set(-Math.sin(cam.theta), 0, -Math.cos(cam.theta));
  myFish.root.visible = cam.curDist > 1.0;
  for (const v of hideVolumes) {
    const inside = pointInBox(camTarget, v.box) || pointInBox(camera.position, v.box);
    for (const m of v.mats) { const t = inside ? 0.3 : 1; m.opacity += (t - m.opacity) * (1 - Math.exp(-dt * 8)); m.transparent = m.opacity < 0.995; m.depthWrite = !m.transparent; }
  }
}
function pointInBox(p, b) { return p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z; }

// ---- Effects: flares, pearls, ink clouds ---------------------------------
const flareMeshes = new Map();
const flareGeo = new THREE.SphereGeometry(0.22, 10, 8);
function syncFlares() {
  const seen = new Set();
  for (const f of state.flares) {
    seen.add(f.id);
    let m = flareMeshes.get(f.id);
    if (!m) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(flareGeo, new THREE.MeshBasicMaterial({ color: 0xffe3b0 }));
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.35, depthWrite: false }));
      const light = new THREE.PointLight(0xff6a30, 60, 18, 1.6);
      light.position.y = 0.4;
      g.add(core, glow, light);
      g.position.set(f.pos.x, f.pos.y, f.pos.z);
      scene.add(g);
      m = { g, glow, light, t: Math.random() * 10 };
      flareMeshes.set(f.id, m);
    }
    m.left = f.left;
  }
  for (const [id, m] of flareMeshes) if (!seen.has(id)) { scene.remove(m.g); flareMeshes.delete(id); }
}
const pearlMeshes = new Map();
function syncPearls() {
  for (const q of state.pearls) {
    let m = pearlMeshes.get(q.id);
    if (!m) {
      const g = new THREE.Group();
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fdcff, emissiveIntensity: 0.8, roughness: 0.2 }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.04, 6, 24), new THREE.MeshBasicMaterial({ color: 0xbfeeff, transparent: true, opacity: 0.7 }));
      const light = new THREE.PointLight(0x9fdcff, 25, 10, 1.8);
      g.add(pearl, ring, light);
      g.position.set(q.pos.x, q.pos.y, q.pos.z);
      scene.add(g);
      m = { g, ring, t: Math.random() * 10 };
      pearlMeshes.set(q.id, m);
    }
    m.g.visible = q.active;
  }
}
const inks = [];
function spawnInk(pos, secs, mine = false) {
  // your own cloud stays see-through for you; everyone else sees a solid black blob
  const m = new THREE.Mesh(new THREE.SphereGeometry(4.5, 18, 14), new THREE.MeshBasicMaterial({ color: 0x07071a, transparent: true, opacity: mine ? 0.3 : 0.92, depthWrite: false, side: THREE.FrontSide }));
  m.position.set(pos.x, pos.y, pos.z);
  m.scale.setScalar(0.2);
  scene.add(m);
  inks.push({ m, life: secs, total: secs, max: mine ? 0.3 : 0.92 });
}
function updateEffects(dt, now) {
  for (const m of flareMeshes.values()) {
    m.t += dt;
    const flicker = 0.8 + Math.sin(m.t * 23) * 0.15 + Math.sin(m.t * 7) * 0.1;
    m.light.intensity = 60 * flicker * Math.min(1, (m.left ?? 1) / 2);
    m.glow.scale.setScalar(flicker * (0.9 + Math.sin(m.t * 3) * 0.1));
    if (Math.random() < dt * 12) bullets.puff(m.g.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5, (Math.random() - 0.5) * 0.4)), 0.4);
  }
  for (const m of pearlMeshes.values()) {
    m.t += dt;
    m.g.position.y += Math.sin(m.t * 1.5) * dt * 0.25;
    m.ring.rotation.x = m.t * 0.8; m.ring.rotation.y = m.t * 0.5;
  }
  for (let i = inks.length - 1; i >= 0; i--) {
    const k = inks[i];
    k.life -= dt;
    const grow = Math.min(1, (k.total - k.life) / 0.6);
    k.m.scale.setScalar(0.2 + grow * 0.8 + Math.sin(now * 2) * 0.03);
    k.m.material.opacity = k.max * Math.min(1, k.life / 1.5);
    if (k.life <= 0) { scene.remove(k.m); inks.splice(i, 1); }
  }
}
function updateAbilityChips() {
  const amHider = state.role === 'hider';
  const specialName = amHider ? 'Ink' : 'Sonar';
  const specialCd = amHider ? state.cd.ink : state.cd.sonar;
  const specialMax = amHider ? 20 : 15;
  for (const [chip, cd, max, label] of [[ui.chipFlare, state.cd.flare, 15, 'Flare'], [ui.chipSpecial, specialCd, specialMax, specialName]]) {
    chip.querySelector('span').textContent = cd > 0.05 ? `${label} ${Math.ceil(cd)}s` : label;
    chip.querySelector('em').style.height = `${Math.min(100, cd / max * 100)}%`;
    const cooling = cd > 0.05;
    if (chip.classList.contains('cooling') && !cooling) { chip.classList.add('ready'); setTimeout(() => chip.classList.remove('ready'), 400); }
    chip.classList.toggle('cooling', cooling);
  }
}

// ---- Shooting ------------------------------------------------------------
let fireCd = 0;
const aimPoint = new THREE.Vector3(), muzzle = new THREE.Vector3(), shotDir = new THREE.Vector3();
function tryShoot() {
  if (fireCd > 0 || me.frozen || me.dead || !state.joined) return;
  // the seeker's gun is heavier: fewer shots per second than the hider's
  fireCd = state.role === 'seeker' ? 0.6 : 0.22;
  // aim at whatever the crosshair is on
  let t = 70;
  for (const b of colliders) { const h = rayBox(camera.position, camForward, b); if (h < t && h > cam.curDist) t = h; }
  for (const s of sharks.values()) for (const c of sharkSpheres(s)) { const h = raySphere(camera.position, camForward, c.center, c.radius); if (h < t) t = h; }
  aimPoint.copy(camera.position).addScaledVector(camForward, t);
  myFish.muzzleWorld(muzzle);
  shotDir.copy(aimPoint).sub(muzzle).normalize();
  bullets.spawn(muzzle, shotDir, state.role, true);
  myFish.fireFlash();
  sfx.shoot();
  net.send({ type: 'shoot', o: [muzzle.x, muzzle.y, muzzle.z], d: [shotDir.x, shotDir.y, shotDir.z] });
}
function sharkSpheres(s) {
  const f = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
  return [-0.9, 0, 0.9].map(k => ({ kind: 'shark', id: s.id, center: s.pos.clone().addScaledVector(f, k), radius: 0.8 }));
}

// ---- Loop ----------------------------------------------------------------
let last = performance.now(), netAcc = 0, heartbeat = 0;
const input = { f: 0, b: 0, l: 0, r: 0, up: 0, down: 0, sprint: false };
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min((nowMs - last) / 1000, 0.05);
  last = nowMs;
  const now = nowMs / 1000;
  const amHider = state.role === 'hider', amSeeker = state.role === 'seeker';
  me.frozen = !state.joined || state.phase === 'lobby' || state.phase === 'result' || (state.phase === 'hide' && amSeeker);
  me.cover = state.phase === 'hide' && amSeeker;
  me.dazed = state.dazed || now < state.inkUntil;
  me.dead = state.dead;
  me.baseSpeed = (amSeeker ? 7 : 6.5) * (state.boost ? 1.4 : 1);

  input.f = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
  input.b = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  input.l = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0;
  input.r = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;
  input.up = keys.has('Space') ? 1 : 0;
  input.down = keys.has('KeyC') || keys.has('ControlLeft') ? 1 : 0;
  input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');

  updateCamera(0);
  me.update(dt, input, camForward, camRight);
  updateCamera(dt);
  for (const r of remotes.values()) r.update(dt);
  for (const s of sharks.values()) s.update(dt);
  updateWorld(now, dt);

  fireCd -= dt;
  state.cd.flare = Math.max(0, state.cd.flare - dt); state.cd.ink = Math.max(0, state.cd.ink - dt); state.cd.sonar = Math.max(0, state.cd.sonar - dt);
  if (shootQueued || shootHeld) { shootQueued = false; tryShoot(); }
  if (tagQueued) { tagQueued = false; if (amSeeker && state.phase === 'seek') net.send({ type: 'tag' }); }
  if (flareQueued) { flareQueued = false; if (!me.frozen && !me.dead && state.cd.flare <= 0.05) { net.send({ type: 'flare' }); state.cd.flare = 15; } else sfx.miss(); }
  if (specialQueued) {
    specialQueued = false;
    if (amHider && !me.frozen && !me.dead && state.cd.ink <= 0.05) { net.send({ type: 'ink' }); state.cd.ink = 20; sfx.ink(); }
    else if (amSeeker && state.phase === 'seek' && !me.dead && state.cd.sonar <= 0.05) { net.send({ type: 'sonar' }); state.cd.sonar = 15; }
    else sfx.miss();
  }
  updateEffects(dt, now);
  updateAbilityChips();
  ui.staminaBar.style.width = `${Math.round(me.stamina * 100)}%`;
  ui.staminaBar.classList.toggle('exhausted', me.exhausted);

  // bullets: own-shot targets are sharks and the other fish
  const targets = [];
  for (const s of sharks.values()) if (s.state !== 'dead') targets.push(...sharkSpheres(s));
  for (const r of remotes.values()) if (!r.extra.dead) targets.push({ kind: 'player', id: r.id, center: r.pos.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT / 2, 0)), radius: 0.7 });
  bullets.update(dt, targets);

  // overlays
  ui.hurt.style.opacity = Math.max(0, parseFloat(ui.hurt.style.opacity || 0) - dt * 2.5);
  ui.ink.style.opacity = now < state.inkUntil ? Math.min(0.95, (state.inkUntil - now) / 0.6) : 0;
  let sharkNear = false;
  for (const s of sharks.values()) if (s.state === 'chase' && s.tgt === state.myId && s.pos.distanceTo(me.pos) < 22) sharkNear = true;
  ui.sharkWarn.classList.toggle('show', sharkNear && !me.frozen);

  const other = [...remotes.values()][0];
  let near = Infinity;
  if (other && state.phase === 'seek') near = me.pos.distanceTo(other.pos);
  if (amHider && state.phase === 'seek') {
    ui.danger.style.opacity = THREE.MathUtils.clamp(1 - near / 14, 0, 0.85).toFixed(2);
    heartbeat -= dt;
    if (near < 10 && heartbeat <= 0) { sfx.thump(); heartbeat = THREE.MathUtils.clamp(near / 10, 0.25, 1.1); }
  } else ui.danger.style.opacity = 0;

  ui.crosshair.classList.toggle('hot', amSeeker && near <= 2.0);
  {
    let onTarget = false;
    for (const sh of sharks.values()) if (sh.state !== 'dead') for (const c of sharkSpheres(sh)) if (raySphere(camera.position, camForward, c.center, c.radius) < 80) onTarget = true;
    for (const r of remotes.values()) if (raySphere(camera.position, camForward, r.pos.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT / 2, 0)), 0.7) < 80) onTarget = true;
    ui.crosshair.classList.toggle('target', onTarget);
  }
  if (amSeeker && state.phase === 'seek') {
    if (near <= 2.0) { ui.hint.textContent = 'Press E to TAG!'; ui.hint.classList.add('action'); }
    else { ui.hint.textContent = 'Find the hider · click to shoot (3 hits) · E tag · R sonar · Q flare · Shift sprint burst'; ui.hint.classList.remove('action'); }
    const showSense = (state.timeLeft <= 30 && other) || (now < state.revealUntil && state.revealPos);
    ui.sense.classList.toggle('show', !!showSense);
    if (showSense) {
      const tp = now < state.revealUntil && state.revealPos ? state.revealPos : other.pos;
      const rel = Math.atan2(tp.x - me.pos.x, tp.z - me.pos.z) - Math.atan2(camFlat.x, camFlat.z);
      ui.senseArrow.style.transform = `rotate(${(-rel - Math.PI / 2).toFixed(3)}rad)`;
      ui.senseText.textContent = now < state.revealUntil ? state.revealText : 'You sense the hider…';
    }
  } else {
    ui.sense.classList.remove('show');
    if (amHider && state.phase === 'hide') ui.hint.textContent = 'Hide! Kelp, caves, pipes, clams, the wreck… Space/C up/down · Shift sprint burst';
    else if (amHider && state.phase === 'seek') ui.hint.textContent = 'Stay hidden! R ink cloud · Q flare lures LeBron · your shots ink the seeker · 3 hits = caught';
    else { ui.hint.textContent = 'WASD swim · Space up · C down · Shift sprint burst · Click to shoot · E to tag'; }
    ui.hint.classList.remove('action');
  }

  netAcc += dt;
  if (netAcc >= 1 / 20 && state.joined) {
    netAcc = 0;
    net.send({ type: 'move', pos: { x: me.pos.x, y: me.pos.y, z: me.pos.z }, yaw: me.yaw, anim: me.anim });
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.__dbg = { me, state, remotes, sharks, cam, net, bullets };
