import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImportReport } from '../../core/geometry.ts';
import { overhangs } from '../../core/overhang.ts';
import { ask } from './client.ts';
import { Icon } from './icons.tsx';
import { refusalText, repairNotes } from './notes.ts';
import type { PartMesh, Response, Vec3 } from './protocol.ts';
import { PRINTERS, loadSetup, printerName, saveSetup } from './setup.ts';
import type { Setup } from './setup.ts';
import { Viewer } from './viewer.ts';

type Phase = 'empty' | 'busy' | 'choose' | 'refused' | 'lay' | 'view';

const fmt = (x: number, d = 1) => x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('empty');
  const [busyText, setBusyText] = useState('');
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [mesh, setMesh] = useState<PartMesh | null>(null);
  const [choices, setChoices] = useState<Array<{ name: string; triangles: number }>>([]);
  const [setup, setSetupState] = useState<Setup>(loadSetup);
  const [showSetup, setShowSetup] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showOverhang, setShowOverhang] = useState(true);
  const [xray, setXray] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [hoverFace, setHoverFace] = useState(false);
  const bed = useMemo(() => ({ w: setup.bedW, d: setup.bedD }), [setup.bedW, setup.bedD]);
  const bedRef = useRef(bed);
  bedRef.current = bed;

  useEffect(() => {
    const v = new Viewer(host.current!);
    viewer.current = v;
    v.onHover = setHoverFace;
    // For checking the app from the console and from tests.
    Object.assign(window, { printalizer: { viewer: v, ask } });
  }, []);

  useEffect(() => { viewer.current?.setBed(bed.w, bed.d); }, [bed]);

  const over = useMemo(() => (mesh ? overhangs(mesh.vert, mesh.tri, setup.overhang) : null), [mesh, setup.overhang]);
  useEffect(() => { viewer.current?.setOverhangs(over?.flags ?? null, showOverhang); }, [over, showOverhang]);
  useEffect(() => { viewer.current?.setMode(phase === 'lay' ? 'lay' : 'view'); }, [phase]);
  useEffect(() => { viewer.current?.setXray(xray); }, [xray]);

  const show = useCallback((res: Response, keepCamera = false) => {
    if (res.kind === 'part' || res.kind === 'moved') {
      if (res.kind === 'part') { setReport(res.report); setPhase('lay'); }
      setMesh(res.mesh);
      viewer.current?.setPart(res.mesh.vert, res.mesh.tri, keepCamera);
    } else if (res.kind === 'choose') {
      setChoices(res.objects);
      setPhase('choose');
    } else if (res.kind === 'refused') {
      setReport(res.report);
      setPhase('refused');
    }
  }, []);

  const run = useCallback(async (req: Parameters<typeof ask>[0], transfer: Transferable[] = [], keepCamera = false) => {
    setError('');
    try {
      const res = await ask(req, setBusyText, transfer);
      show(res, keepCamera);
      return res;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [show]);

  const openFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setPhase('busy');
    setBusyText('Reading');
    setMesh(null);
    setReport(null);
    viewer.current?.clearPart();
    const bytes = await file.arrayBuffer();
    const res = await run({ type: 'open', name: file.name, bytes, bed: bedRef.current }, [bytes]);
    if (!res) setPhase('empty');
  }, [run]);

  const choose = async (index: number | 'all') => {
    setPhase('busy');
    setBusyText('Repairing');
    await run({ type: 'choose', index, bed: bedRef.current });
  };

  useEffect(() => {
    if (!viewer.current) return;
    viewer.current.onPickFace = (normal: Vec3) => { void run({ type: 'layFlat', normal, bed: bedRef.current }); };
  }, [run]);

  const updateSetup = (patch: Partial<Setup>) => {
    setSetupState((s) => {
      const next = { ...s, ...patch };
      if (patch.printer && patch.printer !== 'custom') {
        const p = PRINTERS.find((x) => x.id === patch.printer)!;
        next.bedW = p.w; next.bedD = p.d;
      }
      saveSetup(next);
      return next;
    });
  };
  // Keep the part centred when the bed changes.
  useEffect(() => { if (mesh) void run({ type: 'place', bed }, [], true); }, [bed]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseName = fileName.replace(/\.(stl|3mf)$/i, '').replace(/\.stl$/i, '') || 'part';
  const exportAs = async (format: '3mf' | 'stl') => {
    setShowExport(false);
    const res = await run({ type: 'export', format, name: baseName });
    if (res?.kind !== 'file') return;
    const url = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: res.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = res.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const hasPart = !!mesh && (phase === 'lay' || phase === 'view');

  // Keyboard: F fit, S see-through, O overhangs, Enter continue, Ctrl+O open, Esc closes popovers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); fileInput.current?.click(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { setShowSetup(false); setShowExport(false); return; }
      if (!hasPart) return;
      const k = e.key.toLowerCase();
      if (k === 'f') viewer.current?.fit();
      else if (k === 's') setXray((x) => !x);
      else if (k === 'o') setShowOverhang((x) => !x);
      else if (e.key === 'Enter' && phase === 'lay') setPhase('view');
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [hasPart, phase]);

  // Drop a file anywhere.
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDragging(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) void openFile(f);
    };
    addEventListener('dragover', over);
    addEventListener('dragleave', leave);
    addEventListener('drop', drop);
    return () => { removeEventListener('dragover', over); removeEventListener('dragleave', leave); removeEventListener('drop', drop); };
  }, [openFile]);

  const size = mesh ? [mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1], mesh.max[2] - mesh.min[2]] : null;
  const tooBig = size ? size[0] > bed.w + 1e-6 || size[1] > bed.d + 1e-6 : false;
  const notes = report ? repairNotes(report) : [];

  return (
    <div id="app">
      <div className="bar">
        <span className="brand">Printalizer</span>
        <span className="file" title={fileName}>{fileName}</span>
        <span className="sp" />
        {phase === 'view' && (
          <button className="btn" type="button" onClick={() => setPhase('lay')}>{Icon.lay}Lay flat again</button>
        )}
        <button className="btn setup-read" type="button" onClick={() => { setShowSetup((x) => !x); setShowExport(false); }} aria-expanded={showSetup}>
          {printerName(setup)}<span className="dot">·</span>{setup.nozzle} mm<span className="dot">·</span>{setup.layer.toFixed(2)} mm layers
        </button>
        <button className="btn" type="button" onClick={() => fileInput.current?.click()}>{Icon.open}Open</button>
        <div className="menu-wrap">
          <button className="btn pri" type="button" disabled={!hasPart} onClick={() => { setShowExport((x) => !x); setShowSetup(false); }} aria-expanded={showExport}>
            Export{Icon.chevron}
          </button>
          {showExport && (
            <div className="menu float" role="menu">
              <button type="button" role="menuitem" onClick={() => exportAs('3mf')}><b>3MF</b><span>Keeps the original inside, to reopen later</span></button>
              <button type="button" role="menuitem" onClick={() => exportAs('stl')}><b>STL</b><span>Mesh only</span></button>
            </div>
          )}
        </div>
        <input ref={fileInput} type="file" accept=".stl,.3mf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ''; }} />
      </div>

      <div id="stage" className={phase === 'lay' && hoverFace ? 'pick' : ''}>
        <div className="canvas-host" ref={host} />

        {phase === 'empty' && (
          <div className="center">
            <div className="card start">
              <button className="btn pri big" type="button" onClick={() => fileInput.current?.click()}>{Icon.open}Open an STL or 3MF</button>
              <span className="dim">or drop a file anywhere</span>
            </div>
          </div>
        )}

        {phase === 'busy' && <div className="center"><div className="busy">{busyText}…</div></div>}

        {phase === 'choose' && (
          <div className="center">
            <div className="card choose">
              <h2>This file has {choices.length} objects</h2>
              <div className="choices">
                {choices.map((c, i) => (
                  <button key={i} type="button" className="choice" onClick={() => choose(i)}>
                    <span>{c.name}</span><span className="dim">{c.triangles.toLocaleString()} triangles</span>
                  </button>
                ))}
              </div>
              <button className="btn" type="button" onClick={() => choose('all')}>Open all together</button>
            </div>
          </div>
        )}

        {phase === 'refused' && report && (
          <div className="center">
            <div className="card choose">
              <h2>This file can't be opened as a solid</h2>
              <p>{refusalText(report)}</p>
              <button className="btn pri" type="button" onClick={() => fileInput.current?.click()}>{Icon.open}Open another file</button>
            </div>
          </div>
        )}

        {phase === 'lay' && (
          <div id="lay" className="float">
            <span>Click the face that goes on the bed</span>
            <button className="btn" type="button" onClick={() => run({ type: 'auto', bed })}>Auto</button>
            <button className="btn icon" type="button" title="Turn 90°" aria-label="Turn 90°" onClick={() => run({ type: 'turn', quarterTurns: 1, bed }, [], true)}>{Icon.turn}</button>
            <button className="btn pri" type="button" onClick={() => setPhase('view')}>Continue<kbd>Enter</kbd></button>
          </div>
        )}

        {hasPart && size && mesh && over && (
          <div id="pane" className="float" aria-label="Part">
            <div className="ph"><b>Part</b></div>
            <dl className="facts">
              <dt>Size</dt><dd>{fmt(size[0])} × {fmt(size[1])} × {fmt(size[2])} mm</dd>
              <dt>Volume</dt><dd>{fmt(mesh.volume / 1000)} cm³</dd>
              <dt>Triangles</dt><dd>{(mesh.tri.length / 3).toLocaleString()}</dd>
              <dt>On the bed</dt><dd>{fmt(over.bedArea, 0)} mm²</dd>
              <dt>Overhangs</dt><dd><span className="swatch" />{fmt(over.area, 0)} mm²</dd>
            </dl>
            {tooBig && <div className="warn">Larger than the bed</div>}
            {notes.length > 0 && (
              <div className="notes">
                <div className="dim">Repaired on import</div>
                <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        {hasPart && (
          <div id="view" className="float">
            <button className={`vbtn${showOverhang ? ' on' : ''}`} type="button" aria-pressed={showOverhang} onClick={() => setShowOverhang((x) => !x)}>{Icon.overhang}Overhangs<kbd>O</kbd></button>
            <button className={`vbtn${xray ? ' on' : ''}`} type="button" aria-pressed={xray} onClick={() => setXray((x) => !x)}>{Icon.xray}See-through<kbd>S</kbd></button>
            <button className="vbtn" type="button" aria-label="Reset view" title="Reset view" onClick={() => viewer.current?.fit()}>{Icon.fit}<kbd>F</kbd></button>
          </div>
        )}

        {showSetup && (
          <div className="float setup" role="dialog" aria-label="Print setup">
            <div className="ph"><b>Print setup</b><span className="sp" /><button className="x" type="button" aria-label="Close" onClick={() => setShowSetup(false)}>{Icon.close}</button></div>
            <label className="f">
              <span className="fl">Printer</span>
              <select value={setup.printer} onChange={(e) => updateSetup({ printer: e.target.value })}>
                {PRINTERS.map((p) => <option key={p.id} value={p.id}>{p.id === 'custom' ? 'Custom bed' : `${p.name} (${p.w} × ${p.d})`}</option>)}
              </select>
            </label>
            {setup.printer === 'custom' && (
              <div className="f row2">
                <label><span className="fl">Bed width</span><input type="number" min={50} max={1000} value={setup.bedW} onChange={(e) => updateSetup({ bedW: Math.max(50, +e.target.value || 0) })} /></label>
                <label><span className="fl">Bed depth</span><input type="number" min={50} max={1000} value={setup.bedD} onChange={(e) => updateSetup({ bedD: Math.max(50, +e.target.value || 0) })} /></label>
              </div>
            )}
            <div className="f">
              <span className="fl">Nozzle</span>
              <div className="seg">
                {[0.2, 0.4, 0.6, 0.8].map((n) => <button key={n} type="button" className={setup.nozzle === n ? 'on' : ''} onClick={() => updateSetup({ nozzle: n })}>{n}</button>)}
              </div>
            </div>
            <label className="f">
              <span className="fl">Layer height<span className="sp" /><span className="val">{setup.layer.toFixed(2)} mm</span></span>
              <input type="range" min={0.05} max={0.4} step={0.01} value={setup.layer} onChange={(e) => updateSetup({ layer: +e.target.value })} />
            </label>
            <label className="f">
              <span className="fl">Overhang limit<span className="sp" /><span className="val">{setup.overhang}°</span></span>
              <input type="range" min={20} max={75} step={1} value={setup.overhang} onChange={(e) => updateSetup({ overhang: +e.target.value })} />
            </label>
            <p className="dim small">Faces leaning further than this from vertical show as overhangs.</p>
          </div>
        )}

        {error && <div id="toast" role="status">{error}</div>}
        {dragging && <div className="drop">Drop to open</div>}
      </div>
    </div>
  );
}
