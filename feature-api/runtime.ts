// Runs features against a part: builds the context they see, turns their plain-data solids into
// Manifold solids, and combines all edits into the result. Used by the geometry worker and tests.

import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { loadManifold, meshOf } from '../core/geometry.ts';
import { findCylinders } from '../core/holes.ts';
import type { IndexedMesh } from '../core/mesh.ts';
import { findThreads } from '../core/threads.ts';
import { solids } from './index.ts';
import type { Context, Cylinder, FeatureDef, Op, OverhangRegion, Params, Polygons, Setup, Solid, Target, TargetInput, Thread, Vec3 } from './index.ts';

export interface EditInput {
  id: number;
  feature: string;
  target: Target;
  params: Params;
}

export interface EditResult {
  id: number;
  ok: boolean;
  error?: string;
  warnings: string[];
}

export interface Composed {
  solid: Manifold;
  /** For each result triangle: the edit that made it, or -1 for the original part. */
  owner: Int32Array;
  /** For each result triangle from the original part: its triangle index in the part, else -1. */
  baseFace: Int32Array;
  mesh: IndexedMesh;
  edits: EditResult[];
}

let wasm: ManifoldToplevel | null = null;
export async function ready() { wasm = await loadManifold(); return wasm; }
const W = () => { if (!wasm) throw new Error('Call ready() first.'); return wasm; };

// ---------- plain data to Manifold ----------

export function toManifold(s: Solid): Manifold {
  const w = W();
  switch (s.type) {
    case 'box': {
      const size: Vec3 = [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]];
      if (size.some((x) => !(x > 0))) return emptySolid();
      return w.Manifold.cube(size).translate(s.min);
    }
    case 'cylinder':
      return w.Manifold.cylinder(s.height, s.radius, s.radius, s.segments ?? Math.max(24, Math.min(256, Math.ceil(s.radius * 16))), s.center ?? false);
    case 'extrude': {
      if (!nonEmpty(s.polygons) || !(s.height > 0)) return emptySolid();
      const cs = new w.CrossSection(s.polygons as never, 'Positive');
      const m = cs.extrude(s.height, s.divisions ?? 0, s.twist ?? 0);
      cs.delete();
      return m;
    }
    case 'transform':
      return toManifold(s.solid).transform(s.matrix as never);
    case 'union':
      return w.Manifold.union(s.solids.map(toManifold));
    case 'difference': {
      const [first, ...rest] = s.solids.map(toManifold);
      return rest.length ? w.Manifold.difference([first, ...rest]) : first;
    }
    case 'intersection':
      return w.Manifold.intersection(s.solids.map(toManifold));
    case 'mesh':
      return new w.Manifold(new w.Mesh({ numProp: 3, vertProperties: new Float32Array(s.vert), triVerts: new Uint32Array(s.tri) }));
  }
}

const cs = (p: Polygons): CrossSection => new (W().CrossSection)(p as never, 'Positive');
const nonEmpty = (p: Polygons | undefined) => !!p && p.some((c) => c.length >= 3);
const emptySolid = () => { const w = W(); return new w.Manifold(new w.Mesh({ numProp: 3, vertProperties: new Float32Array(0), triVerts: new Uint32Array(0) })); };
const polys = (c: CrossSection): Polygons => c.toPolygons() as unknown as Polygons;

// ---------- the part and its context ----------

export class Part {
  readonly base: Manifold;
  readonly mesh: IndexedMesh;
  readonly min: Vec3;
  readonly max: Vec3;
  setup: Setup;
  private cache = new Map<string, unknown>();

  constructor(base: Manifold, setup: Setup) {
    // A fresh original, so result triangles can be traced back to the part's own triangles.
    this.base = base.asOriginal();
    this.mesh = meshOf(this.base);
    const b = this.base.boundingBox();
    this.min = b.min as Vec3;
    this.max = b.max as Vec3;
    this.setup = setup;
  }

