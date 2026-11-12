// The geometry worker: opens files, repairs them, orients the part, runs features and makes the
// result. The page only draws and handles input, so nothing here blocks the interface.
import type { Manifold } from 'manifold-3d';
import { importSoup, meshOf } from '../../core/geometry.ts';
import { parseSTL, writeSTL } from '../../core/stl.ts';
import { read3MF, soupOf, write3MF } from '../../core/threemf.ts';
import type { Object3MF } from '../../core/threemf.ts';
import { autoDownNormal, mat4, rotationToDown, turnZ } from '../../core/orient.ts';
import type { Mat3R } from '../../core/orient.ts';
import { manifestOf } from '../../feature-api/index.ts';
import type { FeatureDef, Setup, Target } from '../../feature-api/index.ts';
import { Composer, Part, findTargets, ready } from '../../feature-api/runtime.ts';
import type { Bed, EditSpec, PartMesh, ProjectData, Request, Response, ResultMesh, WorkerMessage } from './protocol.ts';

// Every folder in features/ with an index.ts is a built-in feature.
const modules = import.meta.glob('../../features/*/index.ts', { eager: true }) as Record<string, { default: FeatureDef }>;
const builtIns = Object.values(modules).map((m) => m.default).sort((a, b) => (a.key ?? '9').localeCompare(b.key ?? '9'));
const defs = new Map(builtIns.map((d) => [d.id, d]));

let base: Manifold | null = null; // the part as placed, before edits
let result: Manifold | null = null; // the part with edits
let part: Part | null = null;
let setup: Setup = { layer: 0.2, nozzle: 0.4, overhang: 45, bedW: 180, bedD: 180 };
let pending3MF: Object3MF[] = [];
let pendingProject: ProjectData | undefined;
const composer = new Composer();

const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function setBase(m: Manifold) {
  if (base && base !== m) base.delete();
  base = m;
  if (result && result !== base) result.delete();
  result = null;
  part = new Part(base, setup);
  composer.setPart(part);
}

function asPartMesh(m: Manifold, mesh = meshOf(m)): { mesh: PartMesh; transfer: Transferable[] } {
  const b = m.boundingBox();
  const v = new Float32Array(mesh.vert);
  const t = new Uint32Array(mesh.tri);
  return { mesh: { vert: v, tri: t, min: b.min as PartMesh['min'], max: b.max as PartMesh['max'], volume: m.volume() }, transfer: [v.buffer, t.buffer] };
}

/** The translation that rests a part on the bed, centred. */
function placement(m: Manifold, bed: Bed): [number, number, number] {
  const b = m.boundingBox();
  return [bed.w / 2 - (b.min[0] + b.max[0]) / 2, bed.d / 2 - (b.min[1] + b.max[1]) / 2, -b.min[2]];
}

function move(R: Mat3R, bed: Bed): { result: Response; transfer: Transferable[] } {
  if (!base) throw new Error('No part is open.');
  const rotated = base.transform(mat4(R));
  const t = placement(rotated, bed);
  const placed = rotated.translate(t);
  rotated.delete();
  setBase(placed);
  const { mesh, transfer } = asPartMesh(part!.base, part!.mesh);
  return { result: { kind: 'moved', mesh, delta: mat4(R, t) as number[] }, transfer };
}

async function importAndPlace(soup: Parameters<typeof importSoup>[0], bed: Bed, id: number, project?: ProjectData) {
  post({ id, progress: 'Repairing' });
  const { report, solid } = await importSoup(soup);
  if (!solid) return { result: { kind: 'refused', report } as Response, transfer: [] };
  // A saved project already sits where it was placed; anything else is centred on the bed.
  setBase(project ? solid : solid.translate(placement(solid, bed)));
  if (!project) solid.delete();
  const { mesh, transfer } = asPartMesh(part!.base, part!.mesh);
  return { result: { kind: 'part', report, mesh, project } as Response, transfer };
}

function soupFromObjects(objs: Object3MF[]) {
  const parts = objs.map((o) => soupOf(o.mesh));
  const pos = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { pos.set(p, o); o += p.length; }
  return { positions: pos, triCount: pos.length / 9, format: '3mf' as const, warnings: [] };
}

function composeNow(edits: EditSpec[]): { result: Response; transfer: Transferable[] } {
  if (!part) throw new Error('No part is open.');
  const c = composer.compose(edits, defs);
  if (result && result !== part.base && result !== c.solid) result.delete();
  result = c.solid;
  const { mesh, transfer } = asPartMesh(c.solid, c.mesh);
  const r: ResultMesh = { ...mesh, owner: c.owner, baseFace: c.baseFace };
  return { result: { kind: 'composed', result: r, edits: c.edits }, transfer: [...transfer, c.owner.buffer, c.baseFace.buffer] };
}

