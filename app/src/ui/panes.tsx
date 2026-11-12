// The floating panels over the model: tool rail, Found, settings panes, defaults, edits strip.
import { useLayoutEffect, useRef, useState } from 'react';
import type { FeatureManifest } from '../../../feature-api/index.ts';
import { Icon } from '../icons.tsx';
import * as A from '../state.ts';
import type { State } from '../state.ts';
import { FeatureIcon, MIXED, MeasureControl, ParamControl, visible } from './controls.tsx';

const Kbd = ({ k }: { k?: string }) => (k ? <kbd className="hk">{k}</kbd> : null);

// ---------- tool rail ----------

export function Rail({ s }: { s: State }) {
  const [tip, setTip] = useState<{ y: number; x: number; text: string; key?: string } | null>(null);
  const show = (e: React.MouseEvent, text: string, key?: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: r.right + 10, y: r.top + r.height / 2, text, key });
  };
  const tool = (f: FeatureManifest) => {
    const on = s.tool === f.id;
    const count = s.edits.filter((e) => e.feature === f.id).length;
    return (
      <button
        key={f.id} type="button" className={`tool${on ? ' on' : ''}`} data-t={f.id} aria-pressed={on} aria-label={f.name}
        onClick={() => A.selectTool(f.id)}
        onContextMenu={(e) => { e.preventDefault(); setTip(null); A.setDefOpen(s.defOpen === f.id ? null : f.id); }}
        onMouseEnter={(e) => show(e, f.name, s.keys[f.id])} onMouseLeave={() => setTip(null)}
      >
        <FeatureIcon icon={f.icon} />
        <span className="tl">{f.label ?? f.name}</span>
        <i className="tri" aria-hidden="true" />
        {s.keys[f.id] && <span className="hk tk" aria-hidden="true">{s.keys[f.id]}</span>}
        {count > 0 && <span className="cnt" aria-hidden="true">{count}</span>}
      </button>
    );
  };
  return (
    <>
      <div id="rail" className="float" role="toolbar" aria-label="Tools">
        {s.features.map(tool)}
        <span className="rail-sep" />
        <button
          type="button" className={`tool eraser${s.tool === 'eraser' ? ' on' : ''}`} aria-pressed={s.tool === 'eraser'} aria-label="Eraser"
          onClick={() => A.selectTool('eraser')} onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={(e) => show(e, 'Eraser', s.keys.eraser ? `Hold ${s.keys.eraser}` : undefined)} onMouseLeave={() => setTip(null)}
        >
          {Icon.eraser}<span className="tl">Eraser</span>
          {s.keys.eraser && <span className="hk tk" aria-hidden="true">{s.keys.eraser}</span>}
        </button>
      </div>
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y, transform: 'translateY(-50%)' }}>{tip.text}{tip.key && <kbd>{tip.key}</kbd>}</div>}
    </>
  );
}

// ---------- Found ----------

export function Found({ s }: { s: State }) {
  const list = A.foundList();
  if (s.phase !== 'edit' || A.eraserMode() || (!s.tool && !list.length)) return null;
  const empty = !list.length;
  return (
    <div id="found" className={`float${empty ? ' empty' : ''}`} aria-label="Found">
      <span className="found-l">{s.finding ? 'Finding…' : 'Found'}</span>
      {empty && !s.finding && <span className="none">None</span>}
      {list.map((t) => {
        const f = A.feature(t.feature)!;
        const on = s.psel.includes(t.key);
        return (
          <button
            key={t.key} type="button" className={`fchip${on ? ' on' : ''}`}
            aria-label={(s.tool ? 'Apply to ' : `${f.single}, `) + t.detail} aria-pressed={s.tool ? undefined : on}
            onMouseEnter={() => A.hoverItem({ kind: 'target', key: t.key })} onMouseLeave={() => A.hoverItem(null)}
            onClick={(e) => A.foundChipClick(t.key, { shift: e.shiftKey, alt: e.altKey })}
          >
            {!s.tool && <FeatureIcon icon={f.icon} />}{A.targetChip(t)}
          </button>
        );
      })}
      {!empty && <button type="button" className="pill-btn" onClick={A.applyAll}>Apply all</button>}
    </div>
  );
}

// ---------- the right pane ----------

