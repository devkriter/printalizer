// npm run new-feature -- my-feature
// Creates features/my-feature/ from the template. Nothing else needs to change: the app and the
// checks find the folder by themselves.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
if (!id || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) {
  console.error('Give an id of 2–40 lowercase letters, digits or dashes, e.g.: npm run new-feature -- heat-set-pockets');
  process.exit(1);
}
const dest = join(here, '..', 'features', id);
if (existsSync(dest)) { console.error(`features/${id} already exists.`); process.exit(1); }
const name = id.split('-').map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
mkdirSync(dest, { recursive: true });
const tpl = join(here, 'new-feature', 'template');
for (const f of readdirSync(tpl)) {
  const text = readFileSync(join(tpl, f), 'utf8').replaceAll('__ID__', id).replaceAll('__NAME__', name).replaceAll('__PLURAL__', name.toLowerCase());
  writeFileSync(join(dest, f), text);
}
console.log(`Created features/${id}. Fill in index.ts, samples.ts and README.md, then run npm test.`);
