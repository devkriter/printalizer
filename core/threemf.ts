// 3MF export and import. The package carries the printable mesh as usual, plus Printalizer's own
// parts: the original mesh and the edit list, so a saved file can be reopened with its edits.
// Slicers must ignore parts they don't know, which Phase 0 checks.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { IndexedMesh } from './mesh.ts';
import { parseSTL, writeSTL } from './stl.ts';

export const PRINTALIZER_NS = 'https://printalizer.app/3mf/2026';
const REL_EDITS = 'https://printalizer.app/3mf/2026/edits';
const REL_ORIGINAL = 'https://printalizer.app/3mf/2026/original';
const EDITS_PATH = 'Printalizer/edits.json';
const ORIGINAL_PATH = 'Printalizer/original.stl';

export interface PrintalizerData {
  formatVersion: 1;
  app: string;
  /** The edits, as the app saved them. */
  edits: unknown[];
  [key: string]: unknown;
}

function modelXml(mesh: IndexedMesh, name: string): string {
  const v: string[] = [];
  for (let i = 0; i < mesh.vert.length; i += 3) v.push(`<vertex x="${fmt(mesh.vert[i])}" y="${fmt(mesh.vert[i + 1])}" z="${fmt(mesh.vert[i + 2])}"/>`);
  const t: string[] = [];
  for (let i = 0; i < mesh.tri.length; i += 3) t.push(`<triangle v1="${mesh.tri[i]}" v2="${mesh.tri[i + 1]}" v3="${mesh.tri[i + 2]}"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">Printalizer</metadata>
 <metadata name="Title">${escapeXml(name)}</metadata>
 <resources>
  <object id="1" type="model" name="${escapeXml(name)}">
   <mesh>
    <vertices>${v.join('')}</vertices>
    <triangles>${t.join('')}</triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="1"/>
 </build>
</model>`;
}

function fmt(x: number) { return Number.isInteger(x) ? String(x) : x.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''); }
function escapeXml(s: string) { return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`); }

export function write3MF(mesh: IndexedMesh, name: string, extra?: { original: IndexedMesh; data: PrintalizerData }): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="json" ContentType="application/json"/>
 <Default Extension="stl" ContentType="model/stl"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>${extra ? `
 <Relationship Target="/${EDITS_PATH}" Id="rel1" Type="${REL_EDITS}"/>
 <Relationship Target="/${ORIGINAL_PATH}" Id="rel2" Type="${REL_ORIGINAL}"/>` : ''}
</Relationships>`),
    '3D/3dmodel.model': strToU8(modelXml(mesh, name)),
  };
  if (extra) {
    files[EDITS_PATH] = strToU8(JSON.stringify(extra.data, null, 1));
    files[ORIGINAL_PATH] = writeSTL(extra.original.vert, extra.original.tri, 'Printalizer original');
  }
  return zipSync(files, { level: 6 });
}

/** Triangle soup from an indexed mesh, for the import pipeline. */
export function soupOf(mesh: IndexedMesh): Float32Array {
  const pos = new Float32Array(mesh.tri.length * 3);
  for (let i = 0; i < mesh.tri.length; i++) {
    const v = mesh.tri[i] * 3;
    pos[i * 3] = mesh.vert[v]; pos[i * 3 + 1] = mesh.vert[v + 1]; pos[i * 3 + 2] = mesh.vert[v + 2];
  }
  return pos;
}

export interface Object3MF {
  name: string;
  /** In build (plate) coordinates, with every transform applied. */
  mesh: IndexedMesh;
}

export interface Read3MF {
  /** One entry per build item: what a slicer would place on its plates. */
  objects: Object3MF[];
  /** The same meshes, for callers that only need geometry. */
  meshes: IndexedMesh[];
  printalizer?: { data: PrintalizerData; original: IndexedMesh };
  /** All part names in the package, to see what another program kept or added. */
  parts: string[];
}

type Mat = number[]; // 3MF affine transform: m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32 (row vectors)
const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function parseMat(s: string | undefined): Mat {
  if (!s) return IDENTITY;
  const m = s.trim().split(/\s+/).map(Number);
  return m.length === 12 && m.every(Number.isFinite) ? m : IDENTITY;
}
/** a then b. */
function mul(a: Mat, b: Mat): Mat {
  const r: Mat = new Array(12);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    let s = i === 3 ? b[9 + j] : 0;
    for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
    r[i * 3 + j] = s;
  }
  return r;
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    out[m[1]] = m[2];
    const local = m[1].split(':').pop()!;
    if (!(local in out)) out[local] = m[2];
  }
  return out;
}

interface RawObject { name: string; mesh?: IndexedMesh; components: Array<{ path?: string; objectid: string; transform: Mat }> }

