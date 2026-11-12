// Indexed meshes: welding a triangle soup, cleaning it and making its topology manifold.

export interface IndexedMesh {
  vert: Float64Array; // 3 per vertex
  tri: Uint32Array; // 3 per triangle, counter-clockwise seen from outside
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function boundsOf(pos: ArrayLike<number>): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

export function diagonal(b: Bounds): number {
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
}

/**
 * Merge vertices closer than `tol` into one. Uses a grid with cell size `tol`
 * and checks the neighbouring cells, so pairs that straddle a cell border still merge.
 */
export function weld(positions: Float32Array, tol: number): IndexedMesh {
  const n = positions.length / 3;
  const inv = 1 / tol;
  // Open-addressing hash of grid cells. Each slot holds the first vertex in that cell;
  // `chain` links further vertices in the same slot (cells that hash alike share a chain).
  let size = 1;
  while (size < n * 2) size <<= 1;
  const mask = size - 1;
  const head = new Int32Array(size).fill(-1);
  const chain = new Int32Array(n).fill(-1);
  const vert = new Float64Array(n * 3);
  const cellOf = new Int32Array(n * 3);
  let count = 0;
  const remap = new Uint32Array(n);
  const tol2 = tol * tol;
  const hash = (ix: number, iy: number, iz: number) => (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const ix = Math.floor(x * inv), iy = Math.floor(y * inv), iz = Math.floor(z * inv);
    let found = -1;
    // Exact cell first (nearly every match in CAD exports), then the neighbours.
    for (let pass = 0; pass < 2 && found < 0; pass++) {
      search: for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const centre = dx === 0 && dy === 0 && dz === 0;
            if (centre !== (pass === 0)) continue;
            const jx = ix + dx, jy = iy + dy, jz = iz + dz;
            for (let j = head[hash(jx, jy, jz)]; j >= 0; j = chain[j]) {
              if (cellOf[j * 3] !== jx || cellOf[j * 3 + 1] !== jy || cellOf[j * 3 + 2] !== jz) continue;
              const ex = vert[j * 3] - x, ey = vert[j * 3 + 1] - y, ez = vert[j * 3 + 2] - z;
              if (ex * ex + ey * ey + ez * ez <= tol2) { found = j; break search; }
            }
          }
    }
    if (found < 0) {
      found = count++;
      vert[found * 3] = x; vert[found * 3 + 1] = y; vert[found * 3 + 2] = z;
      cellOf[found * 3] = ix; cellOf[found * 3 + 1] = iy; cellOf[found * 3 + 2] = iz;
      const h = hash(ix, iy, iz);
      chain[found] = head[h];
      head[h] = found;
    }
    remap[i] = found;
  }
  return { vert: vert.slice(0, count * 3), tri: remap };
}

export interface CleanStats {
  degenerate: number; // triangles that use one vertex twice (after welding)
  slivers: number; // zero-area triangles with three distinct vertices: kept, they close T-junctions
  duplicates: number; // exact copies removed
  doubleWalls: number; // pairs of opposite copies removed
}

