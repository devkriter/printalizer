// __NAME__: describe in one or two sentences what it changes and why that prints better.
import { defineFeature, number, subtract } from '../../feature-api/index.ts';

export default defineFeature({
  api: 1,
  id: '__ID__',
  name: '__NAME__',
  single: '__NAME__',
  plural: '__PLURAL__',
  noun: 'feature',
  version: '0.1',
  summary: 'One sentence for the features list.',
  icon: '<path d="M4 4h16v16H4Z"/>',
  params: [number('size', 'Size', 1, { min: 0.2, max: 5, step: 0.1, dp: 1, unit: ' mm' })],
  chip: '{size} mm',

  find(ctx) {
    // Return what this feature can change. Each target needs an anchor, the triangles that show
    // it, and a one-line detail. Put anything build() needs into data, as plain values.
    return ctx.find.cylinders()
      .filter((c) => c.kind === 'hole' && c.coverage >= 300)
      .map((c) => ({ anchor: c.center, tris: c.triangles, detail: `⌀${(c.radius * 2).toFixed(1)} hole`, data: { center: c.center, radius: c.radius } }));
  },

  build(target, params, ctx) {
    // Return solids to add or subtract. The app does the cutting.
    // Example: a square pocket around the hole, wider than the hole by `size` on each side.
    const [x, y, z] = target.data.center as [number, number, number];
    const h = (target.data.radius as number) + (params.size as number);
    return [subtract(ctx.solids.box([x - h, y - h, z - 1], [x + h, y + h, z + 1]))];
  },
});
