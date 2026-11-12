// Application state and every action on it. Components read the state and call these actions;
// the 3D view follows the state through syncView().
import { useSyncExternalStore } from 'react';
import type { ImportReport } from '../../core/geometry.ts';
import { overhangs } from '../../core/overhang.ts';
import { formatChip } from '../../feature-api/index.ts';
import type { FeatureManifest, Measures, Params, Setup, Target } from '../../feature-api/index.ts';
import { ask } from './client.ts';
import { actionsFor, loadKeys, read, write } from './prefs.ts';
import type { EditSpec, EditStatus, PartMesh, ProjectData, ResultMesh, Vec3 } from './protocol.ts';
import { PRINTERS, loadSetup, saveSetup } from './setup.ts';
import type { Item, Viewer } from './viewer.ts';

export type Phase = 'empty' | 'busy' | 'choose' | 'refused' | 'lay' | 'edit';

export interface Edit {
  id: number;
  feature: string;
  target: Target;
  /** The edit's own settings. */
  v: Params;
  /** The tool defaults when it was made; it follows defaults while v still equals these. */
  born: Params;
  /** Measured values, as corrected by the user. */
  meas: Measures;
  detected: Measures;
  /** No longer matches anything after the part was turned. */
  stale?: boolean;
}

export interface FoundTarget extends Target { key: string; feature: string }

export interface Draft { tool: string | null; v: Params; meas: Record<string, Measures> }

export interface State {
  phase: Phase;
  busyText: string;
  fileName: string;
  report: ImportReport | null;
  choices: Array<{ name: string; triangles: number }>;
  original: PartMesh | null;
  result: ResultMesh | null;
  overhangInfo: { flags: Uint8Array; area: number; bedArea: number } | null;
  features: FeatureManifest[];
  found: Record<string, FoundTarget[]>;
  findErrors: Record<string, string>;
  finding: boolean;
  composing: boolean;
  edits: Edit[];
  nextId: number;
  status: Record<number, EditStatus>;
  factory: Record<string, Params>;
  defaults: Record<string, Params>;
  sel: number[];
  psel: string[];
  draft: Draft | null;
  tool: string | null;
  eraserHeld: boolean;
  defOpen: string | null;
  hover: Item | null;
  tip: { x: number; y: number; text: string } | null;
  xray: boolean;
  showOverhang: boolean;
  compare: boolean;
  undo: string[];
  redo: string[];
  setup: Setup & { printer: string };
  minimal: boolean;
  hints: boolean;
  keys: Record<string, string>;
  panel: null | 'settings' | 'export' | 'setup' | 'tour';
  toast: string;
  error: string;
}

const initialSetup = loadSetup();

let state: State = {
  phase: 'empty', busyText: '', fileName: '', report: null, choices: [], original: null, result: null, overhangInfo: null,
  features: [], found: {}, findErrors: {}, finding: false, composing: false, edits: [], nextId: 1, status: {},
  factory: {}, defaults: {}, sel: [], psel: [], draft: null, tool: null, eraserHeld: false, defOpen: null,
  hover: null, tip: null, xray: false, showOverhang: true, compare: false, undo: [], redo: [],
  setup: { printer: initialSetup.printer, layer: initialSetup.layer, nozzle: initialSetup.nozzle, overhang: initialSetup.overhang, bedW: initialSetup.bedW, bedD: initialSetup.bedD },
  minimal: read('printalizer.minimal') === '1', hints: read('printalizer.hints') !== '0', keys: {},
  panel: null, toast: '', error: '',
};

const listeners = new Set<() => void>();
export function get() { return state; }
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
export function useAppState(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

let viewer: Viewer | null = null;
export function attachViewer(v: Viewer) {
  viewer = v;
  v.onPickFace = (normal) => { void move({ type: 'layFlat', normal, bed: bed() }); };
  v.onHover = onCanvasHover;
  v.onClick = onCanvasClick;
  v.setBed(state.setup.bedW, state.setup.bedD);
  listeners.add(syncView);
}

// ---------- helpers ----------

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const eq = (a: Params, b: Params) => { for (const k in a) if (a[k] !== b[k]) return false; for (const k in b) if (!(k in a)) return false; return true; };
const bed = () => ({ w: state.setup.bedW, d: state.setup.bedD });
export const feature = (id: string) => state.features.find((f) => f.id === id) ?? null;
export const editById = (id: number) => state.edits.find((e) => e.id === id) ?? null;
export const targetByKey = (key: string): FoundTarget | null => { const f = key.slice(0, key.lastIndexOf(':')); return state.found[f]?.find((t) => t.key === key) ?? null; };

let toastTimer = 0;
export function toast(msg: string) {
  set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => set({ toast: '' }), 2200);
}

