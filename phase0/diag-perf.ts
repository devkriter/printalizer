import { readFileSync } from 'node:fs';
import { importSTL, meshOf } from '../core/geometry.ts';
import { findCylinders, defaultFindOptions } from '../core/holes.ts';
const { solid } = await importSTL(new Uint8Array(readFileSync(`phase0/corpus/${process.argv[2]}.stl`)));
const m = meshOf(solid!);
let runs = 0, rejected = 0, bigRejected = 0, grown = 0;
const t0 = performance.now();
const cs = findCylinders(m, { ...defaultFindOptions, debug: (l) => { runs++; const n = l.match(/-> (\d+)/g)?.map(x => +x.slice(3)) ?? []; grown += n.reduce((a, b) => a + b, 0); if (l.endsWith('rejected')) { rejected++; if (Math.max(...n, 0) > 200) { bigRejected++; if (bigRejected < 6) console.log(l); } } } });
console.log({ tris: m.tri.length / 3, ms: Math.round(performance.now() - t0), runs, rejected, bigRejected, grown, holes: cs.filter(c => c.kind === 'hole' && c.coverage >= 300).length });
