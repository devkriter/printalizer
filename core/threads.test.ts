import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifold, meshOf } from './geometry.ts';
import { findThreads, grooveDepth, threadOutline } from './threads.ts';

const w = await loadManifold();
const { Manifold, CrossSection } = w;
const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

/**
 * An ISO-like 60° thread, modelled the way CAD exports one. One slice per outline step keeps the
 * side triangles running along the helix instead of across it.
 */
const SEG = 72;
function isoRod(d: number, p: number, len: number) {
  const outline = threadOutline('external', d / 2, p, 30, p / 8, SEG);
  return new CrossSection([outline]).extrude(len, Math.ceil((len / p) * SEG), (360 * len) / p);
}
function isoNut(d: number, p: number, len: number) {
  const hole = new CrossSection([threadOutline('internal', d / 2, p, 30, p / 8, SEG)]);
  return CrossSection.square([d * 2.2, d * 2.2], true).subtract(hole).extrude(len, Math.ceil((len / p) * SEG), (360 * len) / p);
}

test('45° profile depth matches the plan: M6×1 with 0.3 crest leaves 0.2 mm', () => {
  near(grooveDepth(0, 1, 45, 0.3).depth, 0.2, 1e-9);
  near(grooveDepth(0, 1.75, 45, 0.3).depth, 0.575, 1e-9);
});

test('finds an external M8 thread standing up', () => {
  const rod = isoRod(8, 1.25, 12).add(Manifold.cylinder(4, 7, 7, 6).translate([0, 0, -4]));
  const t = findThreads(meshOf(rod));
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, 'external');
  assert.equal(t[0].size, 'M8');
  assert.equal(t[0].pitch, 1.25);
  near(Math.abs(t[0].axis[2]), 1, 1e-6);
  near(t[0].length, 12, 0.3);
});

test('finds an internal M10 thread lying on its side', () => {
  const nut = isoNut(10, 1.5, 9).rotate([90, 0, 0]);
  const t = findThreads(meshOf(nut));
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, 'internal');
  assert.equal(t[0].size, 'M10');
  near(Math.abs(t[0].axis[1]), 1, 1e-6);
});

test('ISO depth: 60° profile with P/8 flats is about 0.54 P deep', () => {
  near(grooveDepth(0, 1, 30, 1 / 8).depth, 0.6495, 1e-3);
});

test('a 120° countersink is not a thread', () => {
  // Its cone faces lean 30° like thread flanks, but all one way.
  const cone = Manifold.cylinder(2.3, 0.5, 4.5, 64).translate([0, 0, 2.7]);
  const block = Manifold.cube([20, 20, 10], true).translate([0, 0, 5]).subtract(cone).subtract(Manifold.cylinder(30, 0.5, 0.5, 32, true));
  assert.equal(findThreads(meshOf(block)).length, 0);
});

test('a plain hole is not a thread', () => {
  const block = Manifold.cube([20, 20, 10], true).subtract(Manifold.cylinder(30, 3, 3, 64, true));
  assert.equal(findThreads(meshOf(block)).length, 0);
});
