import { readFileSync } from 'node:fs';
import { importSTL, meshOf } from '../core/geometry.ts';
import { findCylinders } from '../core/holes.ts';
const { solid } = await importSTL(new Uint8Array(readFileSync(`phase0/corpus/${process.argv[2]}.stl`)));
const m = meshOf(solid!);
const t0 = performance.now();
const all = findCylinders(m).filter((c) => c.kind === 'hole' && c.radius > 0.5);
console.log('ms', Math.round(performance.now() - t0), 'holes (any coverage)', all.length);
const by = new Map<string, number>();
for (const c of all) { const k = `d${(c.radius*2).toFixed(1)} ${c.orientation} cov${c.coverage >= 300 ? 'full' : Math.round(c.coverage/30)*30} len${c.length.toFixed(1)} seg${c.segments}`; by.set(k, (by.get(k) ?? 0) + 1); }
console.log([...by.entries()].sort().map(([k, n]) => `${n}× ${k}`).join('\n'));
