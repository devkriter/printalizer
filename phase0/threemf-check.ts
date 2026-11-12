// Phase 0: do slicers accept a 3MF that carries Printalizer's extra parts, and what do they keep on re-save?
// Loads each test file in each installed slicer's command line, exports a 3MF, and slices it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { read3MF } from '../core/threemf.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const slicers = [
  { name: 'OrcaSlicer', exe: 'C:/Program Files/OrcaSlicer/orca-slicer.exe' },
  { name: 'Bambu Studio', exe: 'C:/Program Files/Bambu Studio/bambu-studio.exe' },
  { name: 'PrusaSlicer', exe: 'C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe' },
].filter((s) => existsSync(s.exe));
const inputs = ['tented-hole-test.3mf', 'tented-hole-test-plain.3mf'];

const run = (exe: string, args: string[]) => {
  const r = spawnSync(exe, args, { cwd: dirname(exe), encoding: 'utf8', timeout: 240_000 });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter((l) => !l.includes('[trace]') && !l.includes('[debug]')).join('\n');
  return { code: r.status, text };
};

const results: unknown[] = [];
for (const s of slicers) {
  for (const input of inputs) {
    const dir = join(out, 'slicers', s.name.replace(/\s/g, '-').toLowerCase(), input.replace('.3mf', ''));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const src = join(out, input);
    const before = read3MF(new Uint8Array(readFileSync(src)));

    // 1. Load and save again.
    const save = run(s.exe, ['--outputdir', dir, '--export-3mf', 'resaved.3mf', src]);
    const resavedPath = join(dir, 'resaved.3mf');
    let kept: Record<string, unknown> = {};
    if (existsSync(resavedPath)) {
      const after = read3MF(new Uint8Array(readFileSync(resavedPath)));
      kept = {
        triangles: after.meshes.reduce((n, m) => n + m.tri.length / 3, 0),
        printalizerPartsKept: after.parts.filter((p) => p.startsWith('Printalizer/')),
        partsAdded: after.parts.filter((p) => !before.parts.includes(p)).length,
      };
    }
    // 2. Slice plate 1 for an A1 mini with PLA, to check the mesh is accepted for printing.
    //    Profiles come from Bambu Studio's install; OrcaSlicer resolves the same preset names.
    const P = 'C:/Program Files/Bambu Studio/resources/profiles/BBL';
    const slice = run(s.exe, [
      '--outputdir', dir,
      '--load-settings', `${P}/machine/Bambu Lab A1 mini 0.4 nozzle.json;${P}/process/0.20mm Standard @BBL A1M.json`,
      '--load-filaments', `${P}/filament/Bambu PLA Basic @BBL A1M.json`,
      '--slice', '1', '--export-3mf', 'sliced.3mf', src,
    ]);
    const sliced = existsSync(join(dir, 'sliced.3mf'))
      ? read3MF(new Uint8Array(readFileSync(join(dir, 'sliced.3mf')))).parts.filter((p) => /\.gcode$/i.test(p))
      : [];
    const row = {
      slicer: s.name, input,
      trianglesIn: before.meshes.reduce((n, m) => n + m.tri.length / 3, 0),
      load: { exit: save.code, resaved: existsSync(resavedPath), ...kept },
      slice: { exit: slice.code, gcode: sliced, note: slice.code ? slice.text.split('\n').filter((l) => /error|fail|invalid|not/i.test(l)).slice(-3).join(' | ') : '' },
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
if (!slicers.length) console.log('No slicers found.');
writeFileSync(join(out, 'slicers', 'results.json'), JSON.stringify(results, null, 1));
