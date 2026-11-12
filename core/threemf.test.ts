import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSTL, loadManifold, meshOf } from './geometry.ts';
import { read3MF, write3MF } from './threemf.ts';
import { writeSTL } from './stl.ts';

const w = await loadManifold();

test('3MF round trip keeps the mesh, the original and the edits', async () => {
  const before = meshOf(w.Manifold.cube([20, 10, 10]).subtract(w.Manifold.cylinder(20, 2, 2, 32, true).rotate([90, 0, 0]).translate([10, 5, 5])));
  const after = meshOf(w.Manifold.cube([20, 10, 10]));
  const edits = [{ feature: 'tented-holes', params: { angle: 45 } }];
  const bytes = write3MF(after, 'part', { original: before, data: { formatVersion: 1, app: 'test', edits } });
  const back = read3MF(bytes);
  assert.equal(back.meshes.length, 1);
  assert.equal(back.meshes[0].tri.length, after.tri.length);
  assert.deepEqual(back.printalizer!.data.edits, edits);
  assert.equal(back.printalizer!.original.tri.length, before.tri.length);
  // The printable mesh read back is still a closed solid.
  const r = await importSTL(writeSTL(back.meshes[0].vert, back.meshes[0].tri));
  assert.equal(r.report.outcome, 'clean');
});

test('a plain 3MF has no Printalizer parts', () => {
  const m = meshOf(w.Manifold.cube(5));
  const back = read3MF(write3MF(m, 'cube'));
  assert.equal(back.printalizer, undefined);
  assert.ok(!back.parts.some((p) => p.startsWith('Printalizer/')));
});