export function chipOf(featureId: string, meas: Measures, v: Params): string {
  const f = feature(featureId);
  return f ? formatChip(f.chip, meas, v, f.params) : '';
}
export function editChip(e: Edit) { return chipOf(e.feature, e.meas, e.v); }
export function targetChip(t: FoundTarget) {
  const draftV = state.draft && state.psel.includes(t.key) && state.draft.tool === t.feature ? state.draft.v : state.defaults[t.feature] ?? {};
  const m = state.draft?.meas[t.key] ?? t.measure;
  return chipOf(t.feature, m, draftV);
}

/** True when an edit of this feature already sits on the target. */
function applied(t: FoundTarget): boolean {
  return state.edits.some((e) => !e.stale && e.feature === t.feature && dist(e.target.anchor, t.anchor) < 0.5);
}
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Found targets not yet used, for the current tool or all tools. */
export function foundList(): FoundTarget[] {
  if (state.phase !== 'edit') return [];
  const ids = state.tool && state.tool !== 'eraser' ? [state.tool] : state.features.map((f) => f.id);
  return ids.flatMap((id) => (state.found[id] ?? []).filter((t) => !applied(t)));
}

export function eraserMode() { return state.phase === 'edit' && (state.tool === 'eraser' || state.eraserHeld); }

// ---------- the view follows the state ----------

let lastLookKey = '';
function syncView() {
  if (!viewer) return;
  const s = state;
  const active = new Set(eraserMode() ? [] : foundList().map((t) => t.key));
  const key = [s.phase, [...active].join(), s.psel.join(), s.sel.join(), JSON.stringify(s.hover), s.showOverhang, s.overhangInfo ? 1 : 0, s.tool, s.eraserHeld, s.result ? s.result.tri.length : 0].join('|');
  if (key === lastLookKey) return;
  lastLookKey = key;
  viewer.setLook({
    mode: s.phase === 'lay' ? 'lay' : 'edit',
    active,
    picked: new Set(s.psel),
    selected: new Set(s.sel),
    hover: s.hover,
    overhang: s.showOverhang ? s.overhangInfo?.flags ?? null : null,
    eraser: eraserMode(),
  });
}

// ---------- undo ----------

const snap = () => JSON.stringify({ edits: state.edits, defaults: state.defaults, nextId: state.nextId, sel: state.sel });
function push() { set({ undo: [...state.undo.slice(-79), snap()], redo: [] }); }
function restore(s: string) {
  const o = JSON.parse(s) as Pick<State, 'edits' | 'defaults' | 'nextId' | 'sel'>;
  set({ edits: o.edits, defaults: o.defaults, nextId: o.nextId, sel: o.sel.filter((id) => o.edits.some((e) => e.id === id)), psel: [], draft: null, hover: null });
  saveDefaults();
  scheduleCompose(0);
}
export function undo() { if (!state.undo.length) return; const s = state.undo[state.undo.length - 1]; set({ redo: [...state.redo, snap()], undo: state.undo.slice(0, -1) }); restore(s); }
export function redo() { if (!state.redo.length) return; const s = state.redo[state.redo.length - 1]; set({ undo: [...state.undo, snap()], redo: state.redo.slice(0, -1) }); restore(s); }

// ---------- starting up ----------

export async function init() {
  const res = await ask({ type: 'manifests' });
  if (res.kind !== 'manifests') return;
  setFeatures(res.features);
  // Feature files were removed; forget any saved by an earlier version.
  try { localStorage.removeItem('printalizer.featureFiles'); } catch { /* storage unavailable */ }
  await ask({ type: 'setup', setup: plainSetup() });
}

function setFeatures(features: FeatureManifest[]) {
  const factory: Record<string, Params> = {};
  for (const f of features) factory[f.id] = Object.fromEntries(f.params.map((p) => [p.k, p.def]));
  let saved: Record<string, Params> = {};
  try { saved = JSON.parse(read(defaultsKey()) ?? '{}') as Record<string, Params>; } catch { /* ignore */ }
  const defaults: Record<string, Params> = {};
  for (const f of features) defaults[f.id] = { ...factory[f.id], ...(state.defaults[f.id] ?? saved[f.id] ?? {}) };
  set({ features, factory, defaults, keys: loadKeys(actionsFor(features)) });
}

