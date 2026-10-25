// Shared axis-aligned-box physics used by the local player and the host's sharks.

export const ARENA = { half: 34, floor: 0.2, surface: 17 };

/** Does the box at (pos = bottom-center, half, height) overlap collider c? */
export function overlaps(pos, half, height, c) {
  return pos.x - half < c.max.x && pos.x + half > c.min.x &&
         pos.y < c.max.y && pos.y + height > c.min.y &&
         pos.z - half < c.max.z && pos.z + half > c.min.z;
}

/**
 * Move a box through the colliders one axis at a time. Mutates pos; returns which axes were blocked.
 * @param {{x:number,y:number,z:number}} pos bottom-center
 */
export function sweep(pos, half, height, delta, colliders) {
  const blocked = { x: false, y: false, z: false };
  for (const axis of ['x', 'z', 'y']) {
    const d = delta[axis];
    if (d === 0) continue;
    pos[axis] += d;
    for (const c of colliders) {
      if (!overlaps(pos, half, height, c)) continue;
      blocked[axis] = true;
      if (axis === 'y') pos.y = d < 0 ? c.max.y : c.min.y - height;
      else pos[axis] = d > 0 ? c.min[axis] - half : c.max[axis] + half;
    }
  }
  // arena bounds: sand floor, surface, invisible reef walls
  if (pos.y < ARENA.floor) { pos.y = ARENA.floor; blocked.y = true; }
  if (pos.y + height > ARENA.surface) { pos.y = ARENA.surface - height; blocked.y = true; }
  const lim = ARENA.half - half;
  if (pos.x < -lim) { pos.x = -lim; blocked.x = true; }
  if (pos.x > lim) { pos.x = lim; blocked.x = true; }
  if (pos.z < -lim) { pos.z = -lim; blocked.z = true; }
  if (pos.z > lim) { pos.z = lim; blocked.z = true; }
  return blocked;
}

/** Ray vs box slab test. Returns entry distance (0 if inside) or Infinity. */
export function rayBox(o, d, b) {
  let tmin = 0, tmax = Infinity;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-8) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return Infinity;
      continue;
    }
    let t1 = (b.min[a] - o[a]) / d[a], t2 = (b.max[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Ray vs sphere. Returns distance or Infinity. */
export function raySphere(o, d, c, r) {
  const lx = c.x - o.x, ly = c.y - o.y, lz = c.z - o.z;
  const tca = lx * d.x + ly * d.y + lz * d.z;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  const thc = Math.sqrt(r * r - d2);
  const t0 = tca - thc;
  if (t0 >= 0) return t0;
  if (tca + thc >= 0) return 0;
  return Infinity;
}

export function lerpAngle(a, b, t) {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