async function handle(id: number, req: Request): Promise<{ result: Response; transfer: Transferable[] }> {
  await ready();
  switch (req.type) {
    case 'manifests':
      return { result: { kind: 'manifests', features: builtIns.map((d) => manifestOf(d)) }, transfer: [] };
    case 'open': {
      post({ id, progress: 'Reading' });
      const bytes = new Uint8Array(req.bytes);
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (isZip) {
        const r = read3MF(bytes);
        // A project saved by Printalizer: reopen its original with the edits.
        if (r.printalizer && (r.printalizer.data as unknown as ProjectData).formatVersion === 1 && Array.isArray(r.printalizer.data.edits)) {
          const project = r.printalizer.data as unknown as ProjectData;
          if (project.setup) setup = { ...setup, ...project.setup };
          return importAndPlace(soupFromObjects([{ name: 'original', mesh: r.printalizer.original }]), req.bed, id, project);
        }
        if (!r.objects.length) throw new Error('This 3MF has no objects to print.');
        if (r.objects.length > 1) {
          pending3MF = r.objects;
          return { result: { kind: 'choose', objects: r.objects.map((o) => ({ name: o.name, triangles: o.mesh.tri.length / 3 })) }, transfer: [] };
        }
        return importAndPlace(soupFromObjects(r.objects), req.bed, id);
      }
      return importAndPlace(parseSTL(bytes), req.bed, id);
    }
    case 'choose': {
      const objs = req.index === 'all' ? pending3MF : [pending3MF[req.index]];
      pending3MF = [];
      return importAndPlace(soupFromObjects(objs), req.bed, id, pendingProject);
    }
    case 'layFlat': return move(rotationToDown(req.normal), req.bed);
    case 'auto': {
      if (!base) throw new Error('No part is open.');
      return move(rotationToDown(autoDownNormal(base)), req.bed);
    }
    case 'turn': return move(turnZ(req.quarterTurns), req.bed);
    case 'place': return move([1, 0, 0, 0, 1, 0, 0, 0, 1], req.bed);
    case 'setup': {
      setup = req.setup;
      if (part) part.setup = setup;
      return { result: { kind: 'ok' }, transfer: [] };
    }
    case 'find': {
      if (!part) throw new Error('No part is open.');
      const targets: Record<string, Target[]> = {};
      const errors: Record<string, string> = {};
      for (const def of builtIns) {
        post({ id, progress: `Finding ${def.plural}` });
        try { targets[def.id] = findTargets(def, part); }
        catch (e) { targets[def.id] = []; errors[def.id] = (e as Error).message || String(e); }
      }
      return { result: { kind: 'found', targets, errors }, transfer: [] };
    }
    case 'compose': return composeNow(req.edits);
    case 'preview': {
      if (!part) throw new Error('No part is open.');
      const warnings: string[] = [];
      const meshes: Array<{ add: ReturnType<typeof meshOf> | null; sub: ReturnType<typeof meshOf> | null }> = [];
      for (const e of req.edits.slice(0, 24)) {
        try {
          const p = composer.preview(e, defs.get(e.feature) ?? null);
          meshes.push(p);
          warnings.push(...p.warnings);
        } catch { /* a failing preview shows nothing */ }
      }
      const join = (list: Array<ReturnType<typeof meshOf>>): PartMesh | null => {
        if (!list.length) return null;
        const nv = list.reduce((n, m) => n + m.vert.length, 0), ntr = list.reduce((n, m) => n + m.tri.length, 0);
        const vert = new Float32Array(nv), tri = new Uint32Array(ntr);
        let ov = 0, ot = 0;
        for (const m of list) { vert.set(m.vert, ov); for (let i = 0; i < m.tri.length; i++) tri[ot + i] = m.tri[i] + ov / 3; ov += m.vert.length; ot += m.tri.length; }
        return { vert, tri, min: [0, 0, 0], max: [0, 0, 0], volume: 0 };
      };
      const add = join(meshes.map((m) => m.add).filter((m): m is NonNullable<typeof m> => !!m));
      const sub = join(meshes.map((m) => m.sub).filter((m): m is NonNullable<typeof m> => !!m));
      const transfer: Transferable[] = [];
      for (const m of [add, sub]) if (m) transfer.push(m.vert.buffer, m.tri.buffer);
      return { result: { kind: 'preview', add, sub, warnings }, transfer };
    }
    case 'export': {
      if (!part) throw new Error('No part is open.');
      const final = result ?? part.base;
      const mesh = meshOf(final);
      if (req.format === 'stl') {
        const bytes = writeSTL(mesh.vert, mesh.tri, 'Printalizer');
        return { result: { kind: 'file', bytes, name: `${req.name}.stl`, mime: 'model/stl' }, transfer: [bytes.buffer] };
      }
      const bytes = write3MF(mesh, req.name, { original: part.mesh, data: req.project as never });
      return { result: { kind: 'file', bytes, name: `${req.name}.3mf`, mime: 'model/3mf' }, transfer: [bytes.buffer] };
    }
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = e.data;
  try {
    const { result: r, transfer } = await handle(id, req);
    post({ id, ok: true, result: r }, transfer);
  } catch (err) {
    post({ id, ok: false, error: (err as Error).message || String(err) });
  }
};
