// Finding cylindrical holes and bosses in a triangle mesh.
//
// How it works:
// 1. Seed: two neighbouring triangles that meet at a small angle. Their shared edge is a first
//    guess at the axis. Grow a strict run of strips around it: normals perpendicular to the axis,
//    strips meeting along edges parallel to it. Drop wide flat faces that joined tangentially.
// 2. Refine: take the axis as the direction all the run's normals are perpendicular to, fit a
//    circle to the run's corners, then regrow loosely: any neighbour whose normal is perpendicular
//    to the axis and whose corners lie on the fitted cylinder joins. Repeat a few times.
//    This copes with exporters that cut hole walls diagonally or slightly off the true axis.
// 3. Keep runs that fit a circle well and whose normals all point to (hole) or from (boss) the axis.

import type { IndexedMesh } from './mesh.ts';

export type Vec3 = [number, number, number];

export interface Cylinder {
  kind: 'hole' | 'boss';
  /** Unit axis, with its largest component positive. */
  axis: Vec3;
  /** A point on the axis, at the middle of the cylinder's length. */
  center: Vec3;
  radius: number;
  length: number;
  /** Degrees of the circle covered by the surface: about 360 for a full hole. */
  coverage: number;
  /** Estimated number of flat sides a full circle would have. */
  segments: number;
  /** Root-mean-square distance of the corners from the fitted cylinder, divided by the radius. */
  fitError: number;
  orientation: 'horizontal' | 'vertical' | 'angled';
  triangles: number[];
}

export interface FindOptions {
  /** Largest angle between neighbouring strips, so circles with fewer sides than 360/this are ignored. */
  maxStepDeg: number;
  /** Strips closer than this in angle count as one flat face. */
  flatDeg: number;
  /** Allowed tilt of a strip normal or edge while growing the first, strict run. */
  strictTolDeg: number;
  /** Allowed tilt of a normal away from perpendicular to the refined axis. */
  looseTolDeg: number;
  /** How far a corner may sit from the fitted cylinder: the larger of this fraction of the radius… */
  onSurfaceFraction: number;
  /** …and this distance in mm. */
  onSurfaceMm: number;
  /** Largest accepted fit error (fraction of the radius). */
  maxFitError: number;
  minRadius: number;
  /** Axis within this angle of the bed plane counts as horizontal, within it of vertical as vertical. */
  orientationTolDeg: number;
  /** Called with a line per run while it grows, for diagnosing misses. */
  debug?: (line: string) => void;
}

export const defaultFindOptions: FindOptions = {
  maxStepDeg: 46,
  flatDeg: 0.25,
  strictTolDeg: 1.5,
  looseTolDeg: 4,
  onSurfaceFraction: 0.02,
  onSurfaceMm: 0.02,
  maxFitError: 0.02,
  minRadius: 0.3,
  orientationTolDeg: 3,
};

const D2R = Math.PI / 180;

function edgeKey(a: number, b: number) { return a < b ? a * 4294967296 + b : b * 4294967296 + a; }

function canonical(v: Vec3): Vec3 {
  let k = 0;
  if (Math.abs(v[1]) > Math.abs(v[k])) k = 1;
  if (Math.abs(v[2]) > Math.abs(v[k])) k = 2;
  return v[k] < 0 ? [-v[0], -v[1], -v[2]] : v;
}

function frame(axis: Vec3): [Vec3, Vec3] {
  const a: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = a[0] * axis[0] + a[1] * axis[1] + a[2] * axis[2];
  let u: Vec3 = [a[0] - d * axis[0], a[1] - d * axis[1], a[2] - d * axis[2]];
  const l = Math.hypot(...u);
  u = [u[0] / l, u[1] / l, u[2] / l];
  const v: Vec3 = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
  return [u, v];
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Least-squares circle through 2D points (Kasa fit). */
function fitCircle(pts: number[]): { cx: number; cy: number; r: number } | null {
  const n = pts.length / 2;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += pts[i * 2]; my += pts[i * 2 + 1]; }
  mx /= n; my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (let i = 0; i < n; i++) {
    const u = pts[i * 2] - mx, v = pts[i * 2 + 1] - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-18) return null;
  const bu = 0.5 * (suuu + suvv), bv = 0.5 * (svvv + svuu);
  const uc = (bu * svv - bv * suv) / det;
  const vc = (suu * bv - suv * bu) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return { cx: uc + mx, cy: vc + my, r };
}

