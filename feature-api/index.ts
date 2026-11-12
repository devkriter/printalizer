// The Printalizer feature format, version 1.
//
// A feature never edits the mesh. It looks at the part (`find`) and, for each target the user
// applies it to, returns solids to add or subtract (`build`). The app does all cutting, which gives
// every feature preview, undo, re-apply and a closed result for free. Everything a feature returns
// is plain data, which keeps features simple to test and to review.
//
// A feature is one folder in features/ with an index.ts whose default export is defineFeature({...}).

export const FEATURE_API = 1;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** Polygons as Manifold uses them: outer outlines counter-clockwise, holes clockwise. */
export type Polygons = Vec2[][];

// ---------- settings ----------

export interface NumberParam {
  k: string;
  label: string;
  type: 'number';
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  /** Decimal places shown. */
  dp?: number;
  /** Only shown while another setting has this value. */
  showIf?: { k: string; eq: string | number };
}

export interface ChoiceParam {
  k: string;
  label: string;
  type: 'choice';
  options: string[];
  def: string;
  showIf?: { k: string; eq: string | number };
}

export type ParamSpec = NumberParam | ChoiceParam;
export type Params = Record<string, number | string>;

/** A value the feature measured on the part, which the user may correct. */
export type MeasureSpec =
  | { k: string; label: string; type: 'number'; min: number; max: number; step: number; unit?: string }
  | { k: string; label: string; type: 'choice'; options: string[] };
export type Measures = Record<string, number | string>;

// ---------- targets ----------

/** Something a feature can be applied to, as returned by find(). */
export interface TargetInput {
  /** A point on the target, used to keep edits attached when the part is turned. */
  anchor: Vec3;
  /** Triangles of the part (indices into ctx.part.tri) that show this target. */
  tris: number[];
  /** Values measured on the part. The user can correct them in the settings pane. */
  measure?: Measures;
  /** One line describing the target, e.g. "⌀6 × 28 mm hole". */
  detail: string;
  /** Anything else build() needs. Must be plain data (numbers, strings, arrays, objects). */
  data?: Record<string, unknown>;
}

export interface Target extends TargetInput {
  measure: Measures;
  data: Record<string, unknown>;
}

// ---------- solids (plain data) ----------

export type Solid =
  | { type: 'box'; min: Vec3; max: Vec3 }
  | { type: 'cylinder'; radius: number; height: number; segments?: number; center?: boolean }
  /** Polygons in the XY plane, extruded along +Z from 0 to height, optionally twisted (degrees, counter-clockwise). */
  | { type: 'extrude'; polygons: Polygons; height: number; twist?: number; divisions?: number }
  /** Column-major 4x4 affine matrix. */
  | { type: 'transform'; matrix: number[]; solid: Solid }
  | { type: 'union'; solids: Solid[] }
  | { type: 'difference'; solids: Solid[] }
  | { type: 'intersection'; solids: Solid[] }
  | { type: 'mesh'; vert: number[]; tri: number[] };

export interface Op { op: 'add' | 'subtract'; solid: Solid }

// ---------- context given to find() and build() ----------

export interface Setup { layer: number; nozzle: number; overhang: number; bedW: number; bedD: number }

export interface Cylinder {
  kind: 'hole' | 'boss';
  axis: Vec3;
  center: Vec3;
  radius: number;
  length: number;
  coverage: number;
  segments: number;
  fitError: number;
  orientation: 'horizontal' | 'vertical' | 'angled';
  triangles: number[];
}

export interface Thread {
  kind: 'internal' | 'external';
  axis: Vec3;
  /** Point on the axis at the start of the thread; the thread runs `length` along `axis` from here. */
  start: Vec3;
  length: number;
  majorD: number;
  minorD: number;
  pitch: number;
  /** Nearest ISO metric size, e.g. "M6". */
  size: string;
  hand: 'right' | 'left';
  triangles: number[];
}

export interface OverhangRegion { tris: number[]; area: number; centroid: Vec3; zMin: number; zMax: number; outline: Polygons; extent: number }

export interface Context {
  /** The part as it sits on the bed (Z up, bed at z = 0), before any edits. */
  part: { vert: Float64Array; tri: Uint32Array; min: Vec3; max: Vec3 };
  setup: Setup;
  /** Shared finders, computed once per part and orientation. */
  find: {
    cylinders(): Cylinder[];
    threads(): Thread[];
    overhangs(limitDeg: number): OverhangRegion[];
    bedFaces(): { tris: number[]; area: number };
  };
  /** Cross-section of the part at height z. */
  section(z: number): Polygons;
  /** 2D operations on polygons. */
  shapes: {
    offset(p: Polygons, delta: number, join?: 'Round' | 'Square' | 'Miter'): Polygons;
    union(...p: Polygons[]): Polygons;
    difference(a: Polygons, ...b: Polygons[]): Polygons;
    intersection(a: Polygons, b: Polygons): Polygons;
    area(p: Polygons): number;
    hull(p: Polygons): Polygons;
  };
  /** Builders for plain-data solids. */
  solids: typeof solids;
  /** Report something risky about this edit; shown as a mark on its chip. */
  warn(message: string): void;
}

