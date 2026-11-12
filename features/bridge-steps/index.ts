// Bridge steps: the ceiling of a counterbore that faces the bed has nothing to anchor to. Cutting a
// slot one layer deep, then a square on the next layer, gives every bridge solid ends.
import { defineFeature, number, onThread, subtract } from '../../feature-api/index.ts';

export default defineFeature({
  api: 1,
  id: 'bridge-steps',
  name: 'Bridge steps',
  single: 'Bridge steps',
  plural: 'bridge steps',
  noun: 'counterbore',
  version: '1.0',
  summary: 'Adds sacrificial bridge layers to counterbores that face the bed.',
  icon: '<circle cx="12" cy="12" r="9"/><rect x="8" y="8" width="8" height="8"/>',
  key: '3',
  usesLayerHeight: true,
  params: [number('layers', 'Layers per step', 1, { min: 1, max: 3, step: 1 })],
  measures: [{ k: 'd', label: 'Bore', type: 'number', min: 2, max: 60, step: 0.1, unit: 'mm' }],
  chip: '⌀{d}',

  find(ctx) {
    const threads = ctx.find.threads();
    const holes = ctx.find.cylinders().filter((c) => c.kind === 'hole' && c.coverage >= 300 && c.orientation === 'vertical' && !onThread(c, threads));
    const out = [];
    for (const big of holes) {
      const bigTop = big.center[2] + big.length / 2;
      if (bigTop < 0.3) continue;
      for (const small of holes) {
        if (small === big || small.radius > big.radius - 0.3) continue;
        if (Math.hypot(small.center[0] - big.center[0], small.center[1] - big.center[1]) > 0.05) continue;
        const smallBottom = small.center[2] - small.length / 2;
        if (Math.abs(smallBottom - bigTop) > 0.05) continue;
        const D = Math.round(big.radius * 200) / 100;
        // The ceiling: downward faces at the top of the bore, between the two circles.
        const { vert, tri } = ctx.part;
        const ceiling: number[] = [];
        for (let t = 0; t < tri.length / 3; t++) {
          let ok = true, cx = 0, cy = 0;
          for (let k = 0; k < 3; k++) {
            const v = tri[t * 3 + k] * 3;
            if (Math.abs(vert[v + 2] - bigTop) > 0.02) { ok = false; break; }
            cx += vert[v] / 3; cy += vert[v + 1] / 3;
          }
          if (!ok) continue;
          const rr = Math.hypot(cx - big.center[0], cy - big.center[1]);
          if (rr > small.radius - 0.01 && rr < big.radius + 0.01) ceiling.push(t);
        }
        out.push({
          anchor: [big.center[0], big.center[1], bigTop] as [number, number, number],
          tris: [...big.triangles, ...ceiling],
          measure: { d: D },
          detail: `⌀${+D.toFixed(1)} counterbore`,
          data: { cx: big.center[0], cy: big.center[1], zc: bigTop, hole: small.radius * 2 },
        });
        break;
      }
    }
    return out;
  },

  build(target, p, ctx) {
    const { cx, cy, zc, hole } = target.data as { cx: number; cy: number; zc: number; hole: number };
    const D = target.measure.d as number;
    const h = ctx.setup.layer * (p.layers as number);
    const S = ctx.solids;
    const bore = S.translate(S.cylinder(D / 2, 2 * h + 0.04, { segments: 96 }), [cx, cy, zc - 0.02]);
    // First step: a slot as wide as the hole, spanning the bore. Second: a square as wide as the hole.
    const slot = S.box([cx - D / 2 - 0.01, cy - hole / 2, zc - 0.02], [cx + D / 2 + 0.01, cy + hole / 2, zc + h]);
    const square = S.box([cx - hole / 2, cy - hole / 2, zc + h - 0.01], [cx + hole / 2, cy + hole / 2, zc + 2 * h]);
    if (hole > D - 0.6) ctx.warn('The hole is almost as wide as the bore, so the bridges are very short.');
    return [subtract(S.intersection(S.union(slot, square), bore))];
  },
});