  private memo<T>(key: string, f: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, f());
    return this.cache.get(key) as T;
  }

  cylinders(): Cylinder[] { return this.memo('cyl', () => findCylinders(this.mesh)); }

  threads(): Thread[] {
    return this.memo('threads', () => {
      const axes = this.cylinders().filter((c) => c.coverage >= 300).map((c) => c.axis);
      return findThreads(this.mesh, axes);
    });
  }

  bedFaces(): { tris: number[]; area: number } {
    return this.memo('bed', () => {
      const { vert, tri } = this.mesh;
      const tris: number[] = [];
      let area = 0;
      for (let t = 0; t < tri.length / 3; t++) {
        const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
        if (vert[a + 2] > 0.01 || vert[b + 2] > 0.01 || vert[c + 2] > 0.01) continue;
        const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1];
        const nz = ux * vy - uy * vx;
        if (nz >= 0) continue;
        tris.push(t);
        area += -nz / 2;
      }
      return { tris, area };
    });
  }

  overhangs(limitDeg: number): OverhangRegion[] {
    return this.memo(`over:${limitDeg}`, () => overhangRegions(this.mesh, limitDeg, (p) => this.shapes.union(...p)));
  }

  section(z: number): Polygons {
    const c = this.base.slice(z);
    const p = polys(c);
    c.delete();
    return p;
  }

  // Empty polygon lists are allowed everywhere and mean "nothing".
  readonly shapes: Context['shapes'] = {
    offset: (p, delta, join = 'Round') => {
      if (!nonEmpty(p)) return [];
      const a = cs(p);
      const b = a.offset(delta, join, 2, 24);
      // Rounded corners add points every time; simplify so repeated offsets don't grow without end.
      const c = b.simplify(0.005);
      const out = polys(c);
      a.delete(); b.delete(); c.delete();
      return out;
    },
    union: (...ps) => {
      const list = ps.filter(nonEmpty);
      if (!list.length) return [];
      if (list.length === 1) return list[0];
      const c = W().CrossSection.union(list.map((p) => cs(p)));
      const out = polys(c);
      c.delete();
      return out;
    },
    difference: (a, ...b) => {
      if (!nonEmpty(a)) return [];
      const rest = b.filter(nonEmpty);
      if (!rest.length) return a;
      const c = W().CrossSection.difference([cs(a), ...rest.map((p) => cs(p))]);
      const out = polys(c);
      c.delete();
      return out;
    },
    intersection: (a, b) => {
      if (!nonEmpty(a) || !nonEmpty(b)) return [];
      const c = W().CrossSection.intersection([cs(a), cs(b)]);
      const out = polys(c);
      c.delete();
      return out;
    },
    area: (p) => { if (!nonEmpty(p)) return 0; const c = cs(p); const a = c.area(); c.delete(); return a; },
    hull: (p) => { if (!nonEmpty(p)) return []; const c = cs(p).hull(); const out = polys(c); c.delete(); return out; },
  };

  context(warn: (m: string) => void = () => {}): Context {
    return {
      part: { vert: this.mesh.vert, tri: this.mesh.tri, min: this.min, max: this.max },
      setup: this.setup,
      find: {
        cylinders: () => this.cylinders(),
        threads: () => this.threads(),
        overhangs: (limit) => this.overhangs(limit),
        bedFaces: () => this.bedFaces(),
      },
      section: (z) => this.section(z),
      shapes: this.shapes,
      solids,
      warn,
    };
  }
}

/** Connected regions of faces that hang over air, not counting faces on the bed. */
export function overhangRegions(mesh: IndexedMesh, limitDeg: number, union: (p: Polygons[]) => Polygons, minArea = 2): OverhangRegion[] {
  const { vert, tri } = mesh;
  const nt = tri.length / 3;
  const threshold = Math.sin((limitDeg * Math.PI) / 180);
  const over = new Uint8Array(nt);
  const area = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
    const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2];
    const vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!l || -nz / l <= threshold) continue;
    if (vert[a + 2] < 0.01 && vert[b + 2] < 0.01 && vert[c + 2] < 0.01) continue;
    over[t] = 1;
    area[t] = l / 2;
  }
  // Neighbours through shared edges (not corners, so separate overhangs that touch at a point stay apart).
  const byEdge = new Map<number, number[]>();
  const ek = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  for (let t = 0; t < nt; t++) if (over[t]) for (let k = 0; k < 3; k++) {
    const key = ek(tri[t * 3 + k], tri[t * 3 + ((k + 1) % 3)]);
    const l = byEdge.get(key);
    if (l) l.push(t); else byEdge.set(key, [t]);
  }
  const seen = new Uint8Array(nt);
  const out: OverhangRegion[] = [];
  for (let s = 0; s < nt; s++) {
    if (!over[s] || seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    for (let i = 0; i < comp.length; i++) {
      const t = comp[i];
      for (let k = 0; k < 3; k++) for (const u of byEdge.get(ek(tri[t * 3 + k], tri[t * 3 + ((k + 1) % 3)]))!) if (!seen[u]) { seen[u] = 1; comp.push(u); }
    }
    let a = 0, cx = 0, cy = 0, cz = 0, zMin = Infinity, zMax = -Infinity, xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const t of comp) {
      a += area[t];
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k] * 3;
        cx += vert[v] * area[t] / 3; cy += vert[v + 1] * area[t] / 3; cz += vert[v + 2] * area[t] / 3;
        zMin = Math.min(zMin, vert[v + 2]); zMax = Math.max(zMax, vert[v + 2]);
        xMin = Math.min(xMin, vert[v]); xMax = Math.max(xMax, vert[v]);
        yMin = Math.min(yMin, vert[v + 1]); yMax = Math.max(yMax, vert[v + 1]);
      }
    }
    if (a < minArea) continue;
    // The region seen from below: its triangles projected onto the bed, joined.
    const pieces: Polygons[] = [];
    for (const t of comp) {
      const p = [0, 1, 2].map((k) => { const v = tri[t * 3 + k] * 3; return [vert[v], vert[v + 1]] as [number, number]; });
      // Downward faces project clockwise; reverse to counter-clockwise.
      pieces.push([[p[0], p[2], p[1]]]);
    }
    out.push({
      tris: comp, area: a, centroid: [cx / a, cy / a, cz / a], zMin, zMax,
      outline: union(pieces),
      extent: Math.max(xMax - xMin, yMax - yMin),
    });
  }
  return out;
}

