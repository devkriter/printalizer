// Threads: ISO sizes, generating thread profiles, and finding existing threads in a mesh.
//
// Finding: an ISO thread's flanks lean 30° from the plane across the axis, so their normals make
// 30° with the axis (|n·axis| ≈ 0.87), half of them pointing each way along it. We gather such triangles around each candidate
// axis, group neighbours, and keep groups that wrap all the way round over more than a turn.

import type { IndexedMesh } from './mesh.ts';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** ISO metric coarse threads: nominal diameter and pitch, in mm. */
export const ISO_COARSE: Array<{ size: string; d: number; p: number }> = [
  { size: 'M2', d: 2, p: 0.4 }, { size: 'M2.5', d: 2.5, p: 0.45 }, { size: 'M3', d: 3, p: 0.5 },
  { size: 'M4', d: 4, p: 0.7 }, { size: 'M5', d: 5, p: 0.8 }, { size: 'M6', d: 6, p: 1 },
  { size: 'M8', d: 8, p: 1.25 }, { size: 'M10', d: 10, p: 1.5 }, { size: 'M12', d: 12, p: 1.75 },
  { size: 'M14', d: 14, p: 2 }, { size: 'M16', d: 16, p: 2 }, { size: 'M18', d: 18, p: 2.5 },
  { size: 'M20', d: 20, p: 2.5 }, { size: 'M24', d: 24, p: 3 },
];

/**
 * Depth profile of one pitch of a trapezoidal thread: 0 on the crest flat, `depth` on the root flat.
 * `flankDeg` is the flank's angle from the plane across the axis (30 for ISO, 45 for printable threads).
 */
export function grooveDepth(s: number, pitch: number, flankDeg: number, crest: number): { depth: number; q: number } {
  // A flank at angle φ from the plane across the axis climbs tan φ along the axis per unit of depth.
  const t = Math.tan((flankDeg * Math.PI) / 180);
  const depth = Math.max(0, (pitch - 2 * crest) / (2 * t));
  const side = depth * t; // axial width of one flank
  const u = ((s % pitch) + pitch) % pitch;
  let q: number;
  if (u < crest) q = 0;
  else if (u < crest + side) q = (u - crest) / t;
  else if (u < 2 * crest + side) q = depth;
  else q = Math.max(0, depth - (u - 2 * crest - side) / t);
  return { depth, q };
}

/**
 * The outline across the axis of a single-start right-hand thread, at the thread's start.
 * Extrude it along +Z with a twist of 360°·length/pitch to get the helix.
 * internal: the hole's outline (empty inside), from `outerR - depth` out to `outerR`.
 * external: the rod's outline, from `outerR` down to `outerR - depth`.
 */
export function threadOutline(kind: 'internal' | 'external', outerR: number, pitch: number, flankDeg: number, crest: number, segments = 240): Vec2[] {
  const { depth } = grooveDepth(0, pitch, flankDeg, crest);
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * 2 * Math.PI;
    const s = -(th / (2 * Math.PI)) * pitch;
    const { q } = grooveDepth(s, pitch, flankDeg, crest);
    const r = kind === 'internal' ? outerR - depth + q : outerR - q;
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  return pts;
}

export interface FoundThread {
  kind: 'internal' | 'external';
  axis: Vec3;
  start: Vec3;
  length: number;
  majorD: number;
  minorD: number;
  pitch: number;
  size: string;
  hand: 'right' | 'left';
  triangles: number[];
}

function canonical(v: Vec3): Vec3 {
  let k = 0;
  if (Math.abs(v[1]) > Math.abs(v[k])) k = 1;
  if (Math.abs(v[2]) > Math.abs(v[k])) k = 2;
  return v[k] < 0 ? [-v[0], -v[1], -v[2]] : v;
}

