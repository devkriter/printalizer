import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { refusalText, repairNotes } from './notes.ts';
import { normKey, read } from './prefs.ts';
import { printerName } from './setup.ts';
import * as A from './state.ts';
import { Viewer } from './viewer.ts';
import { Defaults, Edits, Found, Pane, PartCard, Rail } from './ui/panes.tsx';
import { ExportDialog, Settings, SetupPopover, Tour } from './ui/pages.tsx';

export function App() {
  const s = A.useAppState();
  const host = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [layHover, setLayHover] = useState(false);

  useEffect(() => {
    const v = new Viewer(host.current!);
    v.onLayHover = setLayHover;
    A.attachViewer(v);
    // For checking the app from the console and from tests.
    Object.assign(window, { printalizer: { viewer: v, state: A } });
    void A.init();
    if (read('printalizer.tourSeen') !== '1') A.setPanel('tour');
  }, []);

  // Keyboard.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const st = A.get();
      if (st.panel === 'tour') return;
      if (st.panel === 'settings') { if (e.key === 'Escape') A.setPanel(null); return; }
      if (e.key === 'Escape') { A.stepBack(); return; }
      const tg = e.target as HTMLElement;
      const typing = (tg.tagName === 'INPUT' && (tg as HTMLInputElement).type !== 'range') || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA';
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      const kl = e.key.toLowerCase();
      if (mod && kl === 'o') { e.preventDefault(); fileInput.current?.click(); return; }
      if (mod && kl === 'z') { e.preventDefault(); if (e.shiftKey) A.redo(); else A.undo(); return; }
      if (mod && kl === 'y') { e.preventDefault(); A.redo(); return; }
      if (mod || e.altKey) return;
      const hasPart = st.phase === 'lay' || st.phase === 'edit';
      if (!hasPart) return;
      if (e.key === ' ') { e.preventDefault(); if (!e.repeat && st.phase === 'edit') A.setCompare(true); return; }
      if (e.key === 'Enter' && st.phase === 'lay' && tg.tagName !== 'BUTTON') { e.preventDefault(); void A.continueToEdit(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.phase === 'edit') {
        if ((tg as HTMLInputElement).type === 'range') return;
        if (st.sel.length) { e.preventDefault(); A.removeSelected(); }
        return;
      }
      const k = normKey(e);
      const action = k ? Object.keys(st.keys).find((id) => st.keys[id] === k) : undefined;
      if (!action) return;
      if (action === 'fit') { A.fitView(); return; }
      if (action === 'xray') { if (!e.repeat) A.toggleXray(); return; }
      if (action === 'overhang') { if (!e.repeat) A.toggleOverhang(); return; }
      if (st.phase !== 'edit') return;
      if (action === 'eraser') { A.setEraserHeld(true); return; }
      if (e.repeat) return;
      if (action === 'apply') { if (st.psel.length) A.applyPicked(); return; }
      if (action === 'remove') { A.removeSelected(); return; }
      if (st.features.some((f) => f.id === action)) A.selectTool(action);
    };
    const onUp = (e: KeyboardEvent) => {
      const st = A.get();
      if (e.key === ' ') A.setCompare(false);
      if (st.keys.eraser && normKey(e) === st.keys.eraser) A.setEraserHeld(false);
    };
    const onBlur = () => { A.setCompare(false); A.setEraserHeld(false); };
    addEventListener('keydown', onDown);
    addEventListener('keyup', onUp);
    addEventListener('blur', onBlur);
    return () => { removeEventListener('keydown', onDown); removeEventListener('keyup', onUp); removeEventListener('blur', onBlur); };
  }, []);

  // Drop a file anywhere.
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDragging(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) void A.openFile(f);
    };
    addEventListener('dragover', over);
    addEventListener('dragleave', leave);
    addEventListener('drop', drop);
    return () => { removeEventListener('dragover', over); removeEventListener('dragleave', leave); removeEventListener('drop', drop); };
  }, []);

  const hasPart = s.phase === 'lay' || s.phase === 'edit';
  const eraser = A.eraserMode();
  const showPane = s.phase === 'edit' && ((s.psel.length > 0 && s.draft) || s.sel.length > 0);
  const notes = s.report ? repairNotes(s.report) : [];
  const stageClass = [s.phase === 'lay' && layHover ? 'pick' : '', s.phase === 'edit' && s.hover ? 'pick' : '', eraser ? 'erasing' : ''].join(' ');

  return (
    <div id="app" className={[s.minimal ? 'minimal' : '', s.hints ? '' : 'nohints', s.phase].join(' ')}>
      <div className="bar">
        <span className="brand">Printalizer</span>
        <span className="file" title={s.fileName}>{s.fileName}</span>
        <span className="sp" />
        {s.phase === 'edit' && (
          <>
            <button className="btn" type="button" onClick={A.layAgain}>{Icon.lay}Lay flat again</button>
            <button className="btn icon" type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!s.undo.length} onClick={A.undo}>{Icon.undo}</button>
            <button className="btn icon" type="button" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!s.redo.length} onClick={A.redo}>{Icon.redo}</button>
          </>
        )}
        <button className="btn setup-read" type="button" onClick={() => A.setPanel(s.panel === 'setup' ? null : 'setup')} aria-expanded={s.panel === 'setup'}>
          {printerName({ ...s.setup })}<span className="dot">·</span>{s.setup.nozzle} mm<span className="dot">·</span>{s.setup.layer.toFixed(2)} mm layers
        </button>
        <button className="btn" type="button" onClick={() => fileInput.current?.click()}>{Icon.open}Open</button>
        <button className="btn pri" type="button" disabled={!hasPart} onClick={() => A.setPanel('export')}>Export</button>
        <button className="btn icon" type="button" aria-label="Settings" title="Settings" onClick={() => A.setPanel('settings')}>{Icon.gear}</button>
        <input ref={fileInput} type="file" accept=".stl,.3mf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void A.openFile(f); e.target.value = ''; }} />
      </div>

      <div id="stage" className={stageClass}>
        <div className="canvas-host" ref={host} />

        {s.phase === 'empty' && (
          <div className="center">
            <div className="card start">
              <button className="btn pri big" type="button" onClick={() => fileInput.current?.click()}>{Icon.open}Open an STL or 3MF</button>
              <span className="dim">or drop a file anywhere</span>
              {s.error && <span className="warn">{s.error}</span>}
            </div>
          </div>
        )}
        {s.phase === 'busy' && <div className="center"><div className="busy">{s.busyText}…</div></div>}
        {s.phase === 'choose' && (
          <div className="center">
            <div className="card choose">
              <h2>This file has {s.choices.length} objects</h2>
              <div className="choices">
                {s.choices.map((c, i) => (
                  <button key={i} type="button" className="choice" onClick={() => void A.choose(i)}>
                    <span>{c.name}</span><span className="dim">{c.triangles.toLocaleString()} triangles</span>
                  </button>
                ))}
              </div>
              <button className="btn" type="button" onClick={() => void A.choose('all')}>Open all together</button>
            </div>
          </div>
        )}
        {s.phase === 'refused' && s.report && (
          <div className="center">
            <div className="card choose">
              <h2>This file can't be opened as a solid</h2>
              <p>{refusalText(s.report)}</p>
              <button className="btn pri" type="button" onClick={() => fileInput.current?.click()}>{Icon.open}Open another file</button>
            </div>
          </div>
        )}

        {s.phase === 'lay' && (
          <div id="lay" className="float">
            <span>Click the face that goes on the bed</span>
            <button className="btn" type="button" onClick={() => void A.layAuto()}>Auto</button>
            <button className="btn icon" type="button" title="Turn 90°" aria-label="Turn 90°" onClick={() => void A.layTurn()}>{Icon.turn}</button>
            <button className="btn pri" type="button" onClick={() => void A.continueToEdit()}>Continue<kbd className="hk">Enter</kbd></button>
          </div>
        )}

        {s.phase === 'edit' && <Rail s={s} />}
        <Found s={s} />
        {showPane ? <Pane s={s} /> : hasPart && s.panel !== 'setup' && <PartCard s={s} notes={notes} />}
        <Defaults s={s} />
        <Edits s={s} />
        {hasPart && (
          <div id="view" className="float">
            <button className={`vbtn${s.showOverhang ? ' on' : ''}`} type="button" aria-pressed={s.showOverhang} onClick={A.toggleOverhang}>{Icon.overhang}Overhangs<kbd className="hk">{s.keys.overhang}</kbd></button>
            <button className={`vbtn${s.xray ? ' on' : ''}`} type="button" aria-pressed={s.xray} onClick={A.toggleXray}>{Icon.xray}See-through<kbd className="hk">{s.keys.xray}</kbd></button>
            <button className="vbtn icon" type="button" aria-label="Reset view" title="Reset view" onClick={A.fitView}>{Icon.fit}<kbd className="hk">{s.keys.fit}</kbd></button>
          </div>
        )}
        {s.panel === 'setup' && <SetupPopover s={s} />}
        {s.compare && <div className="badge">Original</div>}
        {s.tip && s.phase === 'edit' && <div className="tip" style={{ left: s.tip.x + 14, top: s.tip.y + 16 }}>{s.tip.text}</div>}
        {s.toast && <div id="toast" role="status">{s.toast}</div>}
        {dragging && <div className="drop">Drop to open</div>}
      </div>

      {s.panel === 'settings' && <Settings s={s} />}
      {s.panel === 'export' && <ExportDialog s={s} />}
      {s.panel === 'tour' && <Tour s={s} />}
    </div>
  );
}