/** Remove collapsed and duplicate triangles. */
export function clean(m: IndexedMesh, areaTol: number): { mesh: IndexedMesh; stats: CleanStats } {
  const stats: CleanStats = { degenerate: 0, slivers: 0, duplicates: 0, doubleWalls: 0 };
  const keep: number[] = [];
  const seen = new Map<string, number>(); // sorted triple -> index into keep (or -1 when removed as a pair)
  const v = m.vert;
  for (let t = 0; t < m.tri.length / 3; t++) {
    const a = m.tri[t * 3], b = m.tri[t * 3 + 1], c = m.tri[t * 3 + 2];
    if (a === b || b === c || a === c) { stats.degenerate++; continue; }
    const ux = v[b * 3] - v[a * 3], uy = v[b * 3 + 1] - v[a * 3 + 1], uz = v[b * 3 + 2] - v[a * 3 + 2];
    const wx = v[c * 3] - v[a * 3], wy = v[c * 3 + 1] - v[a * 3 + 1], wz = v[c * 3 + 2] - v[a * 3 + 2];
    const area2 = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    if (area2 <= areaTol) stats.slivers++;
    const s = [a, b, c].sort((p, q) => p - q);
    const key = s.join(',');
    const prev = seen.get(key);
    if (prev === undefined) {
      seen.set(key, keep.length / 3);
      keep.push(a, b, c);
      continue;
    }
    if (prev < 0) { stats.duplicates++; continue; }
    // Same three vertices again. Same winding is a copy, opposite winding is an internal double wall.
    const pa = keep[prev * 3], pb = keep[prev * 3 + 1], pc = keep[prev * 3 + 2];
    const same = (pa === a && pb === b) || (pb === a && pc === b) || (pc === a && pa === b);
    if (same) stats.duplicates++;
    else {
      stats.doubleWalls++;
      keep[prev * 3] = keep[prev * 3 + 1] = keep[prev * 3 + 2] = 0xffffffff;
      seen.set(key, -1);
    }
  }
  const tri = keep.filter((_, i) => keep[i - (i % 3)] !== 0xffffffff);
  return { mesh: { vert: m.vert, tri: new Uint32Array(tri) }, stats };
}