const plainSetup = (): Setup => ({ layer: state.setup.layer, nozzle: state.setup.nozzle, overhang: state.setup.overhang, bedW: state.setup.bedW, bedD: state.setup.bedD });
/** Tool defaults are remembered per print setup. */
const defaultsKey = () => `printalizer.defaults.${state.setup.printer}.${state.setup.nozzle}.${state.setup.layer}`;
function saveDefaults() { write(defaultsKey(), JSON.stringify(state.defaults)); }

// ---------- opening files ----------

export async function openFile(file: File) {
  viewer?.clear();
  set({ phase: 'busy', busyText: 'Reading', fileName: file.name, report: null, original: null, result: null, overhangInfo: null, edits: [], found: {}, sel: [], psel: [], draft: null, tool: null, undo: [], redo: [], status: {}, error: '', hover: null, nextId: 1 });
  const bytes = await file.arrayBuffer();
  try {
    const res = await ask({ type: 'open', name: file.name, bytes, bed: bed() }, (t) => set({ busyText: t }), [bytes]);
    await handleOpen(res);
  } catch (e) {
    set({ phase: 'empty', error: (e as Error).message });
  }
}

async function handleOpen(res: Awaited<ReturnType<typeof ask>>) {
  if (res.kind === 'choose') { set({ phase: 'choose', choices: res.objects }); return; }
  if (res.kind === 'refused') { set({ phase: 'refused', report: res.report }); return; }
  if (res.kind !== 'part') return;
  set({ report: res.report });
  showPart(res.mesh, true);
  if (res.project) {
    // A saved project: restore its setup, defaults and edits, and go straight to editing.
    const p = res.project;
    if (p.setup) updateSetup({ ...p.setup }, false);
    const readable = p.edits.filter((e) => e && feature(e.feature) && e.target?.anchor && e.v && e.born);
    const edits: Edit[] = readable.map((e, i) => ({
      id: i + 1, feature: e.feature, target: { ...e.target, measure: e.target.measure ?? {}, data: (e.target as Partial<Target>).data ?? {}, tris: [] } as Target, v: e.v, born: e.born, meas: e.target.measure ?? {}, detected: e.detected ?? e.target.measure ?? {},
    }));
    if (p.defaults) set({ defaults: { ...state.defaults, ...p.defaults } });
    const missing = p.edits.length - edits.length;
    set({ edits, nextId: edits.length + 1, phase: 'edit' });
    if (missing) toast(`${missing} edit${missing === 1 ? '' : 's'} need a feature that isn't loaded`);
    await runFind();
    scheduleCompose(0);
    return;
  }
  set({ phase: 'lay' });
}

export async function choose(index: number | 'all') {
  set({ phase: 'busy', busyText: 'Repairing' });
  try { await handleOpen(await ask({ type: 'choose', index, bed: bed() }, (t) => set({ busyText: t }))); }
  catch (e) { set({ phase: 'empty', error: (e as Error).message }); }
}

function showPart(mesh: PartMesh, refit: boolean) {
  const nt = mesh.tri.length / 3;
  const owner = new Int32Array(nt).fill(-1);
  const baseFace = new Int32Array(nt).map((_, i) => i);
  const result: ResultMesh = { ...mesh, owner, baseFace };
  set({ original: mesh });
  viewer?.setOriginal(mesh);
  setResult(result, refit);
}

function setResult(r: ResultMesh, refit = false) {
  const o = overhangs(r.vert, r.tri, state.setup.overhang);
  set({ result: r, overhangInfo: o });
  viewer?.setResult(r, refit);
  lastLookKey = '';
  syncView();
}

// ---------- laying flat ----------