/** Eigenvector of the smallest eigenvalue of a symmetric 3x3 matrix (Jacobi), with all eigenvalues. */
function smallestEigen(m: number[][]): { vec: Vec3; vals: [number, number, number] } {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  const vals = [a[0][0], a[1][1], a[2][2]];
  const order = [0, 1, 2].sort((i, j) => vals[i] - vals[j]);
  const k = order[0];
  return { vec: [v[0][k], v[1][k], v[2][k]], vals: [vals[order[0]], vals[order[1]], vals[order[2]]] };
}

/** Total length of the union of angular intervals, in degrees. Each interval is taken the short way round. */
function coverageDeg(intervals: Array<[number, number]>): number {
  const segs: Array<[number, number]> = [];
  for (let [a, b] of intervals) {
    let w = b - a;
    while (w < 0) w += 2 * Math.PI;
    while (w >= 2 * Math.PI) w -= 2 * Math.PI;
    if (w > Math.PI) { [a, b] = [b, a]; w = 2 * Math.PI - w; }
    a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (a + w > 2 * Math.PI) { segs.push([a, 2 * Math.PI]); segs.push([0, a + w - 2 * Math.PI]); }
    else segs.push([a, a + w]);
  }
  segs.sort((p, q) => p[0] - q[0]);
  let total = 0, cs = -1, ce = -1;
  const eps = 1e-4;
  for (const [s, e] of segs) {
    if (s > ce + eps) { if (ce > cs) total += ce - cs; cs = s; ce = e; }
    else if (e > ce) ce = e;
  }
  if (ce > cs) total += ce - cs;
  return Math.min(360, total / D2R);
}

interface Model { axis: Vec3; U: Vec3; V: Vec3; cx: number; cy: number; r: number }

