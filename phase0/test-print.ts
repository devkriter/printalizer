// Phase 0 test print: one plate, stood upright, with horizontal holes of four sizes in three rows.
//   bottom row: plain round (what slicers get today)
//   middle row: tented, 45 degree pointed roof
//   top row:    tented, roof cut flat 0.4 mm above the circle
// Rows are marked with 1, 2 and 3 dimples on the front face, left margin. The top right corner is cut.
// Writes the STL and a 3MF that also carries the original (all round) and the edit list.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifold, meshOf } from '../core/geometry.ts';
import { findCylinders } from '../core/holes.ts';
import { writeSTL } from '../core/stl.ts';
import { write3MF } from '../core/threemf.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const w = await loadManifold();
const { Manifold, CrossSection } = w;

const W = 60, D = 10, H = 52;
const diameters = [3, 5, 8, 12];
const xs = [12, 21, 33.5, 50];
const rows = [
  { z: 8, roof: 'round' as const },
  { z: 25, roof: 'teardrop' as const },
  { z: 42, roof: 'flat' as const },
];
const SEGS = 64;
const ROOF_GAP = 0.4;

/** Hole profile in the XZ plane, centred on the origin, z up. */
function profile(r: number, roof: 'round' | 'teardrop' | 'flat') {
  const circle = CrossSection.circle(r, SEGS);
  if (roof === 'round') return circle;
  const s = r / Math.SQRT2;
  const tent = new CrossSection([[[0, 0], [s, s], [0, r * Math.SQRT2], [-s, s]]]);
  let p = circle.add(tent);
  if (roof === 'flat') p = p.intersect(CrossSection.square([4 * r, r + ROOF_GAP + 2 * r]).translate([-2 * r, -2 * r]));
  return p;
}

/** A hole running along Y through the whole plate. */
function hole(x: number, z: number, d: number, roof: 'round' | 'teardrop' | 'flat') {
  // Extrude along +Z, then turn so the extrusion runs along -Y and the profile's up stays up.
  return profile(d / 2, roof).extrude(D + 2).rotate([90, 0, 0]).translate([x, D + 1, z]);
}

function plate(roofs: Array<'round' | 'teardrop' | 'flat'>) {
  let m = Manifold.cube([W, D, H]);
  // Orientation mark: cut the top right corner.
  m = m.subtract(Manifold.cube([8, D + 2, 8], true).rotate([0, 45, 0]).translate([W, D / 2, H]));
  rows.forEach((row, ri) => {
    diameters.forEach((d, i) => { m = m.subtract(hole(xs[i], row.z, d, roofs[ri])); });
    // Row number as dimples on the front face (y = 0).
    for (let k = 0; k <= ri; k++) m = m.subtract(Manifold.sphere(0.9, 24).translate([4, 0, row.z - ri * 1.5 + k * 3]));
  });
  return m;
}

const result = plate(rows.map((r) => r.roof));
const original = plate(['round', 'round', 'round']);

const resultMesh = meshOf(result);
const originalMesh = meshOf(original);

// The hole finder should see all twelve round holes on the original as horizontal.
const found = findCylinders(originalMesh).filter((c) => c.kind === 'hole' && c.coverage >= 300 && c.orientation === 'horizontal');
console.log(`hole finder on the original: ${found.length} horizontal holes, diameters ${found.map((c) => (c.radius * 2).toFixed(2)).sort().join(', ')}`);

const edits = rows.flatMap((row) => row.roof === 'round' ? [] : diameters.map((d, i) => ({
  feature: 'tented-holes',
  hole: { center: [xs[i], D / 2, row.z], axis: [0, 1, 0], diameter: d },
  params: { roof: row.roof === 'teardrop' ? 'teardrop' : 'truncated', angle: 45, roofGap: ROOF_GAP },
})));

writeFileSync(join(out, 'tented-hole-test.stl'), writeSTL(resultMesh.vert, resultMesh.tri, 'Printalizer tented hole test'));
writeFileSync(join(out, 'tented-hole-test.3mf'), write3MF(resultMesh, 'Tented hole test', {
  original: originalMesh,
  data: { formatVersion: 1, app: 'Printalizer 0.0.0 (Phase 0)', edits },
}));
// The same mesh without Printalizer's parts, to compare slicer behaviour.
writeFileSync(join(out, 'tented-hole-test-plain.3mf'), write3MF(resultMesh, 'Tented hole test'));
console.log(`plate ${W} x ${D} x ${H} mm, volume ${(result.volume() / 1000).toFixed(1)} cm3, ${result.numTri()} triangles, genus ${result.genus()}`);
console.log(`edits: ${edits.length}`);
