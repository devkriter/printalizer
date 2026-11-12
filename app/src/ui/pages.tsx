// Full-window and dialog surfaces: settings, tutorial, export and print setup.
import { useEffect, useRef, useState } from 'react';
import { Icon, IconMarkup } from '../icons.tsx';
import { FIXED_KEYS, actionsFor, normKey } from '../prefs.ts';
import { PRINTERS } from '../setup.ts';
import * as A from '../state.ts';
import type { State } from '../state.ts';
import { FeatureIcon } from './controls.tsx';

// ---------- settings ----------

export function Settings({ s }: { s: State }) {
  const [capturing, setCapturing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const actions = actionsFor(s.features);
  const defs = Object.fromEntries(actions.map((a) => [a.id, a.def]));
  const name = (id: string) => actions.find((a) => a.id === id)?.name ?? id;

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); setNote(''); return; }
      const keys = { ...s.keys };
      if (e.key === 'Backspace' || e.key === 'Delete') { keys[capturing] = ''; setNote(`${name(capturing)} has no key now.`); }
      else {
        const k = normKey(e);
        if (!k || e.ctrlKey || e.metaKey || e.altKey) { setNote('Use a letter, number or F key.'); return; }
        const other = Object.keys(keys).find((id) => keys[id] === k);
        const old = keys[capturing];
        keys[capturing] = k;
        // A key already in use swaps with it.
        if (other && other !== capturing) { keys[other] = old; setNote(`${k} was ${name(other)}. ${name(other)}${old ? ` is now ${old}.` : ' has no key now.'}`); }
        else setNote('');
      }
      setCapturing(null);
      A.setKeys(keys);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [capturing, s.keys]); // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <div id="settings" role="dialog" aria-label="Settings">
      <div className="bar"><button type="button" className="btn" onClick={() => A.setPanel(null)} autoFocus>{Icon.back}Back</button></div>
      <div className="set-body">
        <div className="set-col">
          <h1>Settings</h1>
          <h2>Interface</h2>
          <div className="set-card">
            <Switch label="Minimal view" desc="Show tools as icons only" on={s.minimal} set={A.setMinimal} />
            <Switch label="Shortcut hints" desc="Show keys next to buttons" on={s.hints} set={A.setHints} />
          </div>

          <h2>Features</h2>
          <div className="set-card">
            {s.features.map((f) => (
              <div className="set-row feat" key={f.id}>
                <span className="ficon"><FeatureIcon icon={f.icon} /></span>
                <div className="txt">
                  <span className="nm">{f.name}</span>
                  <div className="desc">{f.summary} v{f.version}</div>
                </div>
              </div>
            ))}
          </div>

          <h2>Keyboard shortcuts</h2>
          <div className="set-card">
            {actions.map((a) => (
              <div className="set-row k" key={a.id}>
                <span className="txt">{a.name}</span>
                <button
                  type="button" className={`keybtn${capturing === a.id ? ' cap' : ''}`}
                  aria-label={`${a.name} shortcut: ${s.keys[a.id] || 'none'}. Click to change`}
                  onClick={() => { setCapturing(capturing === a.id ? null : a.id); setNote(capturing === a.id ? '' : 'Esc cancels. Backspace clears.'); }}
                >{capturing === a.id ? 'Press a key' : s.keys[a.id] || '—'}</button>
              </div>
            ))}
            <div className="set-foot">
              <button type="button" className="btn" disabled={Object.keys(defs).every((k) => defs[k] === s.keys[k])} onClick={() => { A.setKeys(defs); setNote('Shortcuts reset.'); }}>Reset shortcuts</button>
              <span className="note" aria-live="polite">{note}</span>
            </div>
          </div>
          <div className="set-card">
            {FIXED_KEYS.map(([n, k]) => <div className="set-row k fixed" key={n}><span className="txt">{n}</span><kbd>{k}</kbd></div>)}
          </div>

          <h2>Help</h2>
          <div className="set-card">
            <div className="set-row">
              <div className="txt"><span className="nm">Tutorial</span><div className="desc">The basic steps, from opening a file to export</div></div>
              <button type="button" className="btn" onClick={() => A.setPanel('tour')}>Show tutorial</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Switch({ label, desc, on, set }: { label: string; desc: string; on: boolean; set: (v: boolean) => void }) {
  const id = `sw-${label.replace(/\W/g, '')}`;
  return (
    <div className="set-row">
      <div className="txt"><label htmlFor={id} className="nm">{label}</label><div className="desc">{desc}</div></div>
      <button id={id} type="button" className="switch" role="switch" aria-checked={on} onClick={() => set(!on)} />
    </div>
  );
}