export function findCylinders(mesh: IndexedMesh, opt: FindOptions = defaultFindOptions): Cylinder[] {
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
  // Neighbour across each edge (-1 where the edge is not shared by exactly two triangles).
  const edgeTris = new Map<number, number[]>();
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(tri[t * 3 + k], tri[t * 3 + ((k + 1) % 3)]);
      const l = edgeTris.get(key);
      if (l) l.push(t); else edgeTris.set(key, [t]);
    }
  const nbr = new Int32Array(nt * 3).fill(-1);
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const l = edgeTris.get(edgeKey(tri[t * 3 + k], tri[t * 3 + ((k + 1) % 3)]))!;
      if (l.length === 2) nbr[t * 3 + k] = l[0] === t ? l[1] : l[0];
    }

  const nrm = (t: number) => normal.subarray(t * 3, t * 3 + 3);
  const cosFlat = Math.cos(opt.flatDeg * D2R);
  const cosStep = Math.cos(opt.maxStepDeg * D2R);
  const sinStrict = Math.sin(opt.strictTolDeg * D2R);
  const cosStrict = Math.cos(opt.strictTolDeg * D2R);
  const sinLoose = Math.sin(opt.looseTolDeg * D2R);
  const P = (i: number): Vec3 => [vert[i * 3], vert[i * 3 + 1], vert[i * 3 + 2]];
  const edgeDir = (a: number, b: number): Vec3 => {
    const d: Vec3 = [vert[b * 3] - vert[a * 3], vert[b * 3 + 1] - vert[a * 3 + 1], vert[b * 3 + 2] - vert[a * 3 + 2]];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  };

  const owner = new Int32Array(nt).fill(-1); // -1 free, otherwise index of the cylinder that took it
  const tried = new Uint8Array(nt); // part of a run that was rejected: not used as a seed again
  const stamp = new Int32Array(nt).fill(-1); // scratch: visited marks per growth pass
  let pass = 0;

  const growStrict = (t1: number, t2: number, axis: Vec3): number[] => {
    const id = ++pass;
    const members = [t1, t2];
    stamp[t1] = stamp[t2] = id;
    for (let qi = 0; qi < members.length; qi++) {
      const t = members[qi];
      for (let k = 0; k < 3; k++) {
        const u = nbr[t * 3 + k];
        if (u < 0 || owner[u] >= 0 || stamp[u] === id) continue;
        if (Math.abs(dot(nrm(u), axis)) > sinStrict) continue;
        const cu = dot(nrm(t), nrm(u));
        if (cu < cosStep) continue;
        const p = tri[t * 3 + k], q = tri[t * 3 + ((k + 1) % 3)];
        if (cu <= cosFlat && Math.abs(dot(edgeDir(p, q), axis)) < cosStrict) continue;
        stamp[u] = id;
        members.push(u);
      }
    }
    return members;
  };

  const refineAxis = (members: number[], axis: Vec3): Vec3 => {
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const t of members) {
      const n = nrm(t), w = area[t];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += w * n[i] * n[j];
    }
    const { vec, vals } = smallestEigen(m);
    // Normals must spread around the axis for the direction to be well defined.
    if (vals[1] < vals[2] * 1e-3) return axis;
    const c = canonical(vec);
    return Math.abs(dot(c, axis)) > Math.cos(10 * D2R) ? c : axis;
  };

  const fitModel = (members: number[], axis: Vec3): Model | null => {
    const [U, V] = frame(axis);
    const seen = new Set<number>();
    const pts: number[] = [];
    for (const t of members) for (let k = 0; k < 3; k++) {
      const i = tri[t * 3 + k];
      if (seen.has(i)) continue;
      seen.add(i);
      const p = P(i);
      pts.push(dot(p, U), dot(p, V));
    }
    const c = fitCircle(pts);
    if (!c || !Number.isFinite(c.r)) return null;
    return { axis, U, V, ...c };
  };

  const onSurface = (m: Model, i: number) => {
    const p = P(i);
    const d = Math.hypot(dot(p, m.U) - m.cx, dot(p, m.V) - m.cy) - m.r;
    return Math.abs(d) <= Math.max(m.r * opt.onSurfaceFraction, opt.onSurfaceMm);
  };

  const growLoose = (start: number[], m: Model): number[] => {
    const id = ++pass;
    const ok = (t: number) => Math.abs(dot(nrm(t), m.axis)) <= sinLoose
      && onSurface(m, tri[t * 3]) && onSurface(m, tri[t * 3 + 1]) && onSurface(m, tri[t * 3 + 2]);
    const members: number[] = [];
    for (const t of start) if (stamp[t] !== id && ok(t)) { stamp[t] = id; members.push(t); }
    for (let qi = 0; qi < members.length; qi++) {
      const t = members[qi];
      for (let k = 0; k < 3; k++) {
        const u = nbr[t * 3 + k];
        if (u < 0 || owner[u] >= 0 || stamp[u] === id) continue;
        if (dot(nrm(t), nrm(u)) < cosStep || !ok(u)) continue;
        stamp[u] = id;
        members.push(u);
      }
    }
    return members;
  };

  const found: Cylinder[] = [];
  for (const [key, ts] of edgeTris) {
    if (ts.length !== 2) continue;
    const [t1, t2] = ts;
    if (owner[t1] >= 0 || owner[t2] >= 0 || (tried[t1] && tried[t2])) continue;
    const c = dot(nrm(t1), nrm(t2));
    if (c > cosFlat || c < cosStep) continue;
    const a = Math.floor(key / 4294967296), b = key % 4294967296;
    const axis0 = canonical(edgeDir(a, b));
    const strict = growStrict(t1, t2, axis0);
    for (const part of splitWide(strict, axis0, mesh, normal, cosFlat, nbr)) {
      let members = part;
      let axis = axis0;
      let model: Model | null = null;
      const trace: string[] = [`strict ${strict.length} part ${part.length}`];
      for (let iter = 0; iter < 4; iter++) {
        axis = refineAxis(members, axis);
        model = fitModel(members, axis);
        if (!model || model.r < opt.minRadius) { trace.push('no fit'); model = null; break; }
        const next = growLoose(members, model);
        trace.push(`r ${model.r.toFixed(3)} -> ${next.length}`);
        if (next.length < 2) { model = null; break; }
        const same = next.length === members.length;
        members = next;
        if (same && iter > 0) break;
      }
      const cyl = model ? evaluate(members, model) : null;
      if (opt.debug && model && model.r < 50) opt.debug(`${trace.join(' | ')} => ${cyl ? `${cyl.kind} d${(cyl.radius * 2).toFixed(2)} cov ${Math.round(cyl.coverage)}` : 'rejected'}`);
      const id = found.length;
      if (cyl) {
        for (const t of members) owner[t] = id;
        found.push(cyl);
      } else {
        // Don't seed from this run again. Its triangles stay free, so a better run can still take them.
        for (const t of members) tried[t] = 1;
        for (const t of part) tried[t] = 1;
      }
    }
    // Strict growth can spread over large flat walls; don't repeat it from another seed there.
    for (const t of strict) if (owner[t] < 0) tried[t] = 1;
    tried[t1] = tried[t2] = 1;
  }
  return mergeCoaxial(found.filter((c) => c.radius >= opt.minRadius));

  function evaluate(members: number[], m: Model): Cylinder | null {
    // Final fit on the final members.
    const fm = fitModel(members, m.axis);
    if (!fm) return null;
    const seen = new Map<number, number>(); // vertex -> angle
    let se = 0, zlo = Infinity, zhi = -Infinity;
    for (const t of members) for (let k = 0; k < 3; k++) {
      const i = tri[t * 3 + k];
      if (seen.has(i)) continue;
      const p = P(i);
      const x = dot(p, fm.U) - fm.cx, y = dot(p, fm.V) - fm.cy, z = dot(p, fm.axis);
      const e = Math.hypot(x, y) - fm.r;
      se += e * e;
      if (z < zlo) zlo = z;
      if (z > zhi) zhi = z;
      seen.set(i, Math.atan2(y, x));
    }
    if (seen.size < 4) return null;
    const fitError = Math.sqrt(se / seen.size) / fm.r;
    if (fitError > opt.maxFitError) return null;

    // Normals must point along the radius: all towards the axis (hole) or all away (boss).
    let inward = 0, outward = 0;
    const intervals: Array<[number, number]> = [];
    for (const t of members) {
      const n = nrm(t);
      const n2x = dot(n, fm.U), n2y = dot(n, fm.V);
      let gx = 0, gy = 0;
      const angs: number[] = [];
      for (let k = 0; k < 3; k++) {
        const i = tri[t * 3 + k];
        const p = P(i);
        gx += dot(p, fm.U) - fm.cx; gy += dot(p, fm.V) - fm.cy;
        angs.push(seen.get(i)!);
      }
      const gl = Math.hypot(gx, gy) || 1;
      const cr = (n2x * gx + n2y * gy) / gl / (Math.hypot(n2x, n2y) || 1);
      if (cr < -0.9) inward++;
      else if (cr > 0.9) outward++;
      // Span of the triangle's corners around the axis.
      angs.sort((p, q) => p - q);
      let best: [number, number] = [angs[0], angs[2]];
      let bestW = angs[2] - angs[0];
      for (let s = 1; s < 3; s++) {
        const w = angs[s - 1] + 2 * Math.PI - angs[s];
        if (w < bestW) { bestW = w; best = [angs[s], angs[s - 1] + 2 * Math.PI]; }
      }
      intervals.push(best);
    }
    const total = members.length;
    if (Math.max(inward, outward) < total * 0.95) return null;

    // Sides of the full circle: from the typical gap between distinct corner angles.
    const sortedAngles = [...seen.values()].map((x) => x / D2R).sort((p, q) => p - q);
    const gaps: number[] = [];
    for (let i = 1; i < sortedAngles.length; i++) {
      const g = sortedAngles[i] - sortedAngles[i - 1];
      if (g > 0.01) gaps.push(g); // corners at the same angle (both ends of a strip) are one side
    }
    gaps.sort((p, q) => p - q);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    if (gaps.length < 2) return null;

    const mid = (zlo + zhi) / 2;
    const { U, V, axis } = fm;
    const center: Vec3 = [
      fm.cx * U[0] + fm.cy * V[0] + mid * axis[0],
      fm.cx * U[1] + fm.cy * V[1] + mid * axis[1],
      fm.cx * U[2] + fm.cy * V[2] + mid * axis[2],
    ];
    const az = Math.abs(axis[2]);
    const tol = Math.sin(opt.orientationTolDeg * D2R);
    return {
      kind: inward > outward ? 'hole' : 'boss',
      axis,
      center,
      radius: fm.r,
      length: zhi - zlo,
      coverage: coverageDeg(intervals),
      segments: gap > 0 ? Math.round(360 / gap) : 0,
      fitError,
      orientation: az < tol ? 'horizontal' : az > Math.cos(opt.orientationTolDeg * D2R) ? 'vertical' : 'angled',
      triangles: members,
    };
  }
}