export function Pane({ s }: { s: State }) {
  if (s.phase !== 'edit') return null;
  if (s.psel.length && s.draft) return <DraftPane s={s} />;
  const list = s.sel.map(A.editById).filter((e): e is A.Edit => !!e);
  if (!list.length) return null;
  const tools = [...new Set(list.map((e) => e.feature))];
  const f = tools.length === 1 ? A.feature(tools[0]) : null;
  const one = list.length === 1;
  const ids = list.map((e) => e.id);
  const status = list.map((e) => s.status[e.id]).filter(Boolean);
  return (
    <div id="pane" className="float" aria-label="Edit settings">
      <div className="ph">
        {f ? <FeatureIcon icon={f.icon} /> : Icon.edits}
        <span className="t">{one && f ? f.single : f ? `${list.length} ${f.plural}` : `${list.length} edits`}</span>
      </div>
      {one && <div className="detail">{list[0].target.detail}</div>}
      {one && f?.measures?.map((q) => (
        <MeasureControl key={q.k} q={q} idPrefix="m-" value={list[0].meas[q.k]} detected={list[0].detected[q.k]} onChange={(v) => A.setEditMeasure(list[0].id, q.k, v)} />
      ))}
      {f && f.params.filter((p) => visible(p, list.map((e) => e.v))).map((p) => {
        const vs = list.map((e) => e.v[p.k]);
        const same = vs.every((x) => x === vs[0]);
        return (
          <ParamControl key={p.k} p={p} idPrefix="e-" value={same ? vs[0] : MIXED} def={s.defaults[f.id][p.k]}
            onChange={(v, final) => A.setEditParam(ids, p.k, v, final)} onReset={() => A.resetEditParam(ids, p.k)} />
        );
      })}
      {list.some((e) => e.stale) && <div className="warn">Doesn’t apply in this orientation</div>}
      {status.map((st) => st.error && <div key={`e${st.id}`} className="warn">This edit failed: {st.error}</div>)}
      {[...new Set(status.flatMap((st) => st.warnings))].map((w) => <div key={w} className="warn">{w}</div>)}
      <button type="button" className="btn rm" onClick={() => A.removeIds(ids)}>
        {Icon.trash}{one ? 'Remove' : `Remove ${list.length}`}<Kbd k={s.keys.remove} />
      </button>
    </div>
  );
}

/** Settings for found targets picked with no tool: the same controls, with Apply instead of Remove. */
function DraftPane({ s }: { s: State }) {
  const d = s.draft!;
  const ts = s.psel.map(A.targetByKey).filter((t): t is A.FoundTarget => !!t);
  const f = d.tool ? A.feature(d.tool) : null;
  const one = ts.length === 1;
  return (
    <div id="pane" className="float" aria-label="Settings before applying">
      <div className="ph">
        {f ? <FeatureIcon icon={f.icon} /> : Icon.edits}
        <span className="t">{one && f ? f.single : f ? `${ts.length} ${f.plural}` : `${ts.length} found`}</span>
      </div>
      {one && <div className="detail">{ts[0].detail}</div>}
      {one && f?.measures?.map((q) => (
        <MeasureControl key={q.k} q={q} idPrefix="dm-" value={d.meas[ts[0].key]?.[q.k] ?? ts[0].measure[q.k]} detected={ts[0].measure[q.k]} onChange={(v) => A.setDraftMeasure(ts[0].key, q.k, v)} />
      ))}
      {f && f.params.filter((p) => visible(p, [d.v])).map((p) => (
        <ParamControl key={p.k} p={p} idPrefix="p-" value={d.v[p.k]} def={s.defaults[f.id][p.k]}
          onChange={(v, final) => A.setDraftParam(p.k, v, final)} onReset={() => A.setDraftParam(p.k, s.defaults[f.id][p.k], true)} />
      ))}
      <button type="button" className="btn pri rm" onClick={A.applyPicked}>{one ? 'Apply' : `Apply ${ts.length}`}<Kbd k={s.keys.apply} /></button>
    </div>
  );
}

// ---------- tool defaults (right-click a tool) ----------

