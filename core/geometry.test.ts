import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSTL, loadManifold } from './geometry.ts';
import { parseSTL, writeSTL } from './stl.ts';
import { editTris, stlOf, stlOfShells } from './testkit.ts';

const w = await loadManifold();
const { Manifold } = w;
const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('binary STL round trip', () => {
  const bytes = writeSTL([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  const soup = parseSTL(bytes);
  assert.equal(soup.format, 'binary');
  assert.equal(soup.triCount, 1);
  assert.deepEqual(Array.from(soup.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('ASCII STL', () => {
  const text = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n`;
  const soup = parseSTL(new TextEncoder().encode(text));
  assert.equal(soup.format, 'ascii');
  assert.equal(soup.triCount, 1);
});

test('binary STL whose header starts with "solid"', () => {
  const bytes = writeSTL([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], 'solid exported by some CAD');
  assert.equal(parseSTL(bytes).format, 'binary');
});

test('a closed cube imports clean', async () => {
  const r = await importSTL(stlOf(Manifold.cube([20, 20, 20])));
  assert.equal(r.report.outcome, 'clean');
  near(r.report.volume, 8000, 1e-3);
});

test('flipped triangles are fixed', async () => {
  const bytes = editTris(Manifold.cube([20, 20, 20]), (ts) => ts.map((t, i) => (i % 3 === 0 ? [t[0], t[2], t[1]] : t)));
  const r = await importSTL(bytes);
  assert.equal(r.report.outcome, 'repaired');
  assert.ok(r.report.topology!.flipped > 0);
  near(r.report.volume, 8000, 1e-3);
});

test('an inside-out file is turned the right way', async () => {
  const bytes = editTris(Manifold.cube([20, 20, 20]), (ts) => ts.map((t) => [t[0], t[2], t[1]]));
  const r = await importSTL(bytes);
  assert.equal(r.report.outcome, 'repaired');
  near(r.report.volume, 8000, 1e-3);
});

test('overlapping shells are united', async () => {
  const a = Manifold.cube([20, 20, 20]);
  const b = Manifold.cube([20, 20, 20]).translate([10, 0, 0]);
  const r = await importSTL(stlOfShells([a, b]));
  assert.equal(r.report.outcome, 'repaired');
  near(r.report.volume, 30 * 20 * 20, 1e-2);
});

test('shells touching along an edge are separated, then united', async () => {
  const a = Manifold.cube([10, 10, 10]);
  const b = Manifold.cube([10, 10, 10]).translate([10, 10, 0]);
  const r = await importSTL(stlOfShells([a, b]));
  assert.notEqual(r.report.outcome, 'refused', r.report.reason ?? '');
  near(r.report.volume, 2000, 1e-2);
});

test('bodies pressed face to face are united', async () => {
  // A bin standing on its base, exported as two bodies that share part of a face.
  const base = Manifold.cube([30, 30, 5]);
  const bin = Manifold.cube([20, 20, 20]).translate([5, 5, 5]);
  const r = await importSTL(stlOfShells([base, bin]));
  // Touching without overlap: uniting them changes nothing, so this still counts as clean.
  assert.equal(r.report.outcome, 'clean', r.report.reason ?? '');
  near(r.report.volume, 30 * 30 * 5 + 20 * 20 * 20, 1e-2);
});

test('bodies pressed face to face along a shared edge are paired, not dropped', async () => {
  // Same footprint, so the side faces meet along shared edges used by four triangles.
  // The upper block is turned 90 degrees so its bottom face is split along the other diagonal,
  // otherwise the two contact faces would be exact opposite copies and simply removed.
  const lower = Manifold.cube([20, 20, 5], true);
  const upper = Manifold.cube([20, 20, 5], true).rotate([0, 0, 90]).translate([0, 0, 5]);
  const r = await importSTL(stlOfShells([lower, upper]));
  assert.equal(r.report.outcome, 'repaired', r.report.reason ?? '');
  assert.ok(r.report.topology!.nonManifoldPaired > 0);
  near(r.report.volume, 4000, 1e-2);
});

test('a paper-thin fin on a wall is dropped, the body is kept', async () => {
  const box = Manifold.cube([20, 20, 20]);
  const { meshOf } = await import('./geometry.ts');
  const m = meshOf(box);
  // A 10 x 20 sheet sticking out of the x = 0 wall at z = 10, written as two opposite faces
  // that share the wall's vertices along the line where they meet it.
  const verts = [...m.vert];
  const add = (x: number, y: number, z: number) => { verts.push(x, y, z); return verts.length / 3 - 1; };
  const p0 = add(0, 0, 10), p1 = add(0, 20, 10), q0 = add(-10, 0, 10), q1 = add(-10, 20, 10);
  const fin = [p0, q0, q1, p0, q1, p1, p0, q1, q0, p0, p1, q1];
  // The wall needs the line z = 10 as an edge too: split the x = 0 face there.
  const w0 = add(0, 0, 0), w1 = add(0, 20, 0), w2 = add(0, 0, 20), w3 = add(0, 20, 20);
  const tris = [...m.tri].reduce<number[][]>((acc, _, i, arr) => { if (i % 3 === 0) acc.push(arr.slice(i, i + 3)); return acc; }, [])
    .filter((t) => !t.every((i) => Math.abs(m.vert[i * 3]) < 1e-9))
    .flat();
  // x = 0 wall faces -x: lower half and upper half.
  tris.push(w0, p0, p1, w0, p1, w1, p0, w2, w3, p0, w3, p1);
  tris.push(...fin);
  const r = await importSTL(writeSTL(verts, tris));
  assert.notEqual(r.report.outcome, 'refused', r.report.reason ?? '');
  assert.notEqual(r.report.outcome, 'partial', r.report.reason ?? '');
  near(r.report.volume, 8000, 1e-2);
});

test('a missing triangle is filled', async () => {
  const bytes = editTris(Manifold.cube([20, 20, 20]), (ts) => ts.slice(1));
  const r = await importSTL(bytes);
  assert.equal(r.report.outcome, 'repaired');
  assert.equal(r.report.topology!.holesFilled, 1);
  near(r.report.volume, 8000, 1e-2);
});

test('a missing face of a cylinder is filled', async () => {
  const cyl = Manifold.cylinder(10, 5, 5, 32);
  // Remove the top cap: every triangle whose vertices are all at z = 10.
  const { meshOf } = await import('./geometry.ts');
  const m = meshOf(cyl);
  const bytes = editTris(cyl, (ts) => ts.filter((t) => !t.every((i) => Math.abs(m.vert[i * 3 + 2] - 10) < 1e-6)));
  const r = await importSTL(bytes);
  assert.equal(r.report.outcome, 'repaired');
  near(r.report.volume, cyl.volume(), cyl.volume() * 1e-3);
});

test('a missing flat face with holes in it is filled as one face', async () => {
  let plate = Manifold.cube([40, 40, 10]);
  for (const x of [10, 30]) plate = plate.subtract(Manifold.cylinder(30, 3, 3, 32).translate([x, 20, -10]));
  const m = (await import('./geometry.ts')).meshOf(plate);
  // Remove the whole top face (z = 10), leaving an outline with two round islands open.
  const bytes = editTris(plate, (ts) => ts.filter((t) => !t.every((i) => Math.abs(m.vert[i * 3 + 2] - 10) < 1e-6)));
  const r = await importSTL(bytes);
  assert.equal(r.report.outcome, 'repaired', r.report.reason ?? '');
  near(r.report.volume, plate.volume(), plate.volume() * 1e-6);
});

test('an inner cavity stays a cavity', async () => {
  const outer = Manifold.cube([30, 30, 30], true);
  const inner = Manifold.cube([10, 10, 10], true);
  // The cavity's surface faces inwards, as a CAD export of a hollow part would write it.
  const { meshOf } = await import('./geometry.ts');
  const im = meshOf(inner);
  const flipped = new w.Mesh({ numProp: 3, vertProperties: new Float32Array(im.vert), triVerts: new Uint32Array(im.tri) });
  for (let i = 0; i < flipped.triVerts.length; i += 3) { const x = flipped.triVerts[i + 1]; flipped.triVerts[i + 1] = flipped.triVerts[i + 2]; flipped.triVerts[i + 2] = x; }
  const om = meshOf(outer);
  const verts = [...om.vert, ...im.vert];
  const base = om.vert.length / 3;
  const tris = [...om.tri, ...Array.from(flipped.triVerts, (i) => i + base)];
  const r = await importSTL(writeSTL(verts, tris));
  // A correctly written cavity needs no repair.
  assert.equal(r.report.outcome, 'clean');
  assert.equal(r.report.voids, 1);
  near(r.report.volume, 27000 - 1000, 1e-2);
});

test('an open sheet is refused with a reason', async () => {
  const bytes = writeSTL([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], [0, 1, 2, 1, 3, 2]);
  const r = await importSTL(bytes);
  // A single flat sheet gets "filled" into a zero-volume shell, which must still be refused.
  assert.equal(r.report.outcome, 'refused');
  assert.ok(r.report.reason);
});
