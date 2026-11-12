// Putting a part on the bed: turn a chosen face to point straight down, then rest it on the bed.

import type { Manifold, Mat4 } from 'manifold-3d';

export type Vec3 = [number, number, number];
/** Row-major 3x3. */
export type Mat3R = [number, number, number, number, number, number, number, number, number];

const DOWN: Vec3 = [0, 0, -1];

/** Rotation that turns unit vector `n` to point straight down (-Z), by the shortest turn. */
export function rotationToDown(n: Vec3): Mat3R {
  const l = Math.hypot(...n) || 1;
  const a: Vec3 = [n[0] / l, n[1] / l, n[2] / l];
  const c = a[0] * DOWN[0] + a[1] * DOWN[1] + a[2] * DOWN[2];
  if (c > 1 - 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (c < -1 + 1e-12) return [1, 0, 0, 0, -1, 0, 0, 0, -1]; // pointing up: half turn about X
  // Rodrigues: axis k = a x down, angle from c.
  const k: Vec3 = [a[1] * DOWN[2] - a[2] * DOWN[1], a[2] * DOWN[0] - a[0] * DOWN[2], a[0] * DOWN[1] - a[1] * DOWN[0]];
  const s = Math.hypot(...k);
  const x = k[0] / s, y = k[1] / s, z = k[2] / s, t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/** Rotation by a multiple of 90 degrees about Z. */
export function turnZ(quarterTurns: number): Mat3R {
  const q = ((quarterTurns % 4) + 4) % 4;
  const c = [1, 0, -1, 0][q], s = [0, 1, 0, -1][q];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function apply(R: Mat3R, v: Vec3): Vec3 {
  return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
}

/** Manifold's column-major 4x4 from a row-major rotation and a translation. */
export function mat4(R: Mat3R, t: Vec3 = [0, 0, 0]): Mat4 {
  return [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
}

/**
 * The outward normal of the largest flat face the part can rest on: the part's own faces,
 * grouped by plane, keeping only planes with nothing of the part beyond them.
 */
export function autoDownNormal(solid: Manifold): Vec3 {
  const m = solid.getMesh();
  const p = m.vertProperties, np = m.numProp, t = m.triVerts;
  const faces = new Map<string, { n: Vec3; d: number; area: number }>();
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * np, b = t[i + 1] * np, c = t[i + 2] * np;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) continue;
    const n: Vec3 = [nx / l, ny / l, nz / l];
    const d = n[0] * p[a] + n[1] * p[a + 1] + n[2] * p[a + 2];
    const key = `${n.map((x) => Math.round(x * 1e4)).join(',')},${Math.round(d * 1e2)}`;
    const f = faces.get(key);
    if (f) f.area += l / 2; else faces.set(key, { n, d, area: l / 2 });
  }
  const candidates = [...faces.values()].sort((x, y) => y.area - x.area).slice(0, 64);
  const nv = p.length / np;
  const b = solid.boundingBox();
  const eps = Math.max(1e-4, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 1e-6);
  for (const f of candidates) {
    let beyond = false;
    for (let v = 0; v < nv && !beyond; v++) {
      if (f.n[0] * p[v * np] + f.n[1] * p[v * np + 1] + f.n[2] * p[v * np + 2] > f.d + eps) beyond = true;
    }
    if (!beyond) return f.n;
  }
  return DOWN;
}

/** Move the part so it rests on the bed (lowest point at z = 0), centred on (cx, cy). */
export function placeOnBed(solid: Manifold, cx: number, cy: number): Manifold {
  const b = solid.boundingBox();
  return solid.translate([cx - (b.min[0] + b.max[0]) / 2, cy - (b.min[1] + b.max[1]) / 2, -b.min[2]]);
}
