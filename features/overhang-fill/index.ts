// Overhang fill: builds a ledge out underneath at a printable angle, so it needs no support.
// A fillet that faces the bed becomes, in effect, a chamfer.
import { add, defineFeature, number } from '../../feature-api/index.ts';
import type { Polygons } from '../../feature-api/index.ts';

export default defineFeature({
  api: 1,
  id: 'overhang-fill',
  name: 'Overhang fill',
  single: 'Overhang fill',
  plural: 'overhang fills',
  noun: 'overhang',
  version: '1.0',
  summary: 'Builds an overhang out to 45° so it prints without support.',
  icon: '<path d="M4 21V4h17v6H10v11Z"/><path d="M21 10 10 21" stroke-dasharray="2.5 2"/>',
  key: '5',
  usesLayerHeight: true,
  params: [number('angle', 'Overhang angle', 45, { min: 30, max: 60, step: 1, unit: '°' })],
  chip: '{angle}°',

  find(ctx) {
    // Leave other features' work alone: ceilings of horizontal holes (Tented holes), thread flanks
    // (45° threads), and ceilings inside vertical holes and counterbores (Bridge steps). Filling
    // those would close the hole or destroy the thread.
    const taken = new Set<number>();
    const cyl = ctx.find.cylinders();
    for (const c of cyl) if (c.kind === 'hole' && c.orientation === 'horizontal' && c.coverage >= 300) for (const t of c.triangles) taken.add(t);
    for (const th of ctx.find.threads()) for (const t of th.triangles) taken.add(t);
    const bores = cyl.filter((c) => c.kind === 'hole' && c.orientation === 'vertical' && c.coverage >= 300);
    const insideBore = (p: [number, number, number]) => bores.some((b) => Math.hypot(p[0] - b.center[0], p[1] - b.center[1]) < b.radius + 0.05
      && p[2] > b.center[2] - b.length / 2 - 0.05 && p[2] < b.center[2] + b.length / 2 + 0.05);
    const { vert, tri } = ctx.part;
    const area = (t: number) => {
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2];
      const vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
      return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    };
    const takenShare = (tris: number[]) => { let a = 0, all = 0; for (const t of tris) { const x = area(t); all += x; if (taken.has(t)) a += x; } return all ? a / all : 0; };
    return ctx.find.overhangs(ctx.setup.overhang)
      // Small slivers (fillet facets, text, chamfer corners) print fine on their own; offer real ledges.
      .filter((r) => r.area >= 8 && r.extent >= 3 && takenShare(r.tris) < 0.3 && !insideBore(r.centroid))
      .map((r) => ({
        anchor: r.centroid,
        tris: r.tris,
        detail: `${Math.max(1, Math.round(r.extent))} mm overhang`,
        measure: {},
        data: { outline: r.outline, zMin: r.zMin, zMax: r.zMax },
      }));
  },

  build(target, p, ctx) {
    const { outline, zMin, zMax } = target.data as { outline: Polygons; zMin: number; zMax: number };
    const h = ctx.setup.layer;
    const step = h / Math.tan(((p.angle as number) * Math.PI) / 180); // how far each layer may step out
    const S = ctx.solids, sh = ctx.shapes;
    const region = sh.offset(outline, 0.1);
    const near = sh.offset(region, step + 0.1);
    const layers = [];
    let fillAbove: Polygons = [];
    // Walk down from the top of the overhang. Each layer must hold up the layer above it, shrunk
    // by one step, within the overhang's footprint.
    for (let i = Math.ceil(zMax / h); i >= 0 && layers.length < 4000; i--) {
      const z0 = i * h;
      const above = sh.intersection(sh.union(ctx.section(z0 + h * 1.5), fillAbove), near);
      const need = sh.intersection(sh.offset(above, -step), region);
      const fill = need.length ? sh.difference(need, ctx.section(z0 + h * 0.5)) : [];
      const area = fill.length ? sh.area(fill) : 0;
      if (area > 1e-3) layers.push(S.translate(S.extrude(fill, h + 0.001), [0, 0, z0]));
      fillAbove = area > 1e-3 ? fill : [];
      if (z0 + h < zMin && area <= 1e-3) break;
    }
    if (layers.length && layers.length * h > 30) ctx.warn(`The fill reaches ${Math.round(layers.length * h)} mm down.`);
    return layers.length ? [add(S.union(...layers))] : [];
  },
});