/** Group a run's triangles into flat faces and return its connected parts once wide faces are removed. */
function splitWide(tris: number[], axis: Vec3, mesh: IndexedMesh, normal: Float64Array, cosFlat: number, nbr: Int32Array): number[][] {
  const { vert, tri } = mesh;
  const faces = flatFaces(tris, normal, cosFlat, nbr);
  if (faces.length < 2) return [];
  const widths = faces.map((f) => {
    const n = normal.subarray(f[0] * 3, f[0] * 3 + 3);
    // Direction across the strip: perpendicular to both the axis and the face normal.
    const s: Vec3 = [axis[1] * n[2] - axis[2] * n[1], axis[2] * n[0] - axis[0] * n[2], axis[0] * n[1] - axis[1] * n[0]];
    let lo = Infinity, hi = -Infinity;
    for (const t of f) for (let k = 0; k < 3; k++) {
      const i = tri[t * 3 + k] * 3;
      const d = vert[i] * s[0] + vert[i + 1] * s[1] + vert[i + 2] * s[2];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return hi - lo;
  });
  const sorted = [...widths].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const keep = new Set<number>();
  faces.forEach((f, i) => { if (faces.length < 3 || widths[i] <= median * 2.5 + 1e-9) for (const t of f) keep.add(t); });
  if (keep.size === tris.length) return [tris];
  const parts: number[][] = [];
  const seen = new Set<number>();
  for (const s of keep) {
    if (seen.has(s)) continue;
    const comp = [s];
    seen.add(s);
    for (let i = 0; i < comp.length; i++) {
      const t = comp[i];
      for (let k = 0; k < 3; k++) {
        const u = nbr[t * 3 + k];
        if (u >= 0 && keep.has(u) && !seen.has(u)) { seen.add(u); comp.push(u); }
      }
    }
    if (comp.length >= 2) parts.push(comp);
  }
  return parts;
}

function flatFaces(tris: number[], normal: Float64Array, cosFlat: number, nbr: Int32Array): number[][] {
  const inSet = new Set(tris);
  const seen = new Set<number>();
  const faces: number[][] = [];
  for (const s of tris) {
    if (seen.has(s)) continue;
    seen.add(s);
    const face = [s];
    for (let i = 0; i < face.length; i++) {
      const t = face[i];
      for (let k = 0; k < 3; k++) {
        const u = nbr[t * 3 + k];
        if (u < 0 || !inSet.has(u) || seen.has(u)) continue;
        if (dot(normal.subarray(t * 3, t * 3 + 3), normal.subarray(u * 3, u * 3 + 3)) > cosFlat) { seen.add(u); face.push(u); }
      }
    }
    faces.push(face);
  }
  return faces;
}

/** Join pieces of the same cylinder that were split by a seam or a crossing feature. */
function mergeCoaxial(cyls: Cylinder[]): Cylinder[] {
  const out: Cylinder[] = [];
  const used = new Array(cyls.length).fill(false);
  for (let i = 0; i < cyls.length; i++) {
    if (used[i]) continue;
    let a = cyls[i];
    used[i] = true;
    let merged = true;
    while (merged) {
      merged = false;
      for (let j = 0; j < cyls.length; j++) {
        if (used[j]) continue;
        const b = cyls[j];
        if (a.kind !== b.kind) continue;
        if (Math.abs(dot(a.axis, b.axis)) < Math.cos(1 * D2R)) continue;
        if (Math.abs(a.radius - b.radius) > Math.max(0.02 * a.radius, 0.02)) continue;
        const d: Vec3 = [b.center[0] - a.center[0], b.center[1] - a.center[1], b.center[2] - a.center[2]];
        const along = dot(d, a.axis);
        const off = Math.hypot(d[0] - along * a.axis[0], d[1] - along * a.axis[1], d[2] - along * a.axis[2]);
        if (off > Math.max(0.02 * a.radius, 0.02)) continue;
        // Only when their lengths overlap or touch: coaxial holes through two separate walls stay separate.
        if (Math.abs(along) > (a.length + b.length) / 2 + 0.05) continue;
        const lo = Math.min(-a.length / 2, along - b.length / 2), hi = Math.max(a.length / 2, along + b.length / 2);
        const shift = (lo + hi) / 2;
        a = {
          ...a,
          center: [a.center[0] + shift * a.axis[0], a.center[1] + shift * a.axis[1], a.center[2] + shift * a.axis[2]],
          length: hi - lo,
          coverage: Math.min(360, a.coverage + b.coverage),
          segments: Math.max(a.segments, b.segments),
          fitError: Math.max(a.fitError, b.fitError),
          triangles: [...a.triangles, ...b.triangles],
        };
        used[j] = true;
        merged = true;
      }
    }
    out.push(a);
  }
  return out;
}
