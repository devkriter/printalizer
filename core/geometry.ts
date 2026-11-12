// Loading Manifold and turning an imported STL into a Manifold solid.

import Module from 'manifold-3d';
import type { Manifold as ManifoldT, ManifoldToplevel } from 'manifold-3d';
import { parseSTL } from './stl.ts';
import type { TriangleSoup } from './stl.ts';
import { boundsOf, clean, diagonal, makeManifold, signedVolume, weld } from './mesh.ts';
import type { CleanStats, IndexedMesh, TopologyStats } from './mesh.ts';

let wasmPromise: Promise<ManifoldToplevel> | null = null;
export function loadManifold(): Promise<ManifoldToplevel> {
  if (!wasmPromise) wasmPromise = Module().then((w) => { w.setup(); return w; });
  return wasmPromise;
}

export type ImportOutcome =
  | 'clean' // closed and manifold straight after welding
  | 'repaired' // needed winding fixes, shell separation or hole filling
  | 'partial' // a solid was made, but some pieces with volume could not be closed and are missing
  | 'refused'; // could not be made into a solid

export interface ImportReport {
  outcome: ImportOutcome;
  reason?: string;
  format: TriangleSoup['format'];
  warnings: string[];
  trianglesIn: number;
  verticesWelded: number;
  size: [number, number, number];
  clean: CleanStats;
  topology?: TopologyStats;
  shellsUnited: number;
  /** Shells overlapped each other and were united. */
  overlapping?: boolean;
  /** Shells that were inside out and turned the right way. */
  insideOut?: number;
  /** Triangles in open pieces that were left out (outcome 'partial'). */
  lostTriangles?: number;
  voids: number;
  /** Volume enclosed by the file's triangles as they are (overlaps count twice). */
  volumeIn: number;
  volume: number;
  genus: number;
  trianglesOut: number;
  ms: { parse: number; weld: number; repair: number; manifold: number };
}

export interface ImportResult {
  report: ImportReport;
  solid: ManifoldT | null;
  /** The welded mesh before repair, for showing the original. */
  welded: IndexedMesh;
}

const now = () => performance.now();

function toManifold(w: ManifoldToplevel, vert: Float64Array, tri: Uint32Array, merge: boolean): ManifoldT | string {
  const mesh = new w.Mesh({ numProp: 3, vertProperties: new Float32Array(vert), triVerts: tri });
  if (merge) mesh.merge();
  try {
    const m = new w.Manifold(mesh);
    const st = m.status();
    if (st !== 'NoError') { m.delete(); return st; }
    return m;
  } catch (e) {
    return (e as Error).message || 'NotManifold';
  }
}

export async function importSTL(bytes: Uint8Array): Promise<ImportResult> {
  const t0 = now();
  const soup = parseSTL(bytes);
  return importSoup(soup, now() - t0);
}

