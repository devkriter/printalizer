import { readFileSync } from 'node:fs';
import { parseSTL } from '../core/stl.ts';
import { boundsOf, clean, diagonal, weld, boundaryLoops } from '../core/mesh.ts';
const soup = parseSTL(new Uint8Array(readFileSync(`phase0/corpus/${process.argv[2]}.stl`)));
const b = boundsOf(soup.positions); const diag = diagonal(b);
const { mesh } = clean(weld(soup.positions, Math.max(diag * 1e-7, 1e-6)), 0);
const loops = boundaryLoops(mesh.tri).sort((p, q) => q.length - p.length);
const v = mesh.vert;
console.log('size', b.max.map((x, i) => (x - b.min[i]).toFixed(1)).join(' x '), 'loops', loops.length);
for (const l of loops.slice(0, 5)) {
  const zs = l.map((i) => v[i * 3 + 2]); const xs = l.map((i) => v[i * 3]); const ys = l.map((i) => v[i * 3 + 1]);
  const ext = (a: number[]) => (Math.max(...a) - Math.min(...a)).toFixed(1);
  console.log(`loop ${l.length} edges, extent ${ext(xs)} x ${ext(ys)} x ${ext(zs)}, z ${Math.min(...zs).toFixed(1)}..${Math.max(...zs).toFixed(1)}`);
}
