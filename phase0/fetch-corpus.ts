// Copy the Phase 0 test files into phase0/corpus/ under short names.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const list = JSON.parse(readFileSync(join(here, 'corpus.json'), 'utf8')) as { files: Array<{ id: string; path: string }> };
const out = join(here, 'corpus');
mkdirSync(out, { recursive: true });
let missing = 0;
for (const f of list.files) {
  if (!existsSync(f.path)) { console.log(`missing  ${f.id}  ${f.path}`); missing++; continue; }
  copyFileSync(f.path, join(out, `${f.id}.stl`));
  console.log(`copied   ${f.id.padEnd(22)} ${(statSync(f.path).size / 1024).toFixed(0).padStart(7)} KB`);
}
console.log(missing ? `${missing} missing` : 'all copied');