/** Turn a triangle soup from any file format into a Manifold solid, repairing it where that is safe. */
export async function importSoup(soup: TriangleSoup, parseMs = 0): Promise<ImportResult> {
  const w = await loadManifold();
  const t1 = now();
  const t0 = t1 - parseMs;
  const b = boundsOf(soup.positions);
  const diag = diagonal(b);
  const tol = Math.max(diag * 1e-7, 1e-6);
  const welded = weld(soup.positions, tol);
  const { mesh, stats: cleanStats } = clean(welded, diag * diag * 1e-14);
  const t2 = now();

  const report: ImportReport = {
    outcome: 'refused',
    format: soup.format,
    warnings: soup.warnings,
    trianglesIn: soup.triCount,
    verticesWelded: welded.vert.length / 3,
    size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
    clean: cleanStats,
    shellsUnited: 0,
    voids: 0,
    volumeIn: 0,
    volume: 0,
    genus: 0,
    trianglesOut: 0,
    ms: { parse: t1 - t0, weld: t2 - t1, repair: 0, manifold: 0 },
  };
  const finish = (solid: ManifoldT | null, outcome: ImportOutcome, reason?: string): ImportResult => {
    report.outcome = outcome;
    if (reason) report.reason = reason;
    report.volumeIn = Math.abs(signedVolume(mesh.vert, mesh.tri));
    if (solid) {
      report.volume = solid.volume();
      report.genus = solid.genus();
      report.trianglesOut = solid.numTri();
    }
    return { report, solid, welded };
  };

  if (!soup.triCount) return finish(null, 'refused', 'The file has no triangles.');

  // Repair topology, then build each shell on its own and combine them.
  const t4 = now();
  const fixed = makeManifold(mesh, {
    fillHoles: true,
    maxHoleEdges: 2000,
    maxHoleAreaFraction: 0.25,
    triangulate: (polys, eps) => w.triangulate(polys, eps) as Array<[number, number, number]>,
  });
  report.topology = fixed.stats;
  const t5 = now();
  report.ms.repair = t5 - t4;

  const solids: ManifoldT[] = [];
  const voids: ManifoldT[] = [];
  const failures = new Map<string, number>();
  let lostTris = 0;
  const fail = (why: string, tris = 0) => { failures.set(why, (failures.get(why) ?? 0) + 1); if (why === 'open shell') lostTris += tris; };
  const flatLimit = diag * diag * diag * 1e-9;
  for (const shellTri of fixed.shells) {
    const { vert, tri } = compact(fixed.vert, shellTri);
    if (tri.length < 12) { fail('tiny open fragment'); continue; }
    const vol = signedVolume(vert, tri);
    if (Math.abs(vol) < flatLimit) { fail('flat shell with no volume'); continue; }
    const inverted = vol < 0;
    if (inverted) for (let i = 0; i < tri.length; i += 3) { const x = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = x; }
    const m = toManifold(w, vert, tri, true);
    if (typeof m === 'string') { fail(/manifold/i.test(m) ? 'open shell' : m, tri.length / 3); continue; }
    if (inverted) voids.push(m); else solids.push(m);
  }
  // An inside-out shell is a cavity when it sits inside a solid shell. Otherwise it was simply inside out.
  const solidSum = solids.reduce((s, m) => s + m.volume(), 0);
  let body: ManifoldT | null = solids.length ? w.Manifold.union(solids) : null;
  const overlapping = body ? body.volume() < solidSum * (1 - 1e-6) : false;
  const realVoids: ManifoldT[] = [];
  let insideOut = 0;
  for (const v of voids) {
    const vv = v.volume();
    const inside = body ? body.intersect(v).volume() : 0;
    if (body && vv > 0 && Math.abs(inside - vv) < vv * 1e-3) realVoids.push(v);
    else { insideOut++; body = body ? w.Manifold.union(body, v) : v; }
  }
  if (body && realVoids.length) body = w.Manifold.difference([body, ...realVoids]);
  report.voids = realVoids.length;
  report.shellsUnited = solids.length + insideOut;
  report.ms.manifold = now() - t5;

  if (!body || body.isEmpty()) {
    const why = [...failures.entries()].map(([k, n]) => `${n}× ${k}`).join(', ');
    return finish(null, 'refused', why || 'Nothing closed was left after repair.');
  }
  const st = body.status();
  if (st !== 'NoError') return finish(null, 'refused', st);
  if (failures.size) {
    const dropped = [...failures.entries()].map(([k, n]) => `${n}× ${k}`).join(', ');
    report.warnings.push(`Dropped shells that could not be closed: ${dropped}.`);
  }
  // Clean means nothing had to change: no cleaning, no winding or topology fixes, no overlaps.
  const t = fixed.stats;
  // Triangles that collapse when vertices merge are dropped silently: that changes nothing.
  const changed = cleanStats.duplicates + cleanStats.doubleWalls + t.flipped
    + t.nonManifoldPaired + t.holesFilled + insideOut + failures.size > 0 || overlapping;
  report.overlapping = overlapping;
  report.insideOut = insideOut;
  if (lostTris) {
    report.lostTriangles = lostTris;
    return finish(body, 'partial', `${failures.get('open shell')}× open piece left out (${lostTris} of ${soup.triCount} triangles)`);
  }
  return finish(body, changed ? 'repaired' : 'clean');
}

function compact(vert: Float64Array, tri: Uint32Array) {
  const map = new Map<number, number>();
  const out: number[] = [];
  const t = new Uint32Array(tri.length);
  for (let i = 0; i < tri.length; i++) {
    let j = map.get(tri[i]);
    if (j === undefined) {
      j = out.length / 3;
      map.set(tri[i], j);
      out.push(vert[tri[i] * 3], vert[tri[i] * 3 + 1], vert[tri[i] * 3 + 2]);
    }
    t[i] = j;
  }
  return { vert: new Float64Array(out), tri: t };
}

/** Plain arrays from a Manifold, for hole finding and export. */
export function meshOf(solid: ManifoldT): IndexedMesh {
  const m = solid.getMesh();
  const n = m.vertProperties.length / m.numProp;
  const vert = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) vert[i * 3 + k] = m.vertProperties[i * m.numProp + k];
  return { vert, tri: new Uint32Array(m.triVerts) };
}