function parseModel(xml: string): Map<string, RawObject> {
  const objects = new Map<string, RawObject>();
  for (const om of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const a = attrs(om[1]);
    const body = om[2];
    const obj: RawObject = { name: a.name ?? '', components: [] };
    const mesh = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/.exec(body);
    if (mesh) {
      const vert: number[] = [];
      for (const v of mesh[1].matchAll(/<vertex\b([^>]*)\/?>/g)) {
        const va = attrs(v[1]);
        vert.push(+va.x, +va.y, +va.z);
      }
      const tri: number[] = [];
      for (const t of mesh[1].matchAll(/<triangle\b([^>]*)\/?>/g)) {
        const ta = attrs(t[1]);
        tri.push(+ta.v1, +ta.v2, +ta.v3);
      }
      obj.mesh = { vert: new Float64Array(vert), tri: new Uint32Array(tri) };
    }
    for (const c of body.matchAll(/<component\b([^>]*)\/?>/g)) {
      const ca = attrs(c[1]);
      obj.components.push({ path: ca.path, objectid: ca.objectid, transform: parseMat(ca.transform) });
    }
    objects.set(a.id, obj);
  }
  return objects;
}

/**
 * Reads the build items of a 3MF, resolving components (also in other model parts, as Bambu
 * Studio and OrcaSlicer write them) and all transforms. Printalizer's own parts are returned too.
 */
export function read3MF(bytes: Uint8Array): Read3MF {
  const files = unzipSync(bytes);
  const norm = (p: string) => p.replace(/^\//, '');
  const lower = new Map(Object.keys(files).map((k) => [k.toLowerCase(), k]));
  const models = new Map<string, Map<string, RawObject>>();
  const modelAt = (path: string) => {
    const key = lower.get(norm(path).toLowerCase());
    if (!key) return null;
    let m = models.get(key);
    if (!m) { m = parseModel(strFromU8(files[key])); models.set(key, m); }
    return m;
  };
  // The root model is the target of the 3dmodel relationship, usually 3D/3dmodel.model.
  let rootPath = '3D/3dmodel.model';
  const rels = files['_rels/.rels'];
  if (rels) {
    const r = /Target="([^"]+)"[^>]*Type="[^"]*3dmodel"/.exec(strFromU8(rels)) ?? /Type="[^"]*3dmodel"[^>]*Target="([^"]+)"/.exec(strFromU8(rels));
    if (r) rootPath = norm(r[1]);
  }
  const root = modelAt(rootPath);
  const objects: Object3MF[] = [];
  if (root) {
    const rootXml = strFromU8(files[lower.get(rootPath.toLowerCase())!]);
    const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(rootXml);
    const collect = (model: Map<string, RawObject>, id: string, t: Mat, vert: number[], tri: number[], depth: number) => {
      const o = model.get(id);
      if (!o || depth > 16) return;
      if (o.mesh) {
        const base = vert.length / 3;
        const v = o.mesh.vert;
        for (let i = 0; i < v.length; i += 3) {
          vert.push(
            v[i] * t[0] + v[i + 1] * t[3] + v[i + 2] * t[6] + t[9],
            v[i] * t[1] + v[i + 1] * t[4] + v[i + 2] * t[7] + t[10],
            v[i] * t[2] + v[i + 1] * t[5] + v[i + 2] * t[8] + t[11],
          );
        }
        for (const i of o.mesh.tri) tri.push(i + base);
      }
      for (const c of o.components) {
        const target = c.path ? modelAt(c.path) : model;
        if (target) collect(target, c.objectid, mul(c.transform, t), vert, tri, depth + 1);
      }
    };
    const items = build ? [...build[1].matchAll(/<item\b([^>]*)\/?>/g)].map((m) => attrs(m[1])) : [];
    for (const item of items) {
      const vert: number[] = [], tri: number[] = [];
      collect(root, item.objectid, parseMat(item.transform), vert, tri, 0);
      if (!tri.length) continue;
      const o = root.get(item.objectid)!;
      const fallback = o.components[0]?.path?.split('/').pop()?.replace(/(\.stl)?(_\d+)?\.model$/i, '') ?? '';
      objects.push({ name: o.name || fallback || `Object ${objects.length + 1}`, mesh: { vert: new Float64Array(vert), tri: new Uint32Array(tri) } });
    }
  }
  const out: Read3MF = { objects, meshes: objects.map((o) => o.mesh), parts: Object.keys(files).sort() };
  if (files[EDITS_PATH] && files[ORIGINAL_PATH]) {
    const soup = parseSTL(files[ORIGINAL_PATH]);
    const tri = new Uint32Array(soup.triCount * 3).map((_, i) => i);
    out.printalizer = {
      data: JSON.parse(strFromU8(files[EDITS_PATH])) as PrintalizerData,
      original: { vert: new Float64Array(soup.positions), tri },
    };
  }
  return out;
}