async function move(req: Parameters<typeof ask>[0]) {
  try {
    const res = await ask(req);
    if (res.kind !== 'moved') return;
    showPart(res.mesh, req.type !== 'place');
    // Carry edits along with the part, then re-attach them to what's found in the new position.
    if (state.edits.length) {
      const M = res.delta;
      const tx = (p: Vec3): Vec3 => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
      set({ edits: state.edits.map((e) => ({ ...e, target: { ...e.target, anchor: tx(e.target.anchor) } })) });
    }
    set({ found: {} });
    if (state.phase === 'edit' || state.edits.length) { await runFind(); scheduleCompose(0); }
  } catch (e) { toast((e as Error).message); }
}
export const layAuto = () => move({ type: 'auto', bed: bed() });
export const layTurn = () => move({ type: 'turn', quarterTurns: 1, bed: bed() });
export async function continueToEdit() {
  set({ phase: 'edit', tool: null, sel: [], psel: [], draft: null });
  if (!Object.keys(state.found).length) await runFind();
}
export function layAgain() { set({ phase: 'lay', tool: null, sel: [], psel: [], draft: null, defOpen: null, xray: false, hover: null, tip: null }); viewer?.setXray(false); viewer?.clearPreview(); }

// ---------- finding ----------

export async function runFind() {
  set({ finding: true });
  try {
    const res = await ask({ type: 'find' }, (t) => set({ busyText: t }));
    if (res.kind !== 'found') return;
    const found: Record<string, FoundTarget[]> = {};
    for (const [id, list] of Object.entries(res.targets as Record<string, Target[]>)) found[id] = list.map((t, i) => ({ ...t, key: `${id}:${i}`, feature: id }));
    viewer?.setTargets(Object.values(found).flat().map((t) => ({ key: t.key, tris: t.tris })), state.original ? state.original.tri.length / 3 : 0);
    // Re-attach edits: each to the nearest target of its feature at the same place.
    const edits = state.edits.map((e) => {
      let best: FoundTarget | null = null, bd = 0.5;
      for (const t of found[e.feature] ?? []) { const d = dist(t.anchor, e.target.anchor); if (d < bd) { bd = d; best = t; } }
      if (!best && feature(e.feature)?.oneTarget && found[e.feature]?.length === 1) best = found[e.feature][0];
      if (!best) return { ...e, stale: true };
      const { key: _k, feature: _f, ...target } = best;
      return { ...e, stale: false, target: { ...target, tris: [] as number[], measure: e.meas } };
    });
    set({ found, findErrors: res.errors, edits });
  } catch (e) {
    toast((e as Error).message);
  } finally {
    set({ finding: false });
  }
}

// ---------- making the result ----------

let composeTimer = 0;
let composeSeq = 0;
export function scheduleCompose(delay = 0) {
  clearTimeout(composeTimer);
  composeTimer = window.setTimeout(() => void compose(), delay);
}

const specOf = (e: Edit): EditSpec => ({ id: e.id, feature: e.feature, target: { ...e.target, measure: e.meas }, params: e.v });

async function compose() {
  if (!state.original) return;
  const seq = ++composeSeq;
  const live = state.edits.filter((e) => !e.stale);
  set({ composing: true });
  try {
    const res = await ask({ type: 'compose', edits: live.map(specOf) });
    if (seq !== composeSeq || res.kind !== 'composed') return;
    const status: Record<number, EditStatus> = {};
    for (const s of res.edits) status[s.id] = s;
    set({ status });
    viewer?.clearPreview();
    setResult(res.result);
  } catch (e) {
    toast((e as Error).message);
  } finally {
    if (seq === composeSeq) set({ composing: false });
  }
}

let previewSeq = 0;
async function preview(specs: EditSpec[]) {
  const seq = ++previewSeq;
  try {
    const res = await ask({ type: 'preview', edits: specs });
    if (seq !== previewSeq || res.kind !== 'preview') return;
    viewer?.setPreview(res.add, res.sub);
  } catch { /* previews are best effort */ }
}

let draftIds = -1;
function previewDraft() {
  const d = state.draft;
  if (!d || !state.psel.length) { viewer?.clearPreview(); return; }
  const specs: EditSpec[] = [];
  for (const key of state.psel) {
    const t = targetByKey(key);
    if (!t) continue;
    const v = d.tool === t.feature ? d.v : state.defaults[t.feature];
    const { key: _k, feature: _f, ...target } = t;
    specs.push({ id: draftIds--, feature: t.feature, target: { ...target, measure: d.meas[key] ?? t.measure }, params: v });
  }
  void preview(specs);
}

// ---------- tools and targets ----------

export function selectTool(id: string | null) {
  const tool = state.tool === id ? null : id;
  set({ tool, sel: [], psel: [], draft: null, tip: null, defOpen: null });
  viewer?.clearPreview();
}

