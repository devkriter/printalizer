import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifold, meshOf } from './geometry.ts';
import { findCylinders } from './holes.ts';

const w = await loadManifold();
const { Manifold, CrossSection } = w;
const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

const block = () => Manifold.cube([40, 20, 30], true);
const holes = (m: InstanceType<typeof Manifold>) => findCylinders(meshOf(m)).filter((c) => c.kind === 'hole' && c.coverage > 300);

for (const segments of [12, 32, 128]) {
  test(`horizontal hole with ${segments} sides`, () => {
    const hole = Manifold.cylinder(40, 4, 4, segments, true).rotate([90, 0, 0]);
    const found = holes(block().subtract(hole));
    assert.equal(found.length, 1);
    const h = found[0];
    assert.equal(h.orientation, 'horizontal');
    near(h.radius, 4, 0.05);
    near(h.length, 20, 1e-3);
    near(h.coverage, 360, 1);
    assert.equal(h.segments, segments);
    near(Math.abs(h.axis[1]), 1, 1e-6);
  });
}

test('vertical hole', () => {
  const found = holes(block().subtract(Manifold.cylinder(40, 3, 3, 48, true)));
  assert.equal(found.length, 1);
  assert.equal(found[0].orientation, 'vertical');
  near(found[0].radius, 3, 0.05);
});

test('angled hole', () => {
  const found = holes(block().subtract(Manifold.cylinder(60, 3, 3, 48, true).rotate([0, 30, 0])));
  assert.equal(found.length, 1);
  assert.equal(found[0].orientation, 'angled');
});

test('several holes, two sizes', () => {
  let m = block();
  for (const x of [-12, 0, 12]) m = m.subtract(Manifold.cylinder(40, x === 0 ? 5 : 2, x === 0 ? 5 : 2, 40, true).rotate([90, 0, 0]).translate([x, 0, 0]));
  const found = holes(m).sort((a, b) => a.center[0] - b.center[0]);
  assert.equal(found.length, 3);
  near(found[1].radius, 5, 0.05);
  near(found[0].radius, 2, 0.05);
});

test('a boss is not a hole', () => {
  const m = block().add(Manifold.cylinder(10, 4, 4, 32).translate([0, 0, 15]));
  const all = findCylinders(meshOf(m));
  assert.equal(all.filter((c) => c.kind === 'hole').length, 0);
  const boss = all.filter((c) => c.kind === 'boss' && c.coverage > 300);
  assert.equal(boss.length, 1);
  near(boss[0].radius, 4, 0.05);
});

test('rounded edges are partial arcs, not holes', () => {
  const plate = CrossSection.square([30, 20], true).offset(3, 'Round', 2, 32).extrude(5);
  const all = findCylinders(meshOf(plate));
  assert.equal(all.filter((c) => c.coverage > 300).length, 0);
  const corners = all.filter((c) => c.kind === 'boss');
  assert.equal(corners.length, 4);
  for (const c of corners) near(c.coverage, 90, 3);
});

test('a hex hole is ignored', () => {
  const found = holes(block().subtract(Manifold.cylinder(40, 4, 4, 6, true).rotate([90, 0, 0])));
  assert.equal(found.length, 0);
});

test('a hole crossed by a slot is still one hole', () => {
  let m = block().subtract(Manifold.cylinder(40, 4, 4, 48, true).rotate([90, 0, 0]));
  m = m.subtract(Manifold.cube([2, 4, 40], true)); // thin vertical slot through the middle of the hole
  const found = holes(m);
  assert.equal(found.length, 1);
  near(found[0].length, 20, 1e-3);
});

test('a hole whose wall is cut diagonally (twisted tessellation)', () => {
  // Turn the top ring of corners half a step, so the wall triangles no longer form upright strips.
  const segs = 48;
  const twisted = Manifold.cylinder(40, 4, 4, segs, true).warp((v) => {
    if (v[2] > 0) {
      const a = Math.atan2(v[1], v[0]) + Math.PI / segs, r = Math.hypot(v[0], v[1]);
      v[0] = r * Math.cos(a); v[1] = r * Math.sin(a);
    }
  }).rotate([90, 0, 0]);
  const found = holes(block().subtract(twisted));
  assert.equal(found.length, 1);
  near(found[0].radius, 4, 0.1);
  assert.equal(found[0].orientation, 'horizontal');
});

test('a hole ending on a slanted face', () => {
  const slanted = block().subtract(Manifold.cube([80, 80, 80], true).rotate([25, 0, 0]).translate([0, 40, 30]));
  const found = holes(slanted.subtract(Manifold.cylinder(60, 3, 3, 64, true).rotate([90, 0, 0])));
  assert.equal(found.length, 1);
  near(found[0].radius, 3, 0.05);
  near(Math.abs(found[0].axis[1]), 1, 1e-4);
});

test('a sphere has no holes', () => {
  const all = findCylinders(meshOf(Manifold.sphere(10, 64)));
  assert.equal(all.filter((c) => c.coverage > 300).length, 0);
});