// ---------- the feature itself ----------

export interface FeatureDef {
  api: 1;
  id: string;
  name: string;
  /** Short label under the rail icon. Defaults to name. */
  label?: string;
  /** "Tented hole" — one edit. */
  single: string;
  /** "tented holes" — several edits. */
  plural: string;
  /** What it applies to: "hole". Used in "No hole found here". */
  noun: string;
  version: string;
  /** One sentence for the features list. */
  summary: string;
  /** Inner markup of a 24×24 SVG icon drawn with strokes in currentColor. */
  icon: string;
  /** Default keyboard shortcut. */
  key?: string;
  params: ParamSpec[];
  measures?: MeasureSpec[];
  /** Label in the edit strip and found list. {k} is replaced with a measure or setting value. */
  chip: string;
  /** Does this feature depend on the layer height? Shown in the export summary. */
  usesLayerHeight?: boolean;
  /** The part has at most one target (like the edge on the bed), so an edit follows it when the part is turned. */
  oneTarget?: boolean;
  find(ctx: Context): TargetInput[];
  build(target: Target, params: Params, ctx: Context): Op[];
}

/** Identity function that type-checks a feature. */
export function defineFeature(def: FeatureDef): FeatureDef {
  return def;
}

/** The part of a feature the interface needs: plain data, safe to pass between threads. */
export type FeatureManifest = Omit<FeatureDef, 'find' | 'build'>;

export function manifestOf(def: FeatureDef): FeatureManifest {
  const { find: _f, build: _b, ...rest } = def;
  return JSON.parse(JSON.stringify(rest)) as FeatureManifest;
}

// ---------- builders ----------

export const add = (solid: Solid): Op => ({ op: 'add', solid });
export const subtract = (solid: Solid): Op => ({ op: 'subtract', solid });

export const number = (k: string, label: string, def: number, o: { min: number; max: number; step: number; unit?: string; dp?: number; showIf?: NumberParam['showIf'] }): NumberParam =>
  ({ k, label, type: 'number', def, ...o });
export const choice = (k: string, label: string, options: string[], def: string, showIf?: ChoiceParam['showIf']): ChoiceParam =>
  ({ k, label, type: 'choice', options, def, ...(showIf ? { showIf } : {}) });

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export const solids = {
  box: (min: Vec3, max: Vec3): Solid => ({ type: 'box', min, max }),
  cylinder: (radius: number, height: number, o: { segments?: number; center?: boolean } = {}): Solid => ({ type: 'cylinder', radius, height, ...o }),
  extrude: (polygons: Polygons, height: number, o: { twist?: number; divisions?: number } = {}): Solid => ({ type: 'extrude', polygons, height, ...o }),
  union: (...s: Solid[]): Solid => ({ type: 'union', solids: s }),
  difference: (...s: Solid[]): Solid => ({ type: 'difference', solids: s }),
  intersection: (...s: Solid[]): Solid => ({ type: 'intersection', solids: s }),
  translate: (s: Solid, v: Vec3): Solid => ({ type: 'transform', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1], solid: s }),
  /**
   * Place a solid built in its own frame: local X, Y and Z map to the given unit vectors, and the
   * local origin to `origin`. Use it to build along +Z and then point Z along a hole's axis.
   */
  place: (s: Solid, origin: Vec3, x: Vec3, y: Vec3, z: Vec3): Solid => ({
    type: 'transform',
    matrix: [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, origin[0], origin[1], origin[2], 1],
    solid: s,
  }),
  identity: IDENTITY,
};

// ---------- small vector helpers features tend to need ----------

export const vec = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
};

/** True when a cylinder lies on a thread's axis: the thread's crest and root flats, not a real hole. */
export function onThread(c: Cylinder, threads: Thread[]): boolean {
  return threads.some((t) => {
    if (Math.abs(vec.dot(c.axis, t.axis)) < 0.999) return false;
    const d = vec.sub(c.center, t.start);
    const along = vec.dot(d, t.axis);
    const off = vec.len(vec.sub(d, vec.scale(t.axis, along)));
    return off < 0.3 && along > -c.length / 2 - 0.5 && along < t.length + c.length / 2 + 0.5;
  });
}

/** Fill a chip template like "⌀{d}" from measures and settings. Numbers show up to one decimal unless a setting says otherwise. */
export function formatChip(template: string, measure: Measures, params: Params, specs: ParamSpec[] = []): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = k in measure ? measure[k] : params[k];
    if (typeof v !== 'number') return v == null ? '' : String(v);
    const spec = specs.find((p) => p.k === k);
    const dp = spec && spec.type === 'number' && spec.dp != null ? spec.dp : 1;
    const s = v.toFixed(dp);
    return spec && spec.type === 'number' && spec.dp != null ? s : s.replace(/\.0+$/, '');
  });
}
