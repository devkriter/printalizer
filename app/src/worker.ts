// The geometry worker: opens files, repairs them, orients the part and writes exports.
// The page only draws and handles input, so nothing here blocks the interface.
import type { Manifold } from 'manifold-3d';
import { importSoup, loadManifold, meshOf } from '../../core/geometry.ts';
import { parseSTL, writeSTL } from '../../core/stl.ts';
import { read3MF, soupOf, write3MF } from '../../core/threemf.ts';
import type { Object3MF } from '../../core/threemf.ts';
import { autoDownNormal, mat4, placeOnBed, rotationToDown, turnZ } from '../../core/orient.ts';
import type { Bed, PartMesh, Request, Response, WorkerMessage } from './protocol.ts';

let part: Manifold | null = null;
let pending3MF: Object3MF[] = [];

const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function setPart(m: Manifold) {
  if (part && part !== m) part.delete();
  part = m;
}

function partMesh(): { mesh: PartMesh; transfer: Transferable[] } {
  const { vert, tri } = meshOf(part!);
  const b = part!.boundingBox();
  const v = new Float32Array(vert);
  return {
    mesh: { vert: v, tri, min: b.min as PartMesh['min'], max: b.max as PartMesh['max'], volume: part!.volume() },
    transfer: [v.buffer, tri.buffer],
  };
}

const place = (m: Manifold, bed: Bed) => placeOnBed(m, bed.w / 2, bed.d / 2);

async function importAndPlace(soup: Parameters<typeof importSoup>[0], bed: Bed, id: number) {
  post({ id, progress: 'Repairing' });
  const { report, solid } = await importSoup(soup);
  if (!solid) return { result: { kind: 'refused', report } as Response, transfer: [] };
  setPart(place(solid, bed));
  solid.delete();
  const { mesh, transfer } = partMesh();
  return { result: { kind: 'part', report, mesh } as Response, transfer };
}

function soupFromObjects(objs: Object3MF[]) {
  const parts = objs.map((o) => soupOf(o.mesh));
  const pos = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { pos.set(p, o); o += p.length; }
  return { positions: pos, triCount: pos.length / 9, format: '3mf' as const, warnings: [] };
}

async function handle(id: number, req: Request): Promise<{ result: Response; transfer: Transferable[] }> {
  await loadManifold();
  switch (req.type) {
    case 'open': {
      post({ id, progress: 'Reading' });
      const bytes = new Uint8Array(req.bytes);
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (isZip) {
        const r = read3MF(bytes);
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
      return importAndPlace(soupFromObjects(objs), req.bed, id);
    }
    case 'layFlat':
    case 'auto':
    case 'turn':
    case 'place': {
      if (!part) throw new Error('No part is open.');
      let m = part;
      if (req.type === 'layFlat') m = m.transform(mat4(rotationToDown(req.normal)));
      if (req.type === 'auto') m = m.transform(mat4(rotationToDown(autoDownNormal(part))));
      if (req.type === 'turn') m = m.transform(mat4(turnZ(req.quarterTurns)));
      setPart(place(m, req.bed));
      if (m !== part) m.delete();
      const { mesh, transfer } = partMesh();
      return { result: { kind: 'moved', mesh }, transfer };
    }
    case 'export': {
      if (!part) throw new Error('No part is open.');
      const mesh = meshOf(part);
      if (req.format === 'stl') {
        const bytes = writeSTL(mesh.vert, mesh.tri, 'Printalizer');
        return { result: { kind: 'file', bytes, name: `${req.name}.stl`, mime: 'model/stl' }, transfer: [bytes.buffer] };
      }
      // No edits exist yet (Phase 1): the original is the part as placed.
      const bytes = write3MF(mesh, req.name, { original: mesh, data: { formatVersion: 1, app: 'Printalizer 0.1', edits: [] } });
      return { result: { kind: 'file', bytes, name: `${req.name}.3mf`, mime: 'model/3mf' }, transfer: [bytes.buffer] };
    }
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = e.data;
  try {
    const { result, transfer } = await handle(id, req);
    post({ id, ok: true, result }, transfer);
  } catch (err) {
    post({ id, ok: false, error: (err as Error).message || String(err) });
  }
};
