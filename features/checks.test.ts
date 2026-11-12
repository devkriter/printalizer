// Automated checks every feature must pass, run on each feature's sample parts:
// - it finds what the sample contains,
// - applying it everywhere gives a valid closed solid with a sensible volume change,
// - it does what it claims (fewer overhangs, or less on the bed for the chamfer),
// - its settings and its output are plain data, so it could run isolated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overhangs } from '../core/overhang.ts';
import { meshOf } from '../core/geometry.ts';
import { Composer, Part, findTargets, ready } from '../feature-api/runtime.ts';
import { FEATURE_API, manifestOf } from '../feature-api/index.ts';
import type { Params } from '../feature-api/index.ts';
import { loadBuiltIns } from './registry.ts';
import { placeOnBed } from '../core/orient.ts';

const w = await ready();

/**
 * What a slicer sees: for each layer, the area not held up by the layer below grown by one 45°
 * step. Staircases from layer-based features count as supported, as they print.
 */
function unsupported(m: InstanceType<typeof w.Manifold>, h = 0.2): number {
  const top = m.boundingBox().max[2];
  let total = 0;
  let below = m.slice(h / 2);
  for (let z = 1.5 * h; z < top; z += h) {
    const here = m.slice(z);
    const grown = below.offset(h * 1.05, 'Round', 2, 16);
    const bare = here.subtract(grown);
    total += bare.area();
    bare.delete(); grown.delete(); below.delete();
    below = here;
  }
  below.delete();
  return total;
}
const features = await loadBuiltIns();
const setup = { layer: 0.2, nozzle: 0.4, overhang: 45, bedW: 180, bedD: 180 };

test('the five baseline features are there, with distinct ids and shortcuts', () => {
  const ids = features.map((f) => f.def.id);
  for (const id of ['tented-holes', 'threads-45', 'bridge-steps', 'base-chamfer', 'overhang-fill']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  const keys = features.map((f) => f.def.key).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length);
});

for (const { def, samples, folder } of features) {
  test(`${def.id}: folder name matches its id, and it declares the current format`, () => {
    assert.equal(folder, def.id);
    assert.equal(def.api, FEATURE_API);
    const m = manifestOf(def);
    assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
    for (const p of def.params) if (p.type === 'number') assert.ok(p.def >= p.min && p.def <= p.max, `${p.k} default within range`);
  });

  for (const s of samples) {
    test(`${def.id}: ${s.name}`, () => {
      const part = new Part(placeOnBed(s.build(w), 90, 90), setup);
      const targets = findTargets(def, part);
      assert.ok(targets.length >= s.targets, `found ${targets.length}, expected at least ${s.targets}`);
      // Plain data: survives a round trip through JSON.
      assert.deepEqual(JSON.parse(JSON.stringify(targets)), targets);
      const params: Params = Object.fromEntries(def.params.map((p) => [p.k, p.def]));
      const composer = new Composer();
      composer.setPart(part);
      const edits = targets.map((target, i) => ({ id: i + 1, feature: def.id, target, params }));
      const result = composer.compose(edits, new Map([[def.id, def]]));
      for (const e of result.edits) assert.ok(e.ok, e.error ?? '');
      assert.equal(result.solid.status(), 'NoError');
      const before = part.base.volume(), after = result.solid.volume();
      assert.ok(Math.abs(after - before) / before < 0.3, `volume changed by ${(((after - before) / before) * 100).toFixed(1)}%`);
      assert.ok(Math.abs(after - before) > 1e-6, 'the part changed');
      assert.ok(result.owner.some((o) => o > 0), 'some result faces are attributed to the edits');
      if (s.expect === 'fewer-overhangs') {
        const u0 = unsupported(part.base), u1 = unsupported(result.solid);
        assert.ok(u1 < u0 * 0.5, `unsupported area ${u0.toFixed(1)} -> ${u1.toFixed(1)} mm²`);
      }
      if (s.expect === 'smaller-bed-contact') {
        const pm = part.mesh, rm = meshOf(result.solid);
        const o0 = overhangs(pm.vert, pm.tri, 46), o1 = overhangs(rm.vert, rm.tri, 46);
        assert.ok(o1.bedArea < o0.bedArea - 1, `on the bed ${o0.bedArea.toFixed(1)} -> ${o1.bedArea.toFixed(1)} mm²`);
      }
    });
  }
}
