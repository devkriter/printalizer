// Read real 3MF files and import each object, to check the 3MF reader on files from other programs.
import { readFileSync } from 'node:fs';
import { read3MF, soupOf } from '../core/threemf.ts';
import { importSoup } from '../core/geometry.ts';
for (const path of process.argv.slice(2)) {
  try {
    const r = read3MF(new Uint8Array(readFileSync(path)));
    const rows = [];
    for (const o of r.objects.slice(0, 6)) {
      const pos = soupOf(o.mesh);
      const res = await importSoup({ positions: pos, triCount: pos.length / 9, format: '3mf', warnings: [] });
      rows.push(`${o.name.slice(0, 28)}: ${res.report.outcome} ${res.report.trianglesIn} tris ${res.report.size.map((x) => x.toFixed(0)).join('x')}`);
      res.solid?.delete();
    }
    console.log(`${path.split('/').pop()}: ${r.objects.length} objects\n   ${rows.join('\n   ')}`);
  } catch (e) { console.log(`${path}: FAILED ${(e as Error).message}`); }
}
