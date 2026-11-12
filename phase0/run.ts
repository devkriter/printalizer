// Phase 0: put every test file through import, repair and hole finding, and write a report.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSTL, meshOf } from '../core/geometry.ts';
import { findCylinders } from '../core/holes.ts';

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, 'corpus');
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const meta = new Map<string, string>();
try {
  const list = JSON.parse(readFileSync(join(here, 'corpus.json'), 'utf8')) as { files: Array<{ id: string; kind: string }> };
  for (const f of list.files) meta.set(f.id, f.kind);
} catch { /* the list is optional */ }

const only = process.argv[2];
const files = readdirSync(corpusDir).filter((f) => f.toLowerCase().endsWith('.stl') && (!only || f.startsWith(only))).sort();
const rows: unknown[] = [];

for (const file of files) {
  const id = file.replace(/\.stl$/i, '');
  const bytes = new Uint8Array(readFileSync(join(corpusDir, file)));
  const t0 = performance.now();
  let row: Record<string, unknown>;
  try {
    const { report, solid } = await importSTL(bytes);
    let holes: ReturnType<typeof findCylinders> = [];
    let findMs = 0;
    if (solid) {
      const t1 = performance.now();
      holes = findCylinders(meshOf(solid));
      findMs = performance.now() - t1;
      solid.delete();
    }
    const full = holes.filter((h) => h.kind === 'hole' && h.coverage >= 300);
    const count = (o: string) => full.filter((h) => h.orientation === o).length;
    row = {
      id,
      kind: meta.get(id) ?? '',
      ...report,
      findMs,
      holes: {
        full: full.length,
        horizontal: count('horizontal'),
        vertical: count('vertical'),
        angled: count('angled'),
        partialArcs: holes.filter((h) => h.kind === 'hole' && h.coverage < 300).length,
        bosses: holes.filter((h) => h.kind === 'boss' && h.coverage >= 300).length,
        diameters: [...new Set(full.map((h) => +(h.radius * 2).toFixed(2)))].sort((a, b) => a - b),
        segments: [...new Set(full.map((h) => h.segments))].sort((a, b) => a - b),
        worstFit: full.reduce((m, h) => Math.max(m, h.fitError), 0),
      },
      list: full.map((h) => ({
        o: h.orientation, d: +(h.radius * 2).toFixed(3), len: +h.length.toFixed(2), cov: Math.round(h.coverage),
        seg: h.segments, fit: +h.fitError.toExponential(1), c: h.center.map((x) => +x.toFixed(2)), a: h.axis.map((x) => +x.toFixed(3)),
      })),
    };
  } catch (e) {
    row = { id, kind: meta.get(id) ?? '', outcome: 'crashed', reason: String((e as Error).stack ?? e) };
  }
  row.totalMs = performance.now() - t0;
  rows.push(row);
  const r = row as { outcome: string; reason?: string; trianglesIn?: number; holes?: { full: number; horizontal: number; vertical: number }; totalMs: number };
  console.log(
    `${id.padEnd(22)} ${String(r.outcome).padEnd(9)} ${String(r.trianglesIn ?? '').padStart(8)} tris  `
    + (r.holes ? `holes ${String(r.holes.full).padStart(3)} (h ${r.holes.horizontal}, v ${r.holes.vertical})` : '')
    + `  ${(r.totalMs / 1000).toFixed(2)} s${r.reason ? '  ' + r.reason.split('\n')[0] : ''}`,
  );
}

if (!only) writeFileSync(join(outDir, 'report.json'), JSON.stringify(rows, null, 1));
