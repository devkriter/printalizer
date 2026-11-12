// Tented holes: gives horizontal round holes a pointed roof (a teardrop) so their ceiling prints
// without sagging. Only the roof is cut; the rest of the hole stays as it was.
import { choice, defineFeature, number, onThread, subtract, vec } from '../../feature-api/index.ts';
import type { Vec2, Vec3 } from '../../feature-api/index.ts';

export default defineFeature({
  api: 1,
  id: 'tented-holes',
  name: 'Tented holes',
  single: 'Tented hole',
  plural: 'tented holes',
  noun: 'hole',
  version: '1.0',
  summary: 'Adds a 45° roof to horizontal holes.',
  icon: '<path d="M6.7 11.3 12 4l5.3 7.3a7 7 0 1 1-10.6 0Z"/>',
  key: '1',
  params: [
    choice('roof', 'Roof', ['Teardrop', 'Flat'], 'Teardrop'),
    number('angle', 'Roof angle', 45, { min: 30, max: 60, step: 1, unit: '°' }),
    number('lift', 'Roof height', 0.4, { min: 0, max: 1, step: 0.05, dp: 2, unit: ' mm', showIf: { k: 'roof', eq: 'Flat' } }),
  ],
  measures: [{ k: 'd', label: 'Diameter', type: 'number', min: 1, max: 60, step: 0.1, unit: 'mm' }],
  chip: '⌀{d}',

  find(ctx) {
    const threads = ctx.find.threads();
    return ctx.find.cylinders()
      .filter((c) => c.kind === 'hole' && c.coverage >= 300 && c.orientation === 'horizontal' && c.radius >= 0.75 && !onThread(c, threads))
      .map((c) => {
        const d = Math.round(c.radius * 200) / 100;
        return {
          anchor: c.center,
          tris: c.triangles,
          measure: { d },
          detail: `⌀${+d.toFixed(1)} × ${+c.length.toFixed(1)} mm hole`,
          data: { axis: c.axis, center: c.center, length: c.length },
        };
      });
  },

  build(target, p, ctx) {
    const r = (target.measure.d as number) / 2;
    const axis = target.data.axis as Vec3;
    const center = target.data.center as Vec3;
    const length = (target.data.length as number) + 0.04;
    // Build the roof in a frame where Z runs along the hole and Y points up, away from the bed.
    const up = vec.norm(vec.sub([0, 0, 1], vec.scale(axis, axis[2])));
    const x = vec.cross(up, axis);
    const phi = ((90 - (p.angle as number)) * Math.PI) / 180; // where the roof touches the circle
    const tx = r * Math.cos(phi), ty = r * Math.sin(phi), apex = r / Math.sin(phi);
    let outline: Vec2[] = [[0, 0], [tx, ty], [0, apex], [-tx, ty]];
    if (p.roof === 'Flat') {
      const top = r + (p.lift as number);
      if (top < apex) {
        const w = tx * (apex - top) / (apex - ty);
        outline = top > ty ? [[0, 0], [tx, ty], [w, top], [-w, top], [-tx, ty]] : [[0, 0], [r, top], [-r, top]];
      }
    }
    const start = vec.sub(center, vec.scale(axis, length / 2));
    return [subtract(ctx.solids.place(ctx.solids.extrude([outline], length), start, x, up, axis))];
  },
});
