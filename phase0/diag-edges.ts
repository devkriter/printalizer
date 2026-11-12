// Diagnostic: what do the edges used by more than two triangles look like?
import { readFileSync } from 'node:fs';
import { parseSTL } from '../core/stl.ts';
import { boundsOf, clean, diagonal, weld, signedVolume } from '../core/mesh.ts';
const id = process.argv[2];
const soup = parseSTL(new Uint8Array(readFileSync(`phase0/corpus/${id}.stl`)));
const b = boundsOf(soup.positions); const diag = diagonal(b);
const { mesh } = clean(weld(soup.positions, Math.max(diag * 1e-7, 1e-6)), diag * diag * 1e-14);
console.log('signed volume in', signedVolume(mesh.vert, mesh.tri).toFixed(1));
const edges = new Map<string, Array<{ t: number; fwd: boolean }>>();
for (let t = 0; t < mesh.tri.length / 3; t++) for (let k = 0; k < 3; k++) {
  const a = mesh.tri[t * 3 + k], c = mesh.tri[t * 3 + ((k + 1) % 3)];
  const key = a < c ? `${a},${c}` : `${c},${a}`;
  const l = edges.get(key) ?? []; l.push({ t, fwd: a < c }); edges.set(key, l);
}
const hist = new Map<string, number>();
let shown = 0;
for (const [key, l] of edges) {
  if (l.length <= 2) continue;
  const f = l.filter((x) => x.fwd).length;
  const sig = `${l.length} tris, ${f} one way / ${l.length - f} other`;
  hist.set(sig, (hist.get(sig) ?? 0) + 1);
  if (shown++ < 3) { const [a, c] = key.split(',').map(Number); console.log('example edge', [...mesh.vert.subarray(a * 3, a * 3 + 3)].map((x) => x.toFixed(2)), [...mesh.vert.subarray(c * 3, c * 3 + 3)].map((x) => x.toFixed(2))); }
}
console.log(hist);
