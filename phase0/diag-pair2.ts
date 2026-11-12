// Print the fan around failing edges of a corpus file.
import { readFileSync } from 'node:fs';
import { parseSTL } from '../core/stl.ts';
import { boundsOf, clean, diagonal, weld } from '../core/mesh.ts';
const soup = parseSTL(new Uint8Array(readFileSync(`phase0/corpus/${process.argv[2]}.stl`)));
const diag = diagonal(boundsOf(soup.positions));
const { mesh } = clean(weld(soup.positions, Math.max(diag * 1e-7, 1e-6)), 0);
const { vert, tri } = mesh;
const edges = new Map<string, number[]>();
for (let t = 0; t < tri.length / 3; t++) for (let k = 0; k < 3; k++) {
  const a = tri[t*3+k], b = tri[t*3+(k+1)%3]; const key = a < b ? `${a},${b}` : `${b},${a}`;
  (edges.get(key) ?? edges.set(key, []).get(key)!).push(t);
}
let shown = 0;
for (const [key, ts] of edges) {
  if (ts.length !== 4 || shown++ > 3) continue;
  const [a, b] = key.split(',').map(Number);
  const P = (i: number) => [vert[i*3], vert[i*3+1], vert[i*3+2]];
  console.log('edge', P(a).map(x=>x.toFixed(3)), '->', P(b).map(x=>x.toFixed(3)));
  for (const t of ts) {
    const v = [tri[t*3], tri[t*3+1], tri[t*3+2]];
    let fwd = false; for (let k = 0; k < 3; k++) if (v[k] === a && v[(k+1)%3] === b) fwd = true;
    const c = v.find((x) => x !== a && x !== b)!;
    const n = (() => { const p=P(v[0]),q=P(v[1]),r=P(v[2]); const u=[q[0]-p[0],q[1]-p[1],q[2]-p[2]], w=[r[0]-p[0],r[1]-p[1],r[2]-p[2]]; const x=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]]; const l=Math.hypot(...x); return x.map(e=>(e/l).toFixed(3)); })();
    console.log('   tri', t, fwd ? 'a->b' : 'b->a', 'third', P(c).map(x=>x.toFixed(3)), 'normal', n);
  }
}
