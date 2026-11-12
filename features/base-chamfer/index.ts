// Base chamfer: the first layer squashes outwards (elephant's foot). A small 45° chamfer around the
// outline on the bed hides the flare so parts still fit together.
import { defineFeature, number, subtract } from '../../feature-api/index.ts';

export default defineFeature({
  api: 1,
  id: 'base-chamfer',
  name: 'Base chamfer',
  single: 'Base chamfer',
  plural: 'base chamfers',
  noun: 'bed edge',
  version: '1.0',
  summary: 'Chamfers the edge on the bed against elephant’s foot.',
  icon: '<path d="M4 4h16v11l-5 5H9l-5-5Z"/>',
  key: '4',
  oneTarget: true,
  params: [number('size', 'Size', 0.4, { min: 0.2, max: 1.5, step: 0.05, dp: 2, unit: ' mm' })],
  chip: '{size} mm',

  find(ctx) {
    const bed = ctx.find.bedFaces();
    if (bed.area < 1) return [];
    const { vert, tri } = ctx.part;
    // Show the faces on the bed plus the sides just above them.
    const tris = [...bed.tris];
    let ax = 0, ay = 0, n = 0;
    for (let t = 0; t < tri.length / 3; t++) {
      const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
      if (Math.max(vert[a + 2], vert[b + 2], vert[c + 2]) > 1 || Math.min(vert[a + 2], vert[b + 2], vert[c + 2]) > 0.01) continue;
      const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2];
      const vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
      const nz = ux * vy - uy * vx, l = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
      if (Math.abs(nz / l) < 0.7) { tris.push(t); ax += vert[a]; ay += vert[a + 1]; n++; }
    }
    const center = n ? [ax / n, ay / n, 0] : [(ctx.part.min[0] + ctx.part.max[0]) / 2, (ctx.part.min[1] + ctx.part.max[1]) / 2, 0];
    return [{ anchor: center as [number, number, number], tris, detail: 'Edge on the bed', measure: {} }];
  },

  build(_target, p, ctx) {
    const s = p.size as number;
    const S = ctx.solids;
    const outline = ctx.section(Math.min(0.01, s / 10));
    // A 45° slope as fine steps: each step removes a band around the outline, narrowing upwards.
    const steps = Math.max(4, Math.min(30, Math.ceil(s / 0.05)));
    const parts = [];
    for (let k = 0; k < steps; k++) {
      const z0 = (k * s) / steps, z1 = ((k + 1) * s) / steps;
      const inset = s - (k + 0.5) * (s / steps);
      const band = ctx.shapes.difference(outline, ctx.shapes.offset(outline, -inset, 'Miter'));
      if (!band.length) continue;
      const below = k === 0 ? 0.02 : 0;
      parts.push(S.translate(S.extrude(band, z1 - z0 + below), [0, 0, z0 - below]));
    }
    return parts.length ? [subtract(S.union(...parts))] : [];
  },
});