function newEdit(t: FoundTarget, v?: Params, meas?: Measures): Edit {
  const d = clone(state.defaults[t.feature]);
  const { key: _k, feature: _f, ...target } = t;
  const e: Edit = { id: state.nextId, feature: t.feature, target: { ...target, tris: [] }, v: v ? clone(v) : d, born: d, meas: clone(meas ?? t.measure), detected: clone(t.measure) };
  state = { ...state, nextId: state.nextId + 1 };
  return e;
}

/** Applying never opens the edit's settings; clicking an applied edit does. */
export function applyTargets(keys: string[]) {
  const ts = keys.map(targetByKey).filter((t): t is FoundTarget => !!t && !applied(t));
  if (!ts.length) return;
  push();
  const added = ts.map((t) => newEdit(t));
  set({ edits: [...state.edits, ...added], psel: state.psel.filter((k) => !keys.includes(k)), hover: null, tip: null });
  scheduleCompose(0);
}

function matching(t: FoundTarget): FoundTarget[] {
  const c = targetChip(t);
  return foundList().filter((g) => g.feature === t.feature && targetChip(g) === c);
}

/** With no tool picked, clicking a found target opens its settings with Apply underneath. */
function pickFound(t: FoundTarget, mods: { shift: boolean; alt: boolean }) {
  const keys = mods.alt ? matching(t).map((g) => g.key) : [t.key];
  let psel: string[];
  if (mods.shift) {
    const on = state.psel.includes(t.key);
    psel = on && !mods.alt ? state.psel.filter((k) => k !== t.key) : [...state.psel, ...keys.filter((k) => !state.psel.includes(k))];
  } else psel = keys;
  set({ sel: [], psel });
  syncDraft();
}

function syncDraft() {
  const psel = state.psel.filter((k) => { const t = targetByKey(k); return t && !applied(t); });
  if (!psel.length) { set({ psel: [], draft: null }); viewer?.clearPreview(); return; }
  const tools = [...new Set(psel.map((k) => targetByKey(k)!.feature))];
  const tool = tools.length === 1 ? tools[0] : null;
  let draft = state.draft;
  if (!draft || draft.tool !== tool) draft = { tool, v: tool ? clone(state.defaults[tool]) : {}, meas: {} };
  const meas = { ...draft.meas };
  for (const k of psel) if (!meas[k]) meas[k] = clone(targetByKey(k)!.measure);
  set({ psel, draft: { ...draft, meas } });
  previewDraft();
}

export function applyPicked() {
  const d = state.draft;
  const ts = state.psel.map(targetByKey).filter((t): t is FoundTarget => !!t && !applied(t));
  set({ psel: [], draft: null });
  viewer?.clearPreview();
  if (!ts.length) return;
  push();
  const added = ts.map((t) => newEdit(t, d && d.tool === t.feature ? d.v : undefined, d?.meas[t.key]));
  set({ edits: [...state.edits, ...added], hover: null });
  scheduleCompose(0);
}

export function setDraftParam(k: string, v: number | string, final: boolean) {
  if (!state.draft) return;
  set({ draft: { ...state.draft, v: { ...state.draft.v, [k]: v } } });
  void final; // drafts preview live; nothing is cut until Apply
  previewDraft();
}
export function setDraftMeasure(key: string, k: string, v: number | string) {
  if (!state.draft) return;
  set({ draft: { ...state.draft, meas: { ...state.draft.meas, [key]: { ...state.draft.meas[key], [k]: v } } } });
  previewDraft();
}

export function removeIds(ids: number[]) {
  if (!ids.length) return;
  push();
  set({ edits: state.edits.filter((e) => !ids.includes(e.id)), sel: state.sel.filter((x) => !ids.includes(x)), hover: null, tip: null });
  scheduleCompose(0);
}
export const removeSelected = () => removeIds([...state.sel]);

export function selectEdit(id: number, mods: { shift?: boolean } = {}, face = false) {
  set({ psel: [], draft: null });
  viewer?.clearPreview();
  if (mods.shift) set({ sel: state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id] });
  else {
    set({ sel: [id] });
    if (face) faceEdit(id);
  }
}

export function faceEdit(id: number) {
  const d = viewer?.directionOf({ kind: 'edit', id });
  const e = editById(id);
  if (d) viewer?.faceTo(d.point, d.dir);
  else if (e) viewer?.faceTo(e.target.anchor, [0.4, -1, 0.6]);
}

// ---------- editing settings ----------