export function Defaults({ s }: { s: State }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const f = s.defOpen ? A.feature(s.defOpen) : null;
  useLayoutEffect(() => {
    if (!f) return;
    const b = document.querySelector(`#rail [data-t="${f.id}"]`) as HTMLElement | null;
    const stage = document.getElementById('stage');
    if (!b || !stage || !ref.current) return;
    const sb = stage.getBoundingClientRect(), bb = b.getBoundingClientRect();
    setPos({ left: bb.right - sb.left + 12, top: Math.max(14, Math.min(bb.top - sb.top - 4, sb.height - ref.current.offsetHeight - 14)) });
  }, [f, s.minimal]);
  if (!f || s.phase !== 'edit') return null;
  const d = s.defaults[f.id], fac = s.factory[f.id];
  const n = A.unchanged(f.id).length;
  const same = Object.keys(fac).every((k) => fac[k] === d[k]);
  return (
    <div id="defs" ref={ref} className="float" role="dialog" aria-label={`${f.name} defaults`} style={pos ?? { visibility: 'hidden' }}>
      <div className="ph">
        <FeatureIcon icon={f.icon} /><span className="t">{f.name} defaults</span>
        <button type="button" className="x" aria-label="Close" onClick={() => A.setDefOpen(null)}>{Icon.close}</button>
      </div>
      {f.params.filter((p) => visible(p, [d])).map((p) => (
        <ParamControl key={p.k} p={p} idPrefix="d-" value={d[p.k]} def={fac[p.k]} onChange={(v, final) => A.setDefault(f.id, p.k, v, final)} onReset={() => A.setDefault(f.id, p.k, fac[p.k], true)} />
      ))}
      <div className="defs-foot">
        <button type="button" className="btn" disabled={!n} onClick={() => A.applyToUnchanged(f.id)}>Apply to unchanged edits ({n})</button>
        <button type="button" className="btn" disabled={same} onClick={() => A.resetDefaults(f.id)}>Reset all</button>
      </div>
    </div>
  );
}

// ---------- edits strip ----------

export function Edits({ s }: { s: State }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  if (s.phase !== 'edit') return null;
  const n = s.edits.length;
  return (
    <div id="edits" className="float" aria-label="Edits">
      {Icon.history}
      <span className="edits-l">{n ? `${n} ${n === 1 ? 'edit' : 'edits'}` : 'No edits'}</span>
      {n > 0 && (
        <div className="tiles">
          {s.edits.map((e) => {
            const f = A.feature(e.feature);
            if (!f) return null;
            const own = Object.keys(e.v).some((k) => e.v[k] !== s.defaults[e.feature]?.[k]);
            const st = s.status[e.id];
            const marked = e.stale || (st && (!st.ok || st.warnings.length > 0));
            const on = s.sel.includes(e.id);
            const label = `${f.single} · ${A.editChip(e)}`;
            return (
              <button
                key={e.id} type="button" className={`etile${on ? ' on' : ''}`} aria-label={label} aria-pressed={on}
                onMouseEnter={(ev) => { A.hoverItem({ kind: 'edit', id: e.id }); const r = ev.currentTarget.getBoundingClientRect(); setTip({ x: r.left + r.width / 2, y: r.top - 8, text: A.eraserMode() ? `Remove ${f.single.toLowerCase()}` : label }); }}
                onMouseLeave={() => { A.hoverItem(null); setTip(null); }}
                onClick={(ev) => { setTip(null); if (A.eraserMode()) A.removeIds([e.id]); else A.selectEdit(e.id, { shift: ev.shiftKey }, !ev.shiftKey); }}
              >
                <FeatureIcon icon={f.icon} />
                {own && <i className="dot" />}
                {marked && <i className="stale" />}
              </button>
            );
          })}
        </div>
      )}
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, -100%)' }}>{tip.text}</div>}
    </div>
  );
}

// ---------- part card ----------

const fmt1 = (x: number, d = 1) => x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

export function PartCard({ s, notes }: { s: State; notes: string[] }) {
  const r = s.result, o = s.overhangInfo;
  if (!r || !o) return null;
  const size = [r.max[0] - r.min[0], r.max[1] - r.min[1], r.max[2] - r.min[2]];
  const tooBig = size[0] > s.setup.bedW + 1e-6 || size[1] > s.setup.bedD + 1e-6;
  return (
    <div id="pane" className="float part" aria-label="Part">
      <div className="ph"><span className="t">Part</span>{s.composing && <span className="spin" aria-label="Updating" />}</div>
      <dl className="facts">
        <dt>Size</dt><dd>{fmt1(size[0])} × {fmt1(size[1])} × {fmt1(size[2])} mm</dd>
        <dt>Volume</dt><dd>{fmt1(r.volume / 1000)} cm³</dd>
        <dt>Triangles</dt><dd>{(r.tri.length / 3).toLocaleString()}</dd>
        <dt>On the bed</dt><dd>{fmt1(o.bedArea, 0)} mm²</dd>
        <dt>Overhangs</dt><dd><span className="swatch" />{fmt1(o.area, 0)} mm²</dd>
      </dl>
      {tooBig && <div className="warn">Larger than the bed</div>}
      {notes.length > 0 && (
        <div className="notes">
          <div className="dim">Repaired on import</div>
          <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