class UnionFind {
  p: Int32Array;
  constructor(n: number) { this.p = new Int32Array(n); for (let i = 0; i < n; i++) this.p[i] = i; }
  find(x: number): number { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
  union(a: number, b: number) { a = this.find(a); b = this.find(b); if (a !== b) this.p[a] = b; }
}

export interface TopologyStats {
  boundaryEdges: number;
  nonManifoldEdges: number; // edges used by more than 2 triangles
  nonManifoldPaired: number; // of those, edges where every triangle found a partner
  flipped: number; // triangles whose winding was corrected
  nonOrientable: boolean;
  splitVertices: number; // extra vertices created to separate touching shells
  shells: number;
  holesFilled: number;
  holeEdgesFilled: number;
  holesLeft: number;
}

interface EdgeUse { t: number; a: number; b: number } // directed a->b as it appears in triangle t

function edgeKey(a: number, b: number) { return a < b ? a * 4294967296 + b : b * 4294967296 + a; }

/**
 * Make the topology manifold where it can be done safely:
 * - fix inconsistent winding inside each shell, and turn inside-out shells the right way,
 * - pair up triangles around edges shared by touching shells,
 * - give each shell its own copy of shared vertices,
 * - optionally close small holes in the surface.
 * Returns the repaired mesh, one triangle range per shell, and statistics.
 */
/** Triangulates 2D polygons (outer outlines and holes), returning index triples into the concatenated points. */
export type Triangulate = (polygons: Array<Array<[number, number]>>, epsilon: number) => Array<[number, number, number]>;

export interface FillOptions {
  fillHoles: boolean;
  maxHoleEdges: number;
  maxHoleAreaFraction: number;
  /** When given, openings that lie flat in one plane are filled as one face, including islands inside them. */
  triangulate?: Triangulate;
}

export function makeManifold(input: IndexedMesh, opts: FillOptions) {
  const tri = new Uint32Array(input.tri);
  const vert = input.vert;
  const nt = tri.length / 3;
  const stats: TopologyStats = {
    boundaryEdges: 0, nonManifoldEdges: 0, nonManifoldPaired: 0, flipped: 0, nonOrientable: false,
    splitVertices: 0, shells: 0, holesFilled: 0, holeEdgesFilled: 0, holesLeft: 0,
  };

  const collectEdges = () => {
    const edges = new Map<number, EdgeUse[]>();
    for (let t = 0; t < nt; t++)
      for (let k = 0; k < 3; k++) {
        const a = tri[t * 3 + k], b = tri[t * 3 + ((k + 1) % 3)];
        const key = edgeKey(a, b);
        const list = edges.get(key);
        const use = { t, a, b };
        if (list) list.push(use); else edges.set(key, [use]);
      }
    return edges;
  };

  // 1. Link triangles across edges used exactly twice and fix winding per shell.
  let edges = collectEdges();
  const links: Array<[number, number, number, number]> = []; // t1, t2, a, b (the shared edge)
  for (const list of edges.values()) {
    if (list.length === 2) links.push([list[0].t, list[1].t, list[0].a, list[0].b]);
    else if (list.length === 1) stats.boundaryEdges++;
    else stats.nonManifoldEdges++;
  }
  const flipTri = (t: number) => { const x = tri[t * 3 + 1]; tri[t * 3 + 1] = tri[t * 3 + 2]; tri[t * 3 + 2] = x; };
  const dirIn = (t: number, a: number, b: number) => {
    for (let k = 0; k < 3; k++) if (tri[t * 3 + k] === a && tri[t * 3 + ((k + 1) % 3)] === b) return true;
    return false;
  };
  const orient = (linkList: typeof links) => {
    const adj: number[][] = Array.from({ length: nt }, () => []);
    linkList.forEach((l, i) => { adj[l[0]].push(i); adj[l[1]].push(i); });
    const state = new Int8Array(nt); // 0 unvisited, 1 visited
    let flips = 0;
    for (let s = 0; s < nt; s++) {
      if (state[s]) continue;
      state[s] = 1;
      const queue = [s];
      while (queue.length) {
        const t = queue.pop()!;
        for (const li of adj[t]) {
          const [t1, t2, a, b] = linkList[li];
          const u = t1 === t ? t2 : t1;
          // Neighbours must run along the shared edge in opposite directions.
          const tAB = dirIn(t, a, b), uAB = dirIn(u, a, b);
          if (state[u]) { if (tAB === uAB) stats.nonOrientable = true; continue; }
          if (tAB === uAB) { flipTri(u); flips++; }
          state[u] = 1;
          queue.push(u);
        }
      }
    }
    return flips;
  };
  stats.flipped += orient(links);

  // 2. Pair triangles around edges used more than twice (shells touching along an edge).
  edges = collectEdges();
  for (const list of edges.values()) {
    if (list.length <= 2 || list.length % 2) continue;
    const a = list[0].a, b = list[0].b;
    const ex = vert[b * 3] - vert[a * 3], ey = vert[b * 3 + 1] - vert[a * 3 + 1], ez = vert[b * 3 + 2] - vert[a * 3 + 2];
    const el = Math.hypot(ex, ey, ez);
    const e = [ex / el, ey / el, ez / el];
    const u = perpendicular(e);
    const w = [e[1] * u[2] - e[2] * u[1], e[2] * u[0] - e[0] * u[2], e[0] * u[1] - e[1] * u[0]];
    const fans = list.map((use) => {
      let c = 0;
      for (let k = 0; k < 3; k++) { const x = tri[use.t * 3 + k]; if (x !== a && x !== b) c = x; }
      const dx = vert[c * 3] - vert[a * 3], dy = vert[c * 3 + 1] - vert[a * 3 + 1], dz = vert[c * 3 + 2] - vert[a * 3 + 2];
      const ang = Math.atan2(dx * w[0] + dy * w[1] + dz * w[2], dx * u[0] + dy * u[1] + dz * u[2]);
      return { t: use.t, ang, forward: dirIn(use.t, a, b) };
    }).sort((p, q) => p.ang - q.ang);
    // Material lies counter-clockwise of a triangle running b->a and clockwise of one running a->b,
    // so each solid wedge starts at a b->a triangle and ends at the next a->b one.
    const tryPairs = (order: typeof fans) => {
      const n = order.length;
      const pairs: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) {
        if (order[i].forward) continue;
        const next = order[(i + 1) % n];
        if (!next.forward) return null;
        pairs.push([order[i].t, next.t]);
      }
      return pairs.length * 2 === n ? pairs : null;
    };
    // Faces at the same angle (two bodies pressed together, or a paper-thin fin) can be in either
    // order. Which one is right depends on whether the zero-thickness gap is empty or solid,
    // so try each order of tied faces and keep the first consistent one.
    const ties: number[] = [];
    for (let i = 0; i + 1 < fans.length; i++) if (fans[i + 1].ang - fans[i].ang < 1e-5) ties.push(i);
    let pairs: Array<[number, number]> | null = null;
    for (let mask = 0; mask < 1 << Math.min(ties.length, 4) && !pairs; mask++) {
      const order = fans.slice();
      ties.forEach((i, bit) => { if (mask & (1 << bit)) [order[i], order[i + 1]] = [order[i + 1], order[i]]; });
      pairs = tryPairs(order);
    }
    if (pairs) {
      stats.nonManifoldPaired++;
      for (const [t1, t2] of pairs) links.push([t1, t2, a, b]);
    }
  }