let pushedFor = '';
/** Change a setting on the selected edits. While dragging (final = false) a preview shows; the cut follows. */
export function setEditParam(ids: number[], k: string, v: number | string, final: boolean) {
  const tag = `e:${ids.join(',')}:${k}`;
  if (pushedFor !== tag) { push(); pushedFor = tag; }
  if (final) pushedFor = '';
  set({ edits: state.edits.map((e) => (ids.includes(e.id) ? { ...e, v: { ...e.v, [k]: v } } : e)) });
  if (final) scheduleCompose(0);
  else {
    const specs = state.edits.filter((e) => ids.includes(e.id) && !e.stale).map(specOf);
    void preview(specs);
    scheduleCompose(350);
  }
}

export function resetEditParam(ids: number[], k: string) {
  push();
  set({ edits: state.edits.map((e) => (ids.includes(e.id) ? { ...e, v: { ...e.v, [k]: state.defaults[e.feature][k] } } : e)) });
  scheduleCompose(0);
}

export function setEditMeasure(id: number, k: string, v: number | string) {
  push();
  set({ edits: state.edits.map((e) => (e.id === id ? { ...e, meas: { ...e.meas, [k]: v } } : e)) });
  scheduleCompose(0);
}

/**
 * Tool defaults. Edits made with the old default follow the new one (as long as the user hasn't
 * changed them), because each edit stores the defaults it was born with.
 */
export function setDefault(featureId: string, k: string, v: number | string, final: boolean) {
  const tag = `d:${featureId}:${k}`;
  if (pushedFor !== tag) { push(); pushedFor = tag; }
  if (final) pushedFor = '';
  const before = state.defaults[featureId];
  const after = { ...before, [k]: v };
  set({
    defaults: { ...state.defaults, [featureId]: after },
    // Edits still following defaults move with them.
    edits: state.edits.map((e) => (e.feature === featureId && eq(e.v, e.born) && eq(e.born, before) ? { ...e, v: clone(after), born: clone(after) } : e)),
  });
  saveDefaults();
  scheduleCompose(final ? 0 : 350);
}

export function resetDefaults(featureId: string) {
  push();
  const before = state.defaults[featureId];
  const after = clone(state.factory[featureId]);
  set({
    defaults: { ...state.defaults, [featureId]: after },
    edits: state.edits.map((e) => (e.feature === featureId && eq(e.v, e.born) && eq(e.born, before) ? { ...e, v: clone(after), born: clone(after) } : e)),
  });
  saveDefaults();
  scheduleCompose(0);
}

/** Edits the user never adjusted but that were made with older defaults. */
export function unchanged(featureId: string): Edit[] {
  const d = state.defaults[featureId];
  return state.edits.filter((e) => e.feature === featureId && eq(e.v, e.born) && !eq(e.v, d));
}
export function applyToUnchanged(featureId: string) {
  const list = unchanged(featureId).map((e) => e.id);
  if (!list.length) return;
  push();
  const d = state.defaults[featureId];
  set({ edits: state.edits.map((e) => (list.includes(e.id) ? { ...e, v: clone(d), born: clone(d) } : e)) });
  scheduleCompose(0);
}

export const setDefOpen = (id: string | null) => set({ defOpen: id });

// ---------- the canvas ----------

function onCanvasHover(item: Item | null, x: number, y: number) {
  const s = state;
  let hover: Item | null = item && item.kind !== 'part' ? item : null;
  if (hover?.kind === 'target' && eraserMode()) hover = null;
  let text = '';
  if (hover?.kind === 'edit') {
    const e = editById(hover.id);
    const f = e && feature(e.feature);
    if (e && f) text = eraserMode() ? `Remove ${f.single.toLowerCase()}` : `${f.single} · ${editChip(e)}`;
  } else if (hover?.kind === 'target') {
    const t = targetByKey(hover.key);
    const f = t && feature(t.feature);
    if (t && f) text = s.tool ? t.detail : `${f.single} · ${targetChip(t)}`;
  }
  const same = JSON.stringify(hover) === JSON.stringify(s.hover);
  set({ hover, tip: text ? { x, y, text } : null });
  if (!same) syncView();
}

