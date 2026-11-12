// Messages between the page and the geometry worker.
import type { ImportReport } from '../../core/geometry.ts';

export type Vec3 = [number, number, number];
export interface Bed { w: number; d: number }

export type Request =
  | { type: 'open'; name: string; bytes: ArrayBuffer; bed: Bed }
  | { type: 'choose'; index: number | 'all'; bed: Bed }
  | { type: 'layFlat'; normal: Vec3; bed: Bed }
  | { type: 'auto'; bed: Bed }
  | { type: 'turn'; quarterTurns: number; bed: Bed }
  | { type: 'place'; bed: Bed }
  | { type: 'export'; format: '3mf' | 'stl'; name: string };

/** A part ready to draw: indexed geometry in bed coordinates. */
export interface PartMesh {
  vert: Float32Array;
  tri: Uint32Array;
  min: Vec3;
  max: Vec3;
  volume: number;
}

export type Response =
  | { kind: 'part'; report: ImportReport; mesh: PartMesh }
  | { kind: 'moved'; mesh: PartMesh }
  | { kind: 'choose'; objects: Array<{ name: string; triangles: number }> }
  | { kind: 'refused'; report: ImportReport }
  | { kind: 'file'; bytes: Uint8Array; name: string; mime: string };

export type WorkerMessage =
  | { id: number; ok: true; result: Response }
  | { id: number; ok: false; error: string }
  | { id: number; progress: string };
