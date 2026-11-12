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
  /** Free-form for now; becomes the module edit list in Phase 2. */
  edits: unknown[];
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

export interface Read3MF {
  meshes: IndexedMesh[];
  printalizer?: { data: PrintalizerData; original: IndexedMesh };
  /** All part names in the package, to see what another program kept or added. */
  parts: string[];
}

/** Minimal reader: plain meshes from every .model part, plus Printalizer's parts when present. */
export function read3MF(bytes: Uint8Array): Read3MF {
  const files = unzipSync(bytes);
  const meshes: IndexedMesh[] = [];
  for (const [path, data] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith('.model')) continue;
    const xml = strFromU8(data);
    for (const m of xml.matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)) {
      const vert: number[] = [];
      for (const v of m[1].matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)) vert.push(+v[1], +v[2], +v[3]);
      const tri: number[] = [];
      for (const t of m[1].matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)) tri.push(+t[1], +t[2], +t[3]);
      meshes.push({ vert: new Float64Array(vert), tri: new Uint32Array(tri) });
    }
  }
  const out: Read3MF = { meshes, parts: Object.keys(files).sort() };
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