  // 3. Shells: connected through links. Corners joined through links become one vertex.
  const shellUF = new UnionFind(nt);
  const cornerUF = new UnionFind(nt * 3);
  const cornerOf = (t: number, v: number) => {
    for (let k = 0; k < 3; k++) if (tri[t * 3 + k] === v) return t * 3 + k;
    return -1;
  };
  for (const [t1, t2, a, b] of links) {
    shellUF.union(t1, t2);
    cornerUF.union(cornerOf(t1, a), cornerOf(t2, a));
    cornerUF.union(cornerOf(t1, b), cornerOf(t2, b));
  }
  const cornerVert = new Map<number, number>();
  const outVert: number[] = [];
  const outTri = new Uint32Array(nt * 3);
  const usedBy = new Map<number, number>(); // original vertex -> number of output copies
  for (let c = 0; c < nt * 3; c++) {
    const root = cornerUF.find(c);
    let idx = cornerVert.get(root);
    if (idx === undefined) {
      idx = outVert.length / 3;
      const v = tri[c];
      outVert.push(vert[v * 3], vert[v * 3 + 1], vert[v * 3 + 2]);
      cornerVert.set(root, idx);
      usedBy.set(v, (usedBy.get(v) ?? 0) + 1);
    }
    outTri[c] = idx;
  }
  for (const n of usedBy.values()) stats.splitVertices += n - 1;

  // Group triangles by shell.
  const shellIndex = new Map<number, number>();
  const shells: number[][] = [];
  for (let t = 0; t < nt; t++) {
    const r = shellUF.find(t);
    let s = shellIndex.get(r);
    if (s === undefined) { s = shells.length; shellIndex.set(r, s); shells.push([]); }
    shells[s].push(t);
  }
  stats.shells = shells.length;

  let mesh: IndexedMesh = { vert: new Float64Array(outVert), tri: outTri };

  // 4. Close holes per shell by fanning each boundary loop to its centre.
  const shellTris: Uint32Array[] = shells.map((ts) => {
    const out = new Uint32Array(ts.length * 3);
    ts.forEach((t, i) => out.set(mesh.tri.subarray(t * 3, t * 3 + 3), i * 3));
    return out;
  });
  if (opts.fillHoles) {
    const extra: number[] = Array.from(mesh.vert);
    for (let s = 0; s < shellTris.length; s++) {
      let loops = boundaryLoops(shellTris[s]);
      if (!loops.length) continue;
      const add: number[] = [];
      // Only patch holes that are small next to the surface around them. A big opening
      // means the shell is a sheet or is missing whole faces, and a patch would be a guess.
      const shellArea = areaOf(extra, shellTris[s]);
      // A missing flat face: every loop of the opening lies in one plane. Fill it as a face with islands.
      if (opts.triangulate) {
        const used = fillPlanar(extra, loops, opts.triangulate, add, (loopsInFace) => {
          stats.holesFilled++;
          stats.holeEdgesFilled += loopsInFace.reduce((n, l) => n + l.length, 0);
        });
        loops = loops.filter((_, i) => !used.has(i));
      }
      for (const loop of loops) {
        if (loop.length > opts.maxHoleEdges || loopArea(extra, loop) > shellArea * opts.maxHoleAreaFraction) { stats.holesLeft++; continue; }
        stats.holesFilled++;
        stats.holeEdgesFilled += loop.length;
        if (loop.length === 3) { add.push(loop[0], loop[1], loop[2]); continue; }
        let cx = 0, cy = 0, cz = 0;
        for (const v of loop) { cx += extra[v * 3]; cy += extra[v * 3 + 1]; cz += extra[v * 3 + 2]; }
        const ci = extra.length / 3;
        extra.push(cx / loop.length, cy / loop.length, cz / loop.length);
        for (let i = 0; i < loop.length; i++) add.push(loop[i], loop[(i + 1) % loop.length], ci);
      }
      if (add.length) {
        const merged = new Uint32Array(shellTris[s].length + add.length);
        merged.set(shellTris[s]);
        merged.set(add, shellTris[s].length);
        shellTris[s] = merged;
      }
    }
    mesh = { vert: new Float64Array(extra), tri: mesh.tri };
  } else {
    for (const st of shellTris) stats.holesLeft += boundaryLoops(st).length;
  }