// ---------- export ----------

export function ExportDialog({ s }: { s: State }) {
  const byFeature = s.features.map((f) => ({ f, list: s.edits.filter((e) => e.feature === f.id && !e.stale) })).filter((x) => x.list.length);
  const failed = s.edits.filter((e) => s.status[e.id] && !s.status[e.id].ok).length;
  const stale = s.edits.filter((e) => e.stale).length;
  const layered = byFeature.filter((x) => x.f.usesLayerHeight);
  const summary = (list: A.Edit[]) => {
    const chips = list.map(A.editChip);
    const counts = new Map<string, number>();
    for (const c of chips) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts].map(([c, n]) => (n > 1 ? `${c} ×${n}` : c)).join(', ');
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-t" onClick={(e) => { if (e.target === e.currentTarget) A.setPanel(null); }}>
      <div className="card export">
        <div className="ph"><h2 id="export-t">Export {A.baseName()}</h2><span className="sp" /><button type="button" className="x" aria-label="Close" onClick={() => A.setPanel(null)}>{Icon.close}</button></div>
        {byFeature.length ? (
          <dl className="facts">
            {byFeature.map(({ f, list }) => <div className="row" key={f.id}><dt><FeatureIcon icon={f.icon} />{f.name}</dt><dd>{summary(list)}</dd></div>)}
          </dl>
        ) : <p className="dim">No edits. The part exports as it is.</p>}
        <dl className="facts">
          <div className="row"><dt>Result</dt><dd>{s.result ? 'Closed solid' : '—'}</dd></div>
          <div className="row"><dt>Size</dt><dd>{s.result ? `${(s.result.max[0] - s.result.min[0]).toFixed(1)} × ${(s.result.max[1] - s.result.min[1]).toFixed(1)} × ${(s.result.max[2] - s.result.min[2]).toFixed(1)} mm` : ''}</dd></div>
        </dl>
        {layered.length > 0 && <p className="note">{layered.map((x) => x.f.name).join(' and ')} assume{layered.length === 1 ? 's' : ''} {s.setup.layer.toFixed(2)} mm layers. Slice at that layer height.</p>}
        {failed > 0 && <p className="warn">{failed} edit{failed === 1 ? '' : 's'} could not be applied and {failed === 1 ? 'is' : 'are'} left out.</p>}
        {stale > 0 && <p className="warn">{stale} edit{stale === 1 ? ' doesn’t' : 's don’t'} apply in this orientation and {stale === 1 ? 'is' : 'are'} left out.</p>}
        <div className="row">
          <button type="button" className="btn pri" onClick={() => void A.exportAs('3mf')}>Save 3MF</button>
          <button type="button" className="btn" onClick={() => void A.exportAs('stl')}>Save STL</button>
        </div>
        <p className="dim small">The 3MF also holds the original and your edits, so you can open it here again and keep adjusting.</p>
      </div>
    </div>
  );
}

// ---------- print setup ----------

