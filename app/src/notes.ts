// Plain-language lines about what import did to a file. Count only what happened, never what's "wrong".
import type { ImportReport } from '../../core/geometry.ts';

const n = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

export function repairNotes(r: ImportReport): string[] {
  const t = r.topology;
  const out: string[] = [];
  if (r.clean.doubleWalls) out.push(`Removed ${n(r.clean.doubleWalls, 'double wall', 'double walls')}`);
  if (t?.flipped) out.push(`Turned ${n(t.flipped, 'face', 'faces')} the right way`);
  if (r.insideOut) out.push(`Turned ${n(r.insideOut, 'inside-out piece', 'inside-out pieces')} the right way`);
  if (t?.nonManifoldPaired) out.push('Separated pieces that touched along an edge');
  if (r.overlapping) out.push('Joined overlapping pieces');
  if (t?.holesFilled) out.push(`Closed ${n(t.holesFilled, 'gap', 'gaps')}`);
  const flat = /(\d+)× flat shell/.exec(r.warnings.join(' '));
  if (flat) out.push(`Left out ${n(+flat[1], 'paper-thin sheet', 'paper-thin sheets')}`);
  return out;
}

/** Why a file could not be opened, in the user's terms. */
export function refusalText(r: ImportReport): string {
  const why = r.reason ?? '';
  if (/no triangles/i.test(why)) return 'The file has no triangles.';
  if (/open/i.test(why)) return 'It has an opening too large to close safely, so any fix would be a guess.';
  return why || 'It could not be made into a closed solid.';
}