  return { vert: mesh.vert, shells: shellTris, stats };
}

/** Boundary loops of a triangle list, each as the vertex order that closes the hole. */
export function boundaryLoops(tri: Uint32Array): number[][] {
  const count = new Map<number, number>();
  for (let i = 0; i < tri.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(tri[i + k], tri[i + ((k + 1) % 3)]);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  // A hole runs opposite to the boundary edges of the triangles around it.
  const next = new Map<number, number[]>();
  for (let i = 0; i < tri.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = tri[i + k], b = tri[i + ((k + 1) % 3)];
      if (count.get(edgeKey(a, b)) !== 1) continue;
      const list = next.get(b);
      if (list) list.push(a); else next.set(b, [a]);
    }
  const loops: number[][] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop = [start];
      let cur = next.get(start)!.pop()!;
      let guard = 0;
      while (cur !== start && guard++ < 1e6) {
        loop.push(cur);
        const list = next.get(cur);
        if (!list || !list.length) break;
        cur = list.pop()!;
      }
      if (cur === start && loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/**
 * Fill groups of boundary loops that share one plane and contain one another (an outline with
 * islands), using a 2D triangulator. Single small loops are left to the simple fan fill.
 * Returns the indices of the loops it filled.
 */
function fillPlanar(vert: ArrayLike<number>, loops: number[][], triangulate: Triangulate, out: number[], onFill: (loops: number[][]) => void): Set<number> {
  const used = new Set<number>();
  // Plane of each loop from its vector area (Newell), and whether it is flat.
  const planes = loops.map((loop) => {
    let x = 0, y = 0, z = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
      x += (vert[a + 1] - vert[b + 1]) * (vert[a + 2] + vert[b + 2]);
      y += (vert[a + 2] - vert[b + 2]) * (vert[a] + vert[b]);
      z += (vert[a] - vert[b]) * (vert[a + 1] + vert[b + 1]);
      cx += vert[a]; cy += vert[a + 1]; cz += vert[a + 2];
    }
    const l = Math.hypot(x, y, z);
    if (l < 1e-12) return null;
    const n = [x / l, y / l, z / l];
    const d = (n[0] * cx + n[1] * cy + n[2] * cz) / loop.length;
    let size = 0, flat = 0;
    for (const v of loop) {
      flat = Math.max(flat, Math.abs(n[0] * vert[v * 3] + n[1] * vert[v * 3 + 1] + n[2] * vert[v * 3 + 2] - d));
      size = Math.max(size, Math.hypot(vert[v * 3] - cx / loop.length, vert[v * 3 + 1] - cy / loop.length, vert[v * 3 + 2] - cz / loop.length));
    }
    return flat <= Math.max(1e-4, size * 1e-5) ? { n, d, area: l / 2 } : null;
  });
  // Group loops on the same plane (normals parallel either way round).
  for (let i = 0; i < loops.length; i++) {
    const p = planes[i];
    if (!p || used.has(i)) continue;
    const group = [i];
    for (let j = i + 1; j < loops.length; j++) {
      const q = planes[j];
      if (!q || used.has(j)) continue;
      const c = p.n[0] * q.n[0] + p.n[1] * q.n[1] + p.n[2] * q.n[2];
      if (Math.abs(Math.abs(c) - 1) > 1e-6) continue;
      if (Math.abs(q.d * Math.sign(c) - p.d) > 1e-4) continue;
      group.push(j);
    }
    if (group.length < 2) continue; // a lone loop is filled by the fan fill
    // 2D frame on the plane, oriented so the largest loop runs counter-clockwise.
    const outer = group.reduce((a, b) => (planes[b]!.area > planes[a]!.area ? b : a));
    const n = planes[outer]!.n;
    const u = Math.abs(n[0]) < 0.9 ? [0, -n[2], n[1]] : [n[2], 0, -n[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    const U = [u[0] / ul, u[1] / ul, u[2] / ul];
    const V = [n[1] * U[2] - n[2] * U[1], n[2] * U[0] - n[0] * U[2], n[0] * U[1] - n[1] * U[0]];
    const polys = group.map((li) => loops[li].map((v): [number, number] => {
      const x = vert[v * 3], y = vert[v * 3 + 1], z = vert[v * 3 + 2];
      return [x * U[0] + y * U[1] + z * U[2], x * V[0] + y * V[1] + z * V[2]];
    }));
    const index = group.flatMap((li) => loops[li]);
    let tris: Array<[number, number, number]>;
    try { tris = triangulate(polys, 1e-6); } catch { continue; }
    if (!tris.length) continue;
    // The new face must run along each loop in the loop's direction (opposite to the triangles beside it).
    const first = loops[outer];
    const pos = new Map<number, number>();
    index.forEach((v, k) => { if (!pos.has(v)) pos.set(v, k); });
    let agree = 0, disagree = 0;
    for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const va = index[p], vb = index[q];
      const ia = first.indexOf(va);
      if (ia < 0) continue;
      if (first[(ia + 1) % first.length] === vb) agree++;
      else if (first[(ia - 1 + first.length) % first.length] === vb) disagree++;
    }
    const flip = disagree > agree;
    for (const [a, b, c] of tris) {
      if (flip) out.push(index[a], index[c], index[b]);
      else out.push(index[a], index[b], index[c]);
    }
    for (const li of group) used.add(li);
    onFill(group.map((li) => loops[li]));
  }
  return used;
}

function areaOf(vert: ArrayLike<number>, tri: Uint32Array): number {
  let s = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i] * 3, b = tri[i + 1] * 3, c = tri[i + 2] * 3;
    const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2];
    const vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return s;
}

/** Area of a closed loop's best-fit surface (magnitude of its vector area). */
function loopArea(vert: ArrayLike<number>, loop: number[]): number {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
    x += vert[a + 1] * vert[b + 2] - vert[a + 2] * vert[b + 1];
    y += vert[a + 2] * vert[b] - vert[a] * vert[b + 2];
    z += vert[a] * vert[b + 1] - vert[a + 1] * vert[b];
  }
  return Math.hypot(x, y, z) / 2;
}

function perpendicular(e: number[]): number[] {
  const a = Math.abs(e[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = a[0] * e[0] + a[1] * e[1] + a[2] * e[2];
  const u = [a[0] - d * e[0], a[1] - d * e[1], a[2] - d * e[2]];
  const l = Math.hypot(u[0], u[1], u[2]);
  return [u[0] / l, u[1] / l, u[2] / l];
}

/** Signed volume of a closed triangle list (positive when triangles face outwards). */
export function signedVolume(vert: Float64Array, tri: Uint32Array): number {
  let v = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i] * 3, b = tri[i + 1] * 3, c = tri[i + 2] * 3;
    v += vert[a] * (vert[b + 1] * vert[c + 2] - vert[b + 2] * vert[c + 1])
      - vert[a + 1] * (vert[b] * vert[c + 2] - vert[b + 2] * vert[c])
      + vert[a + 2] * (vert[b] * vert[c + 1] - vert[b + 1] * vert[c]);
  }
  return v / 6;
}