function onCanvasClick(item: Item | null, mods: { shift: boolean; alt: boolean }) {
  set({ tip: null });
  if (state.defOpen) set({ defOpen: null });
  if (eraserMode()) { if (item?.kind === 'edit') removeIds([item.id]); return; }
  if (item?.kind === 'edit') { selectEdit(item.id, mods); return; }
  if (item?.kind === 'target') {
    const t = targetByKey(item.key);
    if (!t) return;
    if (state.tool) applyTargets(mods.alt ? matching(t).map((g) => g.key) : [t.key]);
    else pickFound(t, mods);
    return;
  }
  if (item?.kind === 'part' && state.tool && state.tool !== 'eraser') { toast(`No ${feature(state.tool)?.noun ?? 'feature'} found here`); return; }
  if (state.sel.length || state.psel.length) { set({ sel: [], psel: [], draft: null }); viewer?.clearPreview(); }
}

export function hoverItem(item: Item | null) {
  set({ hover: item });
}

export function foundChipClick(key: string, mods: { shift: boolean; alt: boolean }) {
  const t = targetByKey(key);
  if (!t) return;
  if (state.tool) applyTargets(mods.alt ? matching(t).map((g) => g.key) : [key]);
  else pickFound(t, mods);
}
export function applyAll() { set({ psel: [], draft: null }); applyTargets(foundList().map((t) => t.key)); }

// ---------- view toggles ----------

export function toggleXray() { const x = !state.xray; set({ xray: x }); viewer?.setXray(x); }
export function toggleOverhang() { set({ showOverhang: !state.showOverhang }); }
export function fitView() { viewer?.fit(); }
export function setCompare(on: boolean) { if (state.compare === on) return; set({ compare: on }); viewer?.setCompare(on); }
export function setEraserHeld(on: boolean) { if (state.eraserHeld === on) return; set({ eraserHeld: on, psel: on ? [] : state.psel, tip: null }); }

/** Esc steps back one level. */
export function stepBack() {
  if (state.panel) { set({ panel: null }); return; }
  if (state.defOpen) set({ defOpen: null });
  else if (state.psel.length) { set({ psel: [], draft: null }); viewer?.clearPreview(); }
  else if (state.sel.length) set({ sel: [] });
  else if (state.tool) set({ tool: null });
}

// ---------- print setup ----------

export function updateSetup(patch: Partial<State['setup']>, persist = true) {
  const next = { ...state.setup, ...patch };
  if (patch.printer && patch.printer !== 'custom') {
    const p = PRINTERS.find((x) => x.id === patch.printer);
    if (p) { next.bedW = p.w; next.bedD = p.d; }
  }
  const bedChanged = next.bedW !== state.setup.bedW || next.bedD !== state.setup.bedD;
  set({ setup: next });
  if (persist) saveSetup({ printer: next.printer, bedW: next.bedW, bedD: next.bedD, nozzle: next.nozzle, layer: next.layer, overhang: next.overhang });
  viewer?.setBed(next.bedW, next.bedD);
  void ask({ type: 'setup', setup: plainSetup() }).then(() => {
    if (bedChanged && state.original) void move({ type: 'place', bed: bed() });
    else if (state.edits.length) scheduleCompose(150);
  });
  if (state.result) setResult(state.result);
}

// ---------- settings ----------

export function setPanel(panel: State['panel']) { set({ panel, tip: null, defOpen: null }); }
export function setMinimal(on: boolean) { set({ minimal: on }); write('printalizer.minimal', on ? '1' : '0'); }
export function setHints(on: boolean) { set({ hints: on }); write('printalizer.hints', on ? '1' : '0'); }
export function setKeys(keys: Record<string, string>) { set({ keys }); write('printalizer.keys', JSON.stringify(keys)); }

// ---------- export ----------

export function baseName() { return state.fileName.replace(/(\.stl)?\.(stl|3mf)$/i, '') || 'part'; }

export async function exportAs(format: '3mf' | 'stl') {
  const project: ProjectData = {
    formatVersion: 1,
    app: 'Printalizer 1.0',
    setup: plainSetup(),
    edits: state.edits.map((e) => { const { tris: _t, ...target } = e.target; return { feature: e.feature, target: { ...target, measure: e.meas }, v: e.v, born: e.born, detected: e.detected }; }),
    defaults: state.defaults,
  };
  try {
    const res = await ask({ type: 'export', format, name: baseName(), project });
    if (res.kind !== 'file') return;
    const url = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: res.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = res.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    set({ panel: null });
    toast(`Saved ${res.name}`);
  } catch (e) {
    toast((e as Error).message);
  }
}
