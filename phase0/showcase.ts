// A demo part with something for every built-in feature: horizontal holes, a counterbore facing the
// bed, a ledge, an M8 threaded hole, and an edge on the bed. Writes phase0/out/showcase.stl.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadManifold, meshOf } from '../core/geometry.ts';
import { writeSTL } from '../core/stl.ts';
import { threadOutline } from '../core/threads.ts';

const w = await loadManifold();
const { Manifold, CrossSection } = w;
let m = Manifold.cube([70, 30, 24]);
// Horizontal holes along Y.
for (const [x, r] of [[10, 1.6], [22, 2.5], [36, 4]] as const) m = m.subtract(Manifold.cylinder(40, r, r, 48, true).rotate([90, 0, 0]).translate([x, 15, 14]));
// Counterbore from the bed: ⌀11 × 4 deep, then a ⌀5.5 hole through.
m = m.subtract(Manifold.cylinder(4.5, 5.5, 5.5, 64).translate([56, 8, -0.5])).subtract(Manifold.cylinder(30, 2.75, 2.75, 48).translate([56, 8, -1]));
// M8 threaded hole from the top, 10 deep.
const seg = 72, L = 10;
const thread = new CrossSection([threadOutline('internal', 4, 1.25, 30, 1.25 / 8, seg)]).extrude(L + 0.5, Math.ceil(((L + 0.5) / 1.25) * seg), (360 * (L + 0.5)) / 1.25);
m = m.subtract(thread.translate([56, 22, 24 - L]));
// A ledge sticking out at the back, 8 mm above the bed.
m = m.add(Manifold.cube([30, 12, 4]).translate([20, 30, 16]));
mkdirSync('phase0/out', { recursive: true });
const { vert, tri } = meshOf(m);
writeFileSync('phase0/out/showcase.stl', writeSTL(vert, tri, 'Printalizer showcase'));
console.log('showcase.stl', tri.length / 3, 'triangles, genus', m.genus());
