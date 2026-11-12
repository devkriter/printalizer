import { readFileSync } from 'node:fs';
import { importSTL, meshOf } from '../core/geometry.ts';
import { findCylinders, defaultFindOptions } from '../core/holes.ts';
const { solid } = await importSTL(new Uint8Array(readFileSync(`phase0/corpus/${process.argv[2]}.stl`)));
const lines: string[] = [];
findCylinders(meshOf(solid!), { ...defaultFindOptions, debug: (l) => lines.push(l) });
const filt = process.argv[3];
console.log(lines.filter((l) => !filt || l.includes(filt)).slice(0, 40).join('\n'));
