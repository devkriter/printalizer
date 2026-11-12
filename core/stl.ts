// Reading and writing STL files (binary and ASCII).

export interface TriangleSoup {
  /** 9 floats per triangle: x0 y0 z0 x1 y1 z1 x2 y2 z2. */
  positions: Float32Array;
  triCount: number;
  format: 'binary' | 'ascii';
  /** Problems noticed while reading, for example a truncated file. */
  warnings: string[];
}

function looksAscii(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return true;
  const head = new TextDecoder().decode(bytes.subarray(0, 5)).toLowerCase();
  if (head !== 'solid') return false;
  // Many binary files also start with "solid" in their header. Trust the size field when it matches.
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
  if (84 + count * 50 === bytes.length) return false;
  // Look for the ASCII keyword near the start.
  const probe = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 1024))).toLowerCase();
  return probe.includes('facet') || probe.includes('endsolid');
}

export function parseSTL(input: ArrayBuffer | Uint8Array): TriangleSoup {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return looksAscii(bytes) ? parseAscii(bytes) : parseBinary(bytes);
}

function parseBinary(bytes: Uint8Array): TriangleSoup {
  const warnings: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let count = view.getUint32(80, true);
  const fits = Math.floor((bytes.length - 84) / 50);
  if (count > fits) {
    warnings.push(`File says ${count} triangles but only ${fits} fit. Read ${fits}.`);
    count = fits;
  } else if (count < fits) {
    warnings.push(`${fits - count} extra triangle records after the stated count were ignored.`);
  }
  const positions = new Float32Array(count * 9);
  let o = 84;
  for (let t = 0; t < count; t++) {
    o += 12; // stored normal is ignored, it is recomputed from winding
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(o + k * 4, true);
    o += 38;
  }
  return { positions, triCount: count, format: 'binary', warnings };
}

function parseAscii(bytes: Uint8Array): TriangleSoup {
  const text = new TextDecoder().decode(bytes);
  const warnings: string[] = [];
  const out: number[] = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  if (out.length % 9 !== 0) {
    warnings.push('Vertex count is not a multiple of 3. The last partial triangle was dropped.');
    out.length -= out.length % 9;
  }
  return { positions: new Float32Array(out), triCount: out.length / 9, format: 'ascii', warnings };
}

/** Binary STL from indexed geometry. */
export function writeSTL(vert: ArrayLike<number>, tri: ArrayLike<number>, header = 'Printalizer'): Uint8Array {
  const n = tri.length / 3;
  const buf = new Uint8Array(84 + n * 50);
  const view = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode(header.slice(0, 79)), 0);
  view.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
    const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2];
    const vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const i of [a, b, c]) {
      view.setFloat32(o, vert[i], true); view.setFloat32(o + 4, vert[i + 1], true); view.setFloat32(o + 8, vert[i + 2], true);
      o += 12;
    }
    o += 2;
  }
  return buf;
}
