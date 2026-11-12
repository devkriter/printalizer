// Which faces hang over air when printed, and how much of the part touches the bed.

export interface OverhangResult {
  /** 1 for each triangle that overhangs more than the limit. */
  flags: Uint8Array;
  /** Total area of those triangles, in mm². */
  area: number;
  /** Area of downward faces lying on the bed, in mm². */
  bedArea: number;
}

/**
 * A face overhangs when it leans further from vertical than `limitDeg` while facing down.
 * Faces lying on the bed (z within `bedTol` of `bedZ`) don't count: the bed holds them up.
 */
export function overhangs(vert: ArrayLike<number>, tri: ArrayLike<number>, limitDeg: number, bedZ = 0, bedTol = 0.01): OverhangResult {
  const nt = tri.length / 3;
  const flags = new Uint8Array(nt);
  const threshold = Math.sin((limitDeg * Math.PI) / 180);
  let area = 0, bedArea = 0;
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
    const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2];
    const vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l === 0) continue;
    const down = -nz / l; // 1 for a face looking straight down, 0 for a wall
    if (down <= threshold) continue;
    const onBed = Math.abs(vert[a + 2] - bedZ) < bedTol && Math.abs(vert[b + 2] - bedZ) < bedTol && Math.abs(vert[c + 2] - bedZ) < bedTol;
    if (onBed) { bedArea += l / 2; continue; }
    flags[t] = 1;
    area += l / 2;
  }
  return { flags, area, bedArea };
}
