// 45° threads: a standard thread's underside is a 60° overhang on an upright part. Re-profiling it
// to 45° flanks with a small flat crest prints cleanly. The old thread is filled, then the new one cut.
import { add, defineFeature, number, subtract, vec } from '../../feature-api/index.ts';
import type { Vec2, Vec3 } from '../../feature-api/index.ts';
import { ISO_COARSE, grooveDepth, threadOutline } from '../../core/threads.ts';

const SEGMENTS = 120;

export default defineFeature({
  api: 1,
  id: 'threads-45',
  name: '45° threads',
  label: 'Threads',
  single: '45° thread',
  plural: '45° threads',
  noun: 'thread',
  version: '1.0',
  summary: 'Re-profiles threads for support-free printing.',
  icon: '<path d="M5 3v18M5 4h4l6 3-6 3 6 3-6 3 6 3-6 1H5"/>',
  key: '2',
  params: [
    number('flank', 'Flank angle', 45, { min: 30, max: 60, step: 1, unit: '°' }),
    number('crest', 'Crest flat', 0.3, { min: 0.1, max: 0.8, step: 0.05, dp: 2, unit: ' mm' }),
    number('clear', 'Clearance', 0.15, { min: 0, max: 0.5, step: 0.01, dp: 2, unit: ' mm' }),
  ],
  measures: [{ k: 'size', label: 'Size', type: 'choice', options: ISO_COARSE.map((t) => t.size) }],
  chip: '{size}',

  find(ctx) {
    return ctx.find.threads().map((t) => ({
      anchor: vec.add(t.start, vec.scale(t.axis, t.length / 2)),
      tris: t.triangles,
      measure: { size: t.size },
      detail: `${t.size} ${t.kind === 'internal' ? 'threaded hole' : 'thread'}, ${+t.length.toFixed(1)} mm`,
      data: { kind: t.kind, axis: t.axis, start: t.start, length: t.length, majorD: t.majorD, pitch: t.pitch, hand: t.hand },
    }));
  },

  build(target, p, ctx) {
    const d = target.data as { kind: 'internal' | 'external'; axis: Vec3; start: Vec3; length: number; majorD: number; pitch: number; hand: 'right' | 'left' };
    const iso = ISO_COARSE.find((t) => t.size === target.measure.size);
    const D = iso ? iso.d : d.majorD;
    const P = iso ? iso.p : d.pitch;
    const flank = p.flank as number, crest = p.crest as number, clear = p.clear as number;
    const depth = grooveDepth(0, P, flank, crest).depth;
    const nozzle = ctx.setup.nozzle;
    if (depth < nozzle * 0.75) {
      ctx.warn(`${target.measure.size}×${P} at ${flank}° leaves ${depth.toFixed(2)} mm of thread depth, thinner than one ${nozzle} mm line. Use a coarser pitch or a heat-set insert.`);
    }
    const S = ctx.solids;
    const axis = d.axis;
    const x = vec.norm(vec.cross(Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], axis));
    const y = vec.cross(axis, x);
    const L = d.length;
    const twist = (d.hand === 'left' ? -360 : 360) * (L + 0.04) / P;
    const divisions = Math.ceil(((L + 0.04) / P) * SEGMENTS);
    const at = (s: ReturnType<typeof S.extrude>, back = 0) => S.place(s, vec.sub(d.start, vec.scale(axis, back)), x, y, axis);
    const mirror = (pts: Vec2[]): Vec2[] => (d.hand === 'left' ? pts.map(([a, b]) => [a, -b] as Vec2).reverse() : pts);
    // Fill the old thread with a plain cylinder over its length.
    const fillR = d.majorD / 2 + 0.03;
    const fill = add(at(S.cylinder(fillR, L, { segments: 96 })));
    if (d.kind === 'internal') {
      const hole = mirror(threadOutline('internal', D / 2 + clear, P, flank, crest, SEGMENTS));
      return [fill, subtract(at(S.extrude([hole], L + 0.04, { twist, divisions }), 0.02))];
    }
    // External: cut away everything outside the new thread's surface, out to just past the old crest.
    const outer: Vec2[] = Array.from({ length: 96 }, (_, i) => [Math.cos((i / 96) * 2 * Math.PI) * (fillR + 0.05), Math.sin((i / 96) * 2 * Math.PI) * (fillR + 0.05)]);
    const surface = mirror(threadOutline('external', D / 2 - clear, P, flank, crest, SEGMENTS)).slice().reverse();
    return [fill, subtract(at(S.extrude([outer, surface], L + 0.04, { twist, divisions }), 0.02))];
  },
});
