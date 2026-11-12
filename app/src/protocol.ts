// Messages between the page and the geometry worker.
import type { ImportReport } from '../../core/geometry.ts';
import type { FeatureManifest, Params, Setup, Target } from '../../feature-api/index.ts';

export type Vec3 = [number, number, number];
export interface Bed { w: number; d: number }

/** An edit as the worker needs it to build. */
export interface EditSpec { id: number; feature: string; target: Target; params: Params }

/** What a saved project carries besides the meshes. */
export interface ProjectData {
  formatVersion: 1;
  app: string;
  setup: Setup;
  edits: Array<{ feature: string; target: Omit<Target, 'tris'>; v: Params; born: Params; detected: Target['measure'] }>;
  defaults?: Record<string, Params>;
}

export type Request =
  | { type: 'manifests' }
  | { type: 'open'; name: string; bytes: ArrayBuffer; bed: Bed }
  | { type: 'choose'; index: number | 'all'; bed: Bed }
  | { type: 'layFlat'; normal: Vec3; bed: Bed }
  | { type: 'auto'; bed: Bed }
  | { type: 'turn'; quarterTurns: number; bed: Bed }
  | { type: 'place'; bed: Bed }
  | { type: 'setup'; setup: Setup }
  | { type: 'find' }
  | { type: 'compose'; edits: EditSpec[] }
  | { type: 'preview'; edits: EditSpec[] }
  | { type: 'export'; format: '3mf' | 'stl'; name: string; project: ProjectData };

/** Indexed geometry in bed coordinates. */
export interface PartMesh {
  vert: Float32Array;
  tri: Uint32Array;
  min: Vec3;
  max: Vec3;
  volume: number;
}

export interface ResultMesh extends PartMesh {
  /** Per triangle: the edit that made it, or -1 for the original part. */
  owner: Int32Array;
  /** Per triangle from the original part: its index in the part mesh, else -1. */
  baseFace: Int32Array;
}

export interface EditStatus { id: number; ok: boolean; error?: string; warnings: string[] }

export type Response =
  | { kind: 'manifests'; features: FeatureManifest[] }
  | { kind: 'part'; report: ImportReport; mesh: PartMesh; project?: ProjectData }
  | { kind: 'moved'; mesh: PartMesh; /** Column-major matrix taking old part coordinates to new ones. */ delta: number[] }
  | { kind: 'choose'; objects: Array<{ name: string; triangles: number }> }
  | { kind: 'refused'; report: ImportReport }
  | { kind: 'found'; targets: Record<string, Target[]>; errors: Record<string, string> }
  | { kind: 'composed'; result: ResultMesh; edits: EditStatus[] }
  | { kind: 'preview'; add: PartMesh | null; sub: PartMesh | null; warnings: string[] }
  | { kind: 'ok' }
  | { kind: 'file'; bytes: Uint8Array; name: string; mime: string };

export type WorkerMessage =
  | { id: number; ok: true; result: Response }
  | { id: number; ok: false; error: string }
  | { id: number; progress: string };
