import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifold, meshOf } from './geometry.ts';
import { apply, autoDownNormal, mat4, placeOnBed, rotationToDown, turnZ } from './orient.ts';
import type { Vec3 } from './orient.ts';
import { overhangs } from './overhang.ts';

const w = await loadManifold();
const { Manifold } = w;
const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('rotationToDown turns any direction straight down', () => {
  const dirs: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [1, 2, 3], [-0.3, 0.2, -0.9]];
  for (const d of dirs) {
    const l = Math.hypot(...d);
    const r = apply(rotationToDown(d), [d[0] / l, d[1] / l, d[2] / l]);
    near(r[0], 0, 1e-12); near(r[1], 0, 1e-12); near(r[2], -1, 1e-12);
  }
});

test('a quarter turn about Z keeps Z', () => {
  const r = apply(turnZ(1), [1, 0, 0]);
  near(r[0], 0, 1e-12); near(r[1], 1, 1e-12); near(r[2], 0, 1e-12);
});

test('laying a part on a chosen face puts that face on the bed', () => {
  // A 10 x 20 x 30 box: lay it on its +X face, which is 20 x 30.
  let m = Manifold.cube([10, 20, 30]);
  m = m.transform(mat4(rotationToDown([1, 0, 0])));
  m = placeOnBed(m, 90, 90);
  const b = m.boundingBox();
  near(b.min[2], 0, 1e-9);
  near(b.max[2] - b.min[2], 10, 1e-9);
  near((b.min[0] + b.max[0]) / 2, 90, 1e-9);
  near(m.volume(), 6000, 1e-6);
});

test('auto picks the largest face of the hull', () => {
  // An L-shaped bracket standing on its short end: the largest flat side is its long back.
  const l = Manifold.union(Manifold.cube([40, 10, 4]), Manifold.cube([4, 10, 25]));
  const n = autoDownNormal(l.rotate([0, 90, 0]));
  // The 40 x 10 face was the bottom (normal -Z) before turning 90 degrees about Y, which maps -Z to -X.
  near(n[0], -1, 1e-6);
});

test('overhang map: a T shape overhangs under its arms only', () => {
  const t = Manifold.union(Manifold.cube([10, 10, 20]).translate([-5, -5, 0]), Manifold.cube([40, 10, 5]).translate([-20, -5, 20]));
  const { vert, tri } = meshOf(t);
  const o = overhangs(vert, tri, 45);
  near(o.area, 2 * 15 * 10, 1e-6); // the undersides of both arms
  near(o.bedArea, 100, 1e-6);
  // Walls never count, nor faces leaning less than the limit.
  const wedge = Manifold.extrude([[0, 0], [20, 0], [0, 20]], 10); // 45 degree slope facing up
  const wm = meshOf(wedge.rotate([90, 0, 0]));
  assert.equal(overhangs(wm.vert, wm.tri, 45).area, 0);
});