// ---------- running features ----------

export function findTargets(def: FeatureDef, part: Part): Target[] {
  const raw: TargetInput[] = def.find(part.context());
  return raw.map((t) => ({ ...t, measure: t.measure ?? {}, data: t.data ?? {} }));
}

export function buildOps(def: FeatureDef, target: Target, params: Params, part: Part): { ops: Op[]; warnings: string[] } {
  const warnings: string[] = [];
  const ops = def.build(target, params, part.context((m) => warnings.push(m)));
  return { ops, warnings };
}

interface Built { add: Manifold | null; sub: Manifold | null; warnings: string[]; ids: number[] }

/**
 * Keeps each edit's solids ready, keyed by everything that affects them, so changing one edit
 * only rebuilds that edit before the final cut.
 */
export class Composer {
  private built = new Map<number, { key: string; built: Built }>();
  private part: Part | null = null;

  setPart(part: Part) {
    this.part = part;
    for (const b of this.built.values()) { b.built.add?.delete(); b.built.sub?.delete(); }
    this.built.clear();
  }

  /** Build one edit's solids. */
  build(e: EditInput, def: FeatureDef | null): Built {
    const part = this.part!;
    const key = JSON.stringify([e.feature, e.target.anchor, e.target.measure, e.target.data, e.params, part.setup]);
    const prev = this.built.get(e.id);
    if (prev && prev.key === key) return prev.built;
    if (prev) { prev.built.add?.delete(); prev.built.sub?.delete(); }
    if (!def) throw new Error(`Feature "${e.feature}" is not loaded.`);
    const { ops, warnings } = buildOps(def, e.target, e.params, part);
    const w = W();
    const adds = ops.filter((o) => o.op === 'add').map((o) => toManifold(o.solid));
    const subs = ops.filter((o) => o.op === 'subtract').map((o) => toManifold(o.solid));
    const add = adds.length ? w.Manifold.union(adds).asOriginal() : null;
    const sub = subs.length ? w.Manifold.union(subs).asOriginal() : null;
    for (const m of [add, sub]) if (m && m.status() !== 'NoError') throw new Error(`The shape it built is invalid (${m.status()}).`);
    const built: Built = { add, sub, warnings, ids: [add?.originalID() ?? -1, sub?.originalID() ?? -1] };
    this.built.set(e.id, { key, built });
    return built;
  }

  forget(keep: Set<number>) {
    for (const [id, b] of this.built) if (!keep.has(id)) { b.built.add?.delete(); b.built.sub?.delete(); this.built.delete(id); }
  }

  compose(edits: EditInput[], defs: Map<string, FeatureDef>): Composed {
    const part = this.part!;
    const w = W();
    const results: EditResult[] = [];
    const adds: Manifold[] = [];
    const subs: Manifold[] = [];
    const ownerOf = new Map<number, number>(); // originalID -> edit id
    for (const e of edits) {
      try {
        const b = this.build(e, defs.get(e.feature) ?? null);
        if (b.add) { adds.push(b.add); ownerOf.set(b.ids[0], e.id); }
        if (b.sub) { subs.push(b.sub); ownerOf.set(b.ids[1], e.id); }
        results.push({ id: e.id, ok: true, warnings: b.warnings });
      } catch (err) {
        results.push({ id: e.id, ok: false, error: (err as Error).message || String(err), warnings: [] });
      }
    }
    this.forget(new Set(edits.map((e) => e.id)));
    let solid = part.base;
    if (adds.length) solid = solid.add(adds.length === 1 ? adds[0] : w.Manifold.union(adds));
    if (subs.length) solid = solid.subtract(subs.length === 1 ? subs[0] : w.Manifold.union(subs));
    const m = solid.getMesh();
    const nt = m.triVerts.length / 3;
    const owner = new Int32Array(nt).fill(-1);
    const baseFace = new Int32Array(nt).fill(-1);
    const baseID = part.base.originalID();
    for (let r = 0; r < m.runOriginalID.length; r++) {
      const id = m.runOriginalID[r];
      const from = m.runIndex[r] / 3, to = m.runIndex[r + 1] / 3;
      if (id === baseID) for (let t = from; t < to; t++) baseFace[t] = m.faceID[t];
      else { const e = ownerOf.get(id) ?? -1; for (let t = from; t < to; t++) owner[t] = e; }
    }
    const n = m.vertProperties.length / m.numProp;
    const vert = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) vert[i * 3 + k] = m.vertProperties[i * m.numProp + k];
    return { solid, owner, baseFace, mesh: { vert, tri: new Uint32Array(m.triVerts) }, edits: results };
  }

  /** The solids of one edit as meshes, for a quick see-through preview before cutting. */
  preview(e: EditInput, def: FeatureDef | null): { add: IndexedMesh | null; sub: IndexedMesh | null; warnings: string[] } {
    const b = this.build(e, def);
    return { add: b.add ? meshOf(b.add) : null, sub: b.sub ? meshOf(b.sub) : null, warnings: b.warnings };
  }
}

export { wasm as _wasm };
