// Finds the built-in features. Each folder in features/ with an index.ts is one feature; nothing
// else needs to change when a folder is added.
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FeatureDef } from '../feature-api/index.ts';
import type { Sample } from './samples.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** For Node (tests and tools). The app uses import.meta.glob in its worker instead. */
export async function loadBuiltIns(): Promise<Array<{ def: FeatureDef; samples: Sample[]; folder: string }>> {
  const out = [];
  for (const folder of readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const index = join(here, folder, 'index.ts');
    if (!existsSync(index)) continue;
    const def = (await import(pathToFileURL(index).href)).default as FeatureDef;
    const sp = join(here, folder, 'samples.ts');
    const samples = existsSync(sp) ? ((await import(pathToFileURL(sp).href)).samples as Sample[]) : [];
    out.push({ def, samples, folder });
  }
  return out.sort((a, b) => (a.def.key ?? '9').localeCompare(b.def.key ?? '9'));
}