export function SetupPopover({ s }: { s: State }) {
  const u = A.updateSetup;
  return (
    <div className="float setup" role="dialog" aria-label="Print setup">
      <div className="ph"><span className="t">Print setup</span><button className="x" type="button" aria-label="Close" onClick={() => A.setPanel(null)}>{Icon.close}</button></div>
      <label className="f">
        <span className="fl">Printer</span>
        <select value={s.setup.printer} onChange={(e) => u({ printer: e.target.value })}>
          {PRINTERS.map((p) => <option key={p.id} value={p.id}>{p.id === 'custom' ? 'Custom bed' : `${p.name} (${p.w} × ${p.d})`}</option>)}
        </select>
      </label>
      {s.setup.printer === 'custom' && (
        <div className="f row2">
          <label><span className="fl">Bed width</span><input type="number" min={50} max={1000} value={s.setup.bedW} onChange={(e) => u({ bedW: Math.max(50, +e.target.value || 0) })} /></label>
          <label><span className="fl">Bed depth</span><input type="number" min={50} max={1000} value={s.setup.bedD} onChange={(e) => u({ bedD: Math.max(50, +e.target.value || 0) })} /></label>
        </div>
      )}
      <div className="f">
        <span className="fl">Nozzle</span>
        <div className="seg">{[0.2, 0.4, 0.6, 0.8].map((n) => <button key={n} type="button" className={s.setup.nozzle === n ? 'on' : ''} onClick={() => u({ nozzle: n })}>{n}</button>)}</div>
      </div>
      <label className="f">
        <span className="fl">Layer height<span className="sp" /><span className="val">{s.setup.layer.toFixed(2)} mm</span></span>
        <input type="range" min={0.05} max={0.4} step={0.01} value={s.setup.layer} onChange={(e) => u({ layer: +e.target.value })} />
      </label>
      <label className="f">
        <span className="fl">Overhang limit<span className="sp" /><span className="val">{s.setup.overhang}°</span></span>
        <input type="range" min={20} max={75} step={1} value={s.setup.overhang} onChange={(e) => u({ overhang: +e.target.value })} />
      </label>
      <p className="dim small">Faces leaning further than this from vertical show as overhangs.</p>
    </div>
  );
}

// ---------- tutorial: shows the steps on a demo block with one hole; nothing is done for you ----------

const TOUR = [
  { t: 'Open a file', p: () => 'Drop an STL or 3MF onto the window.', s: 'open' },
  { t: 'Lay it flat', p: () => 'Click the face that goes on the bed, or press Auto. Then press Continue.', s: 'lay' },
  { t: 'Pick a tool', p: () => 'Tools are on the left. A tool outlines what it can change.', s: 'tool' },
  { t: 'Apply', p: (k: Record<string, string>) => `Click an outlined feature to apply the tool. With no tool picked, a click opens its settings, and Apply${k.apply ? ` (${k.apply})` : ''} applies them.`, s: 'apply' },
  { t: 'Adjust', p: (k: Record<string, string>) => `Click an edit to change its settings. Right-click a tool to change its defaults.${k.remove ? ` ${k.remove} removes the selected edit.` : ''}`, s: 'adjust' },
  { t: 'Export', p: () => 'Export saves a new 3MF or STL with your edits.', s: 'export' },
];

