// Print setup: the printer's bed, nozzle, layer height and overhang limit. Saved in this browser.

export interface Printer { id: string; name: string; w: number; d: number }

export const PRINTERS: Printer[] = [
  { id: 'a1mini', name: 'Bambu Lab A1 mini', w: 180, d: 180 },
  { id: 'a1', name: 'Bambu Lab A1', w: 256, d: 256 },
  { id: 'p1', name: 'Bambu Lab P1S / X1C', w: 256, d: 256 },
  { id: 'mk4', name: 'Prusa MK4', w: 250, d: 210 },
  { id: 'mini', name: 'Prusa MINI', w: 180, d: 180 },
  { id: 'ender3v3', name: 'Creality Ender-3 V3', w: 220, d: 220 },
  { id: 'micron', name: 'Micron (180)', w: 180, d: 180 },
  { id: 'v24-350', name: 'Voron 2.4 350', w: 350, d: 350 },
  { id: 'custom', name: 'Custom', w: 200, d: 200 },
];

export interface Setup {
  printer: string;
  bedW: number;
  bedD: number;
  nozzle: number;
  layer: number;
  overhang: number;
}

export const DEFAULT_SETUP: Setup = { printer: 'a1mini', bedW: 180, bedD: 180, nozzle: 0.4, layer: 0.2, overhang: 45 };

const KEY = 'printalizer.setup';

export function loadSetup(): Setup {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Setup> | null;
    if (s && typeof s === 'object') return { ...DEFAULT_SETUP, ...s };
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_SETUP };
}

export function saveSetup(s: Setup) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function printerName(s: Setup) {
  const p = PRINTERS.find((x) => x.id === s.printer);
  return p && p.id !== 'custom' ? p.name.replace('Bambu Lab ', '') : `${s.bedW} × ${s.bedD}`;
}
