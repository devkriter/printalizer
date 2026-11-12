// Setting controls shared by the edit pane, the settings-before-apply pane and the defaults pane.
// A notch marks the default; a reset arrow appears only once the value has moved from it.
import { useState } from 'react';
import type { MeasureSpec, ParamSpec } from '../../../feature-api/index.ts';

export const MIXED = Symbol('mixed');
type Val = number | string | typeof MIXED;

const RESET = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" /></svg>;

export function fmt(p: ParamSpec, v: number | string) {
  if (p.type !== 'number') return String(v);
  return (p.dp != null ? (+v).toFixed(p.dp) : String(+(+v).toFixed(3))) + (p.unit ?? '');
}

export function FeatureIcon({ icon }: { icon: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }} />;
}

export function ParamControl({ p, value, def, onChange, onReset, idPrefix }: {
  p: ParamSpec;
  value: Val;
  def: number | string;
  /** final is false while a slider is being dragged. */
  onChange: (v: number | string, final: boolean) => void;
  onReset: () => void;
  idPrefix: string;
}) {
  const mixed = value === MIXED;
  const id = idPrefix + p.k;
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? (mixed ? null : value);
  const changed = mixed || (shown !== null && shown !== def);
  const reset = (
    <button type="button" className={`rst${changed ? ' show' : ''}`} title={`Reset to ${fmt(p, def)}`} aria-label={`Reset ${p.label}`} onClick={onReset}>{RESET}</button>
  );
  if (p.type === 'choice') {
    return (
      <div className="f">
        <div className="fl"><span className="lab">{p.label}</span>{mixed && <span className="v mixed">Mixed</span>}{reset}</div>
        <div className="seg" role="group" aria-label={p.label}>
          {p.options.map((o) => (
            <button key={o} type="button" className={!mixed && o === value ? 'on' : ''} aria-pressed={!mixed && o === value} onClick={() => { if (o !== value) onChange(o, true); }}>{o}</button>
          ))}
        </div>
      </div>
    );
  }
  const frac = (x: number) => (x - p.min) / (p.max - p.min);
  const cur = shown === null ? (def as number) : (shown as number);
  const finish = () => { if (drag !== null) { onChange(drag, true); setDrag(null); } };
  return (
    <div className="f">
      <div className="fl">
        <label className="lab" htmlFor={id}>{p.label}</label>
        <span className={`v${mixed && drag === null ? ' mixed' : ''}`}>{mixed && drag === null ? 'Mixed' : fmt(p, cur)}</span>
        {reset}
      </div>
      <div className={`rng${mixed && drag === null ? ' mixed' : ''}`} style={{ ['--v' as string]: frac(cur), ['--d' as string]: frac(def as number) }}>
        <span className="notch" />
        <input
          id={id} type="range" min={p.min} max={p.max} step={p.step} value={cur}
          onChange={(e) => {
            let x = +e.target.value;
            // Snap softly to the default so returning by hand is easy.
            if (Math.abs(x - (def as number)) < (p.max - p.min) * 0.03) x = def as number;
            setDrag(x);
            onChange(x, false);
          }}
          onPointerUp={finish} onKeyUp={finish} onBlur={finish}
        />
      </div>
    </div>
  );
}

export function MeasureControl({ q, value, detected, onChange, idPrefix }: {
  q: MeasureSpec;
  value: number | string;
  detected: number | string;
  onChange: (v: number | string) => void;
  idPrefix: string;
}) {
  const id = idPrefix + q.k;
  const changed = value !== detected;
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="fl meas">
      <label className="lab" htmlFor={id}>{q.label}</label>
      {q.type === 'number' ? (
        <>
          <input
            id={id} type="number" min={q.min} max={q.max} step={q.step}
            value={text ?? String(+(+value).toFixed(2))}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (text === null) return;
              const x = parseFloat(text);
              setText(null);
              if (Number.isFinite(x)) onChange(Math.max(q.min, Math.min(q.max, Math.round(x * 100) / 100)));
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
          <span className="u">{q.unit ?? ''}</span>
        </>
      ) : (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {(q.options.includes(String(value)) ? q.options : [String(value), ...q.options]).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      <button type="button" className={`rst${changed ? ' show' : ''}`} title="Reset to measured value" aria-label={`Reset ${q.label} to measured value`} onClick={() => onChange(detected)}>{RESET}</button>
    </div>
  );
}

/** Whether a setting shows, given the values it depends on (all must agree). */
export function visible(p: ParamSpec, values: Array<Record<string, number | string>>) {
  if (!p.showIf) return true;
  return values.every((v) => v[p.showIf!.k] === p.showIf!.eq);
}