function teardrop(cx: number, cy: number, r: number) {
  const a = r * 0.7071;
  return `M${cx - a} ${cy - a} ${cx} ${cy - r * 1.4142} ${cx + a} ${cy - a}A${r} ${r} 0 1 1 ${cx - a} ${cy - a}Z`;
}
const CURSOR = (x: number, y: number) => `<path transform="translate(${x} ${y})" d="M0 0v17l4.5-4.2 3 6.6 2.6-1.2-3-6.4h6.2Z" fill="#fff" stroke="#12161b" stroke-width="1.2" stroke-linejoin="round"/>`;
const mini = (inner: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

function tourScene(step: string): string {
  const hx = 240, hy = 160, r = 17;
  let svg = '<svg viewBox="0 0 520 270" aria-hidden="true">';
  const lift = step === 'open' ? -14 : 0;
  svg += '<polygon points="70,250 170,180 480,180 380,250" fill="#20262d"/>';
  if (step === 'open') svg += '<rect x="120" y="40" width="300" height="200" rx="10" fill="none" stroke="#9fb2c6" stroke-width="1.5" stroke-dasharray="6 5"/>';
  svg += `<g transform="translate(0 ${lift})">`;
  svg += '<polygon points="150,110 200,75 380,75 330,110" fill="#a9b4c0"/>';
  svg += `<polygon points="330,110 380,75 380,185 330,220" fill="${step === 'lay' ? '#c9d3dd' : '#66727f'}"/>`;
  svg += '<polygon points="150,110 330,110 330,220 150,220" fill="#8894a1"/>';
  svg += `<circle cx="${hx}" cy="${hy}" r="${r}" fill="#12161b"/>`;
  if (step === 'tool') svg += `<circle cx="${hx}" cy="${hy}" r="${r + 3}" fill="rgba(255,255,255,.1)" stroke="#dbe6f2" stroke-width="1.6" stroke-dasharray="4 3"/>`;
  if (step === 'apply' || step === 'adjust' || step === 'export') {
    const on = step === 'adjust';
    svg += `<path d="${teardrop(hx, hy, r)}" fill="#12161b"/><path d="${teardrop(hx, hy, r)}" fill="${on ? '#b6d0ff' : '#4d8dff'}" fill-opacity=".6" stroke="${on ? '#fff' : '#4d8dff'}" stroke-width="2.4"/>`;
  }
  svg += '</g>';
  if (step === 'lay') svg += CURSOR(352, 140);
  if (step === 'apply') svg += CURSOR(246, 166);
  if (step === 'open') svg += `<g transform="translate(366 196)"><rect width="104" height="26" rx="6" fill="#262c33" stroke="#454e58"/><text x="12" y="17" fill="#e3e8ee" font-size="11" font-family="Inter, sans-serif">demo_block.stl</text></g>${CURSOR(440, 214)}`;
  svg += '</svg>';
  const rail = `<div class="mini" style="left:10px;top:10px;flex-direction:column;gap:2px;padding:3px"><span class="mtool on">${mini(IconMarkup.tent)}</span><span class="mtool">${mini(IconMarkup.thread)}</span><span class="mtool">${mini(IconMarkup.cbore)}</span></div>`;
  const strip = (n: string, on: boolean) => `<div class="mini" style="left:10px;bottom:10px;padding:4px 6px 4px 10px"><b style="font-weight:600">${n}</b><span class="mtool${on ? ' on' : ''}" style="width:24px;height:24px;border:1px solid ${on ? '#4d8dff' : '#3c444d'}">${mini(IconMarkup.tent)}</span></div>`;
  let html = '';
  if (step === 'lay') html += '<div class="mini" style="left:50%;top:10px;transform:translateX(-50%);padding:4px 4px 4px 12px;border-radius:16px">Click the face that goes on the bed<span class="btn">Auto</span><span class="btn pri">Continue</span></div>';
  if (step === 'tool') html += `${rail}<div class="mini" style="left:50%;top:10px;transform:translateX(-50%);padding:4px 12px;border-radius:16px"><span style="color:#9aa5b1">Found</span><span style="border:1.5px dashed #9fb2c6;border-radius:11px;padding:2px 9px">⌀6</span></div>`;
  if (step === 'apply') html += rail + strip('1 edit', false);
  if (step === 'adjust') html += `${rail}${strip('1 edit', true)}<div class="mini" style="right:10px;top:10px;width:150px;padding:9px 10px;flex-direction:column;align-items:stretch;gap:7px;white-space:normal"><b style="font-size:12px">Tented hole</b><span style="color:#9aa5b1">Roof angle <span style="float:right;color:#e3e8ee">45°</span></span><span style="height:3px;border-radius:2px;background:linear-gradient(to right,#4d8dff 50%,#3c444d 0)"></span></div>`;
  if (step === 'export') html += `<div class="mini" style="left:0;right:0;top:0;border-radius:0;border-width:0 0 1px;padding:6px 10px"><b>Printalizer</b><span style="color:#9aa5b1">demo_block.stl</span><span style="flex:1"></span><span class="btn pri" style="box-shadow:0 0 0 3px rgba(77,141,255,.35)">Export</span></div>${strip('1 edit', false)}`;
  return svg + html;
}

export function Tour({ s }: { s: State }) {
  const [i, setI] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const close = () => { try { localStorage.setItem('printalizer.tourSeen', '1'); } catch { /* ignore */ } A.setPanel(null); };
  const step = (d: number) => { const n = i + d; if (n >= TOUR.length) close(); else if (n >= 0) setI(n); };
  useEffect(() => { next.current?.focus(); }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });
  const st = TOUR[i];
  return (
    <div id="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-card">
        <div className="tour-ill" dangerouslySetInnerHTML={{ __html: tourScene(st.s) }} />
        <div>
          <div className="tour-step">{i + 1} of {TOUR.length}</div>
          <h2 id="tour-title">{st.t}</h2>
          <p>{st.p(s.keys)}</p>
        </div>
        <div className="tour-foot">
          <button type="button" className="btn ghost" onClick={close}>Skip</button>
          <div className="tour-dots" aria-hidden="true">{TOUR.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}</div>
          <button type="button" className="btn" style={{ visibility: i ? 'visible' : 'hidden' }} onClick={() => step(-1)}>Back</button>
          <button type="button" className="btn pri" ref={next} onClick={() => step(1)}>{i === TOUR.length - 1 ? 'Start' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
