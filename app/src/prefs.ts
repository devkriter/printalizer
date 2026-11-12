// Interface preferences and keyboard shortcuts, saved in this browser.

export interface Action { id: string; name: string; def: string }

const FIXED_ACTIONS: Action[] = [
  { id: 'eraser', name: 'Eraser (hold)', def: 'E' },
  { id: 'apply', name: 'Apply', def: 'A' },
  { id: 'remove', name: 'Remove', def: 'X' },
  { id: 'xray', name: 'See-through', def: 'S' },
  { id: 'overhang', name: 'Overhangs', def: 'O' },
  { id: 'fit', name: 'Reset view', def: 'F' },
];

export const FIXED_KEYS: Array<[string, string]> = [
  ['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Y'], ['Remove', 'Delete'], ['Step back', 'Esc'],
  ['Add to selection', 'Shift+click'], ['Pick all that match', 'Alt+click'], ['Compare with the original', 'Hold Space'],
  ['Continue after laying flat', 'Enter'], ['Open a file', 'Ctrl+O'],
];

export function actionsFor(features: Array<{ id: string; name: string; key?: string }>): Action[] {
  return [...features.map((f) => ({ id: f.id, name: f.name, def: f.key ?? '' })), ...FIXED_ACTIONS];
}

export const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
export const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export function loadKeys(actions: Action[]): Record<string, string> {
  const keys: Record<string, string> = Object.fromEntries(actions.map((a) => [a.id, a.def]));
  try {
    const saved = JSON.parse(read('printalizer.keys') ?? 'null') as Record<string, string> | null;
    if (saved) for (const k in saved) if (k in keys) keys[k] = saved[k];
  } catch { /* ignore */ }
  return keys;
}

/**
 * The key a shortcut means. Letters by what's printed on the key (AZERTY "A" is A), digits by
 * position (AZERTY needs Shift for digits), and non-Latin layouts fall back to the key's position.
 */
export function normKey(e: KeyboardEvent): string | null {
  const c = e.code || '', k = e.key || '';
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^(Digit|Numpad)\d$/.test(c)) return c.slice(-1);
  if (/^Key[A-Z]$/.test(c)) return c.charAt(3);
  if (/^F\d{1,2}$/.test(k)) return k;
  if (k.length === 1 && k !== ' ') return k.toUpperCase();
  return null;
}
