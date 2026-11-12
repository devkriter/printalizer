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

test('components in other model parts and transforms are resolved', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const cubeXml = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
<object id="1" type="model"><mesh><vertices>
<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/>
</vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh></object>
</resources><build/></model>`;
  const rootXml = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>
<object id="2" type="model" name="tetra"><components><component p:path="/3D/Objects/a.model" objectid="1" transform="2 0 0 0 2 0 0 0 2 0 0 0"/></components></object>
</resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 20 30"/><item objectid="2" transform="0 1 0 -1 0 0 0 0 1 0 0 0"/></build></model>`;
  const bytes = zipSync({
    '_rels/.rels': strToU8('<Relationships><Relationship Target="/3D/3dmodel.model" Id="r" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(rootXml),
    '3D/Objects/a.model': strToU8(cubeXml),
  });
  const r = read3MF(bytes);
  assert.equal(r.objects.length, 2);
  assert.equal(r.objects[0].name, 'tetra');
  // First item: scaled by 2 then moved by (10, 20, 30). Vertex 1 (1,0,0) -> (12, 20, 30).
  assert.deepEqual(Array.from(r.objects[0].mesh.vert.subarray(3, 6)), [12, 20, 30]);
  // Second item: quarter turn about Z. (2,0,0) -> (0,2,0) with row vectors.
  assert.deepEqual(Array.from(r.objects[1].mesh.vert.subarray(3, 6)).map((x) => Math.round(x * 1e9) / 1e9), [0, 2, 0]);
});

test('a plain 3MF has no Printalizer parts', () => {
  const m = meshOf(w.Manifold.cube(5));
  const back = read3MF(write3MF(m, 'cube'));
  assert.equal(back.printalizer, undefined);
  assert.ok(!back.parts.some((p) => p.startsWith('Printalizer/')));
});