function frame(axis: Vec3): [Vec3, Vec3] {
  const a: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = a[0] * axis[0] + a[1] * axis[1] + a[2] * axis[2];
  const u0: Vec3 = [a[0] - d * axis[0], a[1] - d * axis[1], a[2] - d * axis[2]];
  const l = Math.hypot(...u0);
  const u: Vec3 = [u0[0] / l, u0[1] / l, u0[2] / l];
  return [u, [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]]];
}

function fitCircle(pts: number[]): { cx: number; cy: number; r: number } | null {
  const n = pts.length / 2;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += pts[i * 2]; my += pts[i * 2 + 1]; }
  mx /= n; my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (let i = 0; i < n; i++) {
    const u = pts[i * 2] - mx, v = pts[i * 2 + 1] - my;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-18) return null;
  const bu = 0.5 * (suuu + suvv), bv = 0.5 * (svvv + svuu);
  const uc = (bu * svv - bv * suv) / det, vc = (suu * bv - suv * bu) / det;
  return { cx: uc + mx, cy: vc + my, r: Math.sqrt(uc * uc + vc * vc + (suu + svv) / n) };
}

/**
 * Checks that crest points (radius above `crestR`) lie on a helix, and measures its pitch.
 * Per 10° sector: crest positions along the axis repeat every pitch; their phase must advance by
 * one pitch per turn (right- or left-handed).
 */
function helixCheck(angles: number[], zs: number[], radii: number[], crestR: number, roughPitch: number): { pitch: number; hand: 'right' | 'left' } | null {
  const sectors: number[][] = Array.from({ length: 36 }, () => []);
  for (let i = 0; i < angles.length; i++) {
    if (radii[i] < crestR) continue;
    sectors[Math.min(35, Math.floor(((angles[i] + Math.PI) / (2 * Math.PI)) * 36))].push(zs[i]);
  }
  // Pitch: median spacing between crest clusters within sectors.
  const spacings: number[] = [];
  const centres: number[][] = [];
  for (const s of sectors) {
    s.sort((a, b) => a - b);
    const cl: number[] = [];
    let start = 0;
    for (let i = 1; i <= s.length; i++) {
      if (i === s.length || s[i] - s[i - 1] > roughPitch * 0.3) {
        const part = s.slice(start, i);
        cl.push(part.reduce((a, b) => a + b, 0) / part.length);
        start = i;
      }
    }
    centres.push(cl);
    for (let i = 1; i < cl.length; i++) spacings.push(cl[i] - cl[i - 1]);
  }
  if (spacings.length < 10) return null;
  spacings.sort((a, b) => a - b);
  const pitch = spacings[Math.floor(spacings.length / 2)];
  if (!(pitch > 0.15)) return null;
  // Phase of the crests in each sector, compared with how a helix would advance.
  const resultant = (sign: number) => {
    let sx = 0, sy = 0, n = 0;
    centres.forEach((cl, b) => {
      for (const z of cl) {
        const ph = 2 * Math.PI * (z / pitch - sign * (b / 36));
        sx += Math.cos(ph); sy += Math.sin(ph); n++;
      }
    });
    return n ? Math.hypot(sx, sy) / n : 0;
  };
  const right = resultant(1), left = resultant(-1), rings = resultant(0);
  const best = Math.max(right, left);
  if (best < 0.7 || best < rings + 0.2) return null;
  return { pitch, hand: right >= left ? 'right' : 'left' };
}

const pct = (sorted: number[], f: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))];

