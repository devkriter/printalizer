// Helpers for tests: build shapes with Manifold and turn them into STL bytes or triangle soups.

import type { Manifold } from 'manifold-3d';
import { meshOf } from './geometry.ts';
import { writeSTL } from './stl.ts';

export function stlOf(m: Manifold): Uint8Array {
  const { vert, tri } = meshOf(m);
  return writeSTL(vert, tri);
}

/** STL bytes from several solids written into one file without merging them. */
export function stlOfShells(ms: Manifold[]): Uint8Array {
  const verts: number[] = [];
  const tris: number[] = [];
  for (const m of ms) {
    const { vert, tri } = meshOf(m);
    const base = verts.length / 3;
    verts.push(...vert);
    for (const i of tri) tris.push(i + base);
  }
  return writeSTL(verts, tris);
}

/** Edit an STL's triangle list: callback receives [a,b,c] index triples and returns the new list. */
export function editTris(m: Manifold, edit: (tris: number[][]) => number[][]): Uint8Array {
  const { vert, tri } = meshOf(m);
  const list: number[][] = [];
  for (let i = 0; i < tri.length; i += 3) list.push([tri[i], tri[i + 1], tri[i + 2]]);
  return writeSTL(vert, edit(list).flat());
}