export function findThreads(mesh: IndexedMesh, extraAxes: Vec3[] = [], debug?: (line: string) => void): FoundThread[] {
  const { vert, tri } = mesh;
  const nt = tri.length / 3;
  const normal = new Float64Array(nt * 3);
  const area = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
    const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2];
    const vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    area[t] = l / 2;
    const s = l || 1;
    normal[t * 3] = nx / s; normal[t * 3 + 1] = ny / s; normal[t * 3 + 2] = nz / s;
  }
  const axes: Vec3[] = [];
  for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1], ...extraAxes] as Vec3[]) {
    const c = canonical(a);
    if (!axes.some((b) => Math.abs(b[0] * c[0] + b[1] * c[1] + b[2] * c[2]) > Math.cos((2 * Math.PI) / 180))) axes.push(c);
  }
  const found: FoundThread[] = [];
  const taken = new Uint8Array(nt);
  for (const axis of axes) {
    // Flank triangles for this axis.
    const cand: number[] = [];
    for (let t = 0; t < nt; t++) {
      if (taken[t]) continue;
      const d = Math.abs(normal[t * 3] * axis[0] + normal[t * 3 + 1] * axis[1] + normal[t * 3 + 2] * axis[2]);
      if (d > 0.8 && d < 0.93) cand.push(t); // ISO 60° (0.866) and Whitworth 55° (0.887)
    }
    if (cand.length < 24) continue;
    // Group candidates that share a vertex.
    const parent = new Map<number, number>();
    const find = (x: number): number => { let p = parent.get(x)!; while (p !== x) { const g = parent.get(p)!; parent.set(x, g); x = p; p = g; } return x; };
    for (const t of cand) parent.set(t, t);
    const byVert = new Map<number, number>();
    for (const t of cand) for (let k = 0; k < 3; k++) {
      const v = tri[t * 3 + k];
      const o = byVert.get(v);
      if (o === undefined) byVert.set(v, t);
      else { const ra = find(o), rb = find(t); if (ra !== rb) parent.set(ra, rb); }
    }
    const groups = new Map<number, number[]>();
    for (const t of cand) { const r = find(t); const g = groups.get(r); if (g) g.push(t); else groups.set(r, [t]); }
    const [U, V] = frame(axis);
    // Fit each group's circle, then merge groups that share an axis line (the two flank ribbons).
    const fitted: Array<{ tris: number[]; cx: number; cy: number; r: number }> = [];
    for (const g of groups.values()) {
      if (g.length < 12) continue;
      const pts: number[] = [];
      const seen = new Set<number>();
      for (const t of g) for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k];
        if (seen.has(v)) continue;
        seen.add(v);
        pts.push(vert[v * 3] * U[0] + vert[v * 3 + 1] * U[1] + vert[v * 3 + 2] * U[2], vert[v * 3] * V[0] + vert[v * 3 + 1] * V[1] + vert[v * 3 + 2] * V[2]);
      }
      const c = fitCircle(pts);
      if (c && c.r > 0.5) fitted.push({ tris: g, ...c });
    }
    const used = new Array(fitted.length).fill(false);
    for (let i = 0; i < fitted.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const tris = [...fitted[i].tris];
      for (let j = i + 1; j < fitted.length; j++) {
        if (used[j]) continue;
        if (Math.hypot(fitted[j].cx - fitted[i].cx, fitted[j].cy - fitted[i].cy) < Math.max(0.1, fitted[i].r * 0.04) && Math.abs(fitted[j].r - fitted[i].r) < fitted[i].r * 0.25) {
          used[j] = true;
          tris.push(...fitted[j].tris);
        }
      }
      const t = measure(tris, fitted[i].cx, fitted[i].cy);
      if (t) { found.push(t); for (const x of tris) taken[x] = 1; }
    }

    function measure(tris: number[], cx: number, cy: number): FoundThread | null {
      const why = (s: string) => { debug?.(`axis ${axis.map((x) => x.toFixed(2))} centre ${cx.toFixed(1)},${cy.toFixed(1)} ${tris.length} tris: ${s}`); return null; };
      if (tris.length < 24) return why('too few triangles');
      const radii: number[] = [];
      const zs: number[] = [];
      const angles: number[] = [];
      const bins = new Uint8Array(36);
      const seen = new Set<number>();
      for (const t of tris) for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k];
        if (seen.has(v)) continue;
        seen.add(v);
        const x = vert[v * 3] * U[0] + vert[v * 3 + 1] * U[1] + vert[v * 3 + 2] * U[2] - cx;
        const y = vert[v * 3] * V[0] + vert[v * 3 + 1] * V[1] + vert[v * 3 + 2] * V[2] - cy;
        radii.push(Math.hypot(x, y));
        zs.push(vert[v * 3] * axis[0] + vert[v * 3 + 1] * axis[1] + vert[v * 3 + 2] * axis[2]);
        angles.push(Math.atan2(y, x));
        bins[Math.min(35, Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * 36))] = 1;
      }
      if (bins.reduce((a, b) => a + b, 0) < 33) return why('does not wrap all the way round');
      // Flanks must face both ways along the axis, and point consistently towards or away from it.
      let up = 0, down = 0, inward = 0, outward = 0;
      for (const t of tris) {
        const n = normal.subarray(t * 3, t * 3 + 3);
        const d = n[0] * axis[0] + n[1] * axis[1] + n[2] * axis[2];
        if (d > 0) up += area[t]; else down += area[t];
        let gx = 0, gy = 0;
        for (let k = 0; k < 3; k++) {
          const v = tri[t * 3 + k];
          gx += vert[v * 3] * U[0] + vert[v * 3 + 1] * U[1] + vert[v * 3 + 2] * U[2] - cx;
          gy += vert[v * 3] * V[0] + vert[v * 3 + 1] * V[1] + vert[v * 3 + 2] * V[2] - cy;
        }
        const radial = (n[0] * U[0] + n[1] * U[1] + n[2] * U[2]) * gx + (n[0] * V[0] + n[1] * V[1] + n[2] * V[2]) * gy;
        if (radial < 0) inward += area[t]; else outward += area[t];
      }
      const total = up + down;
      if (Math.min(up, down) < total * 0.25) return why('flanks face only one way (a cone or countersink)');
      if (Math.max(inward, outward) < total * 0.85) return why('mixed inward and outward faces');
      const sortedR = [...radii].sort((a, b) => a - b);
      const sortedZ = [...zs].sort((a, b) => a - b);
      const rMin = pct(sortedR, 0.02), rMax = pct(sortedR, 0.98);
      const depth = rMax - rMin;
      if (depth < 0.1 || depth > rMax * 0.35) return why(`depth ${depth.toFixed(2)} out of range`);
      const length = sortedZ[sortedZ.length - 1] - sortedZ[0];
      // ISO threads are between 0.54 P (basic profile) and 0.65 P (sharper models) deep.
      const roughPitch = depth / 0.6;
      if (length < roughPitch * 1.5) return why('shorter than a turn and a half');
      // A helix: at each angle the crests repeat every pitch, and their position along the axis
      // advances steadily as you go round. Stacked rings or ribs repeat but don't advance.
      const helix = helixCheck(angles, zs, radii, rMax - depth * 0.3, roughPitch);
      if (!helix) return why('crests do not form a helix');
      const pitch = helix.pitch;
      const major = 2 * rMax;
      let best = ISO_COARSE[0], bestErr = Infinity;
      for (const iso of ISO_COARSE) { const e = Math.abs(iso.d - major); if (e < bestErr) { bestErr = e; best = iso; } }
      const isoFits = bestErr < Math.max(0.45, major * 0.06) && Math.abs(best.p - pitch) < best.p * 0.2;
      const kind = inward > outward ? 'internal' : 'external';
      const z0 = sortedZ[0];
      const start: Vec3 = [
        cx * U[0] + cy * V[0] + z0 * axis[0],
        cx * U[1] + cy * V[1] + z0 * axis[1],
        cx * U[2] + cy * V[2] + z0 * axis[2],
      ];
      return {
        kind, axis, start, length,
        majorD: major, minorD: 2 * rMin,
        pitch: isoFits ? best.p : Math.round(pitch * 100) / 100,
        size: isoFits ? best.size : `⌀${major.toFixed(1)}`,
        hand: helix.hand,
        triangles: tris,
      };
    }
  }
  return found;
}
