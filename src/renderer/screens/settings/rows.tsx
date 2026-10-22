// Declarative setting rows rendered two ways: desktop SettingRow (Settings mockup) and Deck list row (DeckSettings mockup).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RESTART_REQUIRED } from '../../../shared/api';
import { cx, Segmented, Slider, Toggle } from '../../components/controls';
import { SettingRow, useRowId } from '../../components/data';
import { ListSelect } from '../../components/overlays';
import { useI18n } from '../../i18n';
import { bootSettings, updateSettings } from '../../state/actions';
import { getPath, patchFromPath, useApp } from '../../state/store';

export interface Opt { value: string; label: string; hint?: string }

export type RowSpec =
  | { kind: 'group'; title: string; key?: string }
  | { kind: 'seg'; path: string; title: string; desc?: ReactNode; options: Opt[]; deckDesc?: string; disabled?: boolean; select?: boolean }
  | { kind: 'toggle'; path: string; title: string; desc?: ReactNode; deckTitle?: string; deckDesc?: string; disabled?: boolean }
  | { kind: 'slider'; path: string; title: string; desc?: ReactNode; min: number; max: number; step?: number; toUi?: (v: number) => number; fromUi?: (v: number) => number; format: (ui: number) => string; disabled?: boolean; width?: number }
  | { kind: 'custom'; key: string; desktop?: ReactNode; deck?: ReactNode };

function useSetting<T>(path: string): [T, (v: T) => void] {
  const v = useApp(s => getPath(s.settings, path)) as T;
  return [v, (nv: T) => updateSettings(patchFromPath(path, nv) as never)];
}

function useRestart(path: string, value: unknown): string | null {
  const { s } = useI18n();
  if (!RESTART_REQUIRED.includes(path)) return null;
  const boot = bootSettings();
  return boot && getPath(boot, path) !== value ? s.settings.restart : null;
}

// ─────────── desktop ───────────
function SegRowD({ spec, last }: { spec: Extract<RowSpec, { kind: 'seg' }>; last: boolean }) {
  const id = useRowId('seg');
  const [v, set] = useSetting<string>(spec.path);
  const restart = useRestart(spec.path, v);
  return (
    <SettingRow
      title={spec.title}
      titleId={id}
      desc={spec.desc}
      restart={restart}
      disabled={spec.disabled}
      last={last}
      control={spec.select
        ? <ListSelect value={v} options={spec.options} onChange={set} title={spec.title} labelledBy={id} navId={spec.path} disabled={spec.disabled} />
        : <Segmented value={v} options={spec.options.map(o => ({ ...o, disabled: spec.disabled }))} onChange={set} labelledBy={id} navIdPrefix={spec.path} />}
    />
  );
}

function ToggleRowD({ spec, last }: { spec: Extract<RowSpec, { kind: 'toggle' }>; last: boolean }) {
  const id = useRowId('tg');
  const [v, set] = useSetting<boolean>(spec.path);
  return (
    <label className={cx('row row--toggle', last && 'row--last', spec.disabled && 'is-disabled')}>
      <span className="row__text">
        <span id={id} className="row__title">{spec.title}</span>
        {spec.desc && <span className="row__desc">{spec.desc}</span>}
      </span>
      <span className="row__control"><Toggle checked={!!v} onChange={set} labelledBy={id} disabled={spec.disabled} navId={spec.path} /></span>
    </label>
  );
}

function SliderRowD({ spec, last }: { spec: Extract<RowSpec, { kind: 'slider' }>; last: boolean }) {
  const id = useRowId('sl');
  const [v, set] = useSetting<number>(spec.path);
  const toUi = spec.toUi ?? (x => x), fromUi = spec.fromUi ?? (x => x);
  return (
    <SettingRow
      title={spec.title}
      titleId={id}
      desc={spec.desc}
      disabled={spec.disabled}
      last={last}
      control={<Slider value={toUi(v)} min={spec.min} max={spec.max} step={spec.step} onChange={x => set(fromUi(x))} format={spec.format} labelledBy={id} disabled={spec.disabled} width={spec.width ?? 280} navId={spec.path} />}
    />
  );
}

export function DesktopRows({ rows }: { rows: RowSpec[] }) {
  const out: ReactNode[] = [];
  let group: { title: string; key: string; items: ReactNode[] } | null = null;
  const flush = () => {
    if (group) out.push(
      <section key={group.key} className="sgroup" aria-label={group.title}>
        {group.title && <h3 className="sgroup__title">{group.title}</h3>}
        {group.items}
      </section>,
    );
    group = null;
  };
  rows.forEach((r, i) => {
    if (r.kind === 'group') { flush(); group = { title: r.title, key: r.key ?? `g${i}`, items: [] }; return; }
    if (!group) group = { title: '', key: `g${i}`, items: [] };
    const next = rows[i + 1];
    const last = !next || next.kind === 'group';
    const key = r.kind === 'custom' ? r.key : r.path;
    let node: ReactNode = null;
    if (r.kind === 'seg') node = <SegRowD key={key} spec={r} last={last} />;
    else if (r.kind === 'toggle') node = <ToggleRowD key={key} spec={r} last={last} />;
    else if (r.kind === 'slider') node = <SliderRowD key={key} spec={r} last={last} />;
    else if (r.desktop) node = <div key={key} className="row-custom">{r.desktop}</div>;
    if (node) group.items.push(node);
  });
  flush();
  return <>{out}</>;
}

// ─────────── Deck ───────────
function useAdjust(onStep: (d: 1 | -1) => void) {
  const ref = useRef<HTMLButtonElement>(null);
  const cb = useRef(onStep);
  cb.current = onStep;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: Event) => cb.current((e as CustomEvent<number>).detail > 0 ? 1 : -1);
    el.addEventListener('navadjust', h);
    return () => el.removeEventListener('navadjust', h);
  }, []);
  return ref;
}

export function DeckRow({ title, desc, value, valueTone, onStep, onActivate, cycle, restart, disabled, navId }: {
  title: string; desc?: ReactNode; value?: ReactNode; valueTone?: 'ok'; onStep?: (d: 1 | -1) => void; onActivate?: () => void;
  cycle?: boolean; restart?: string | null; disabled?: boolean; navId?: string;
}) {
  const ref = useAdjust(d => onStep?.(d));
  return (
    <button
      ref={ref}
      type="button"
      className={cx('drow', disabled && 'is-disabled')}
      data-nav=""
      data-nav-lr={onStep ? '' : undefined}
      data-nav-id={navId}
      disabled={disabled}
      onClick={() => (onActivate ? onActivate() : onStep?.(1))}
    >
      <span className="drow__text">
        <span className="drow__title">{title}</span>
        {desc && <span className="drow__desc">{desc}</span>}
        {restart && <span className="row__restart">{restart}</span>}
      </span>
      {value != null && (
        <span className={cx('drow__value', valueTone === 'ok' && 'ok-text')}>
          {cycle && <span aria-hidden className="drow__chev">‹</span>}
          {value}
          {cycle && <span aria-hidden className="drow__chev">›</span>}
        </span>
      )}
    </button>
  );
}

function DeckSeg({ spec }: { spec: Extract<RowSpec, { kind: 'seg' }> }) {
  const [v, set] = useSetting<string>(spec.path);
  const restart = useRestart(spec.path, v);
  const i = Math.max(0, spec.options.findIndex(o => o.value === v));
  const step = (d: 1 | -1) => set(spec.options[(i + d + spec.options.length) % spec.options.length].value);
  return <DeckRow title={spec.title} desc={spec.deckDesc ?? spec.desc} value={spec.options[i]?.label} cycle onStep={step} restart={restart} disabled={spec.disabled} navId={spec.path} />;
}

function DeckToggle({ spec }: { spec: Extract<RowSpec, { kind: 'toggle' }> }) {
  const { s } = useI18n();
  const [v, set] = useSetting<boolean>(spec.path);
  return <DeckRow title={spec.deckTitle ?? spec.title} desc={spec.deckDesc ?? spec.desc} value={v ? s.common.yes : s.common.no} onActivate={() => set(!v)} onStep={() => set(!v)} disabled={spec.disabled} navId={spec.path} />;
}

function DeckSlider({ spec }: { spec: Extract<RowSpec, { kind: 'slider' }> }) {
  const [v, set] = useSetting<number>(spec.path);
  const toUi = spec.toUi ?? (x => x), fromUi = spec.fromUi ?? (x => x);
  const ui = toUi(v);
  const st = spec.step ?? 1;
  const step = (d: 1 | -1) => set(fromUi(Math.min(spec.max, Math.max(spec.min, +(ui + d * st).toFixed(4)))));
  return <DeckRow title={spec.title} desc={spec.desc} value={spec.format(ui)} cycle onStep={step} disabled={spec.disabled} navId={spec.path} />;
}

export function DeckRows({ rows }: { rows: RowSpec[] }) {
  return (
    <>
      {rows.map((r, i) => {
        if (r.kind === 'group') return i === 0 ? null : <h3 key={r.key ?? `g${i}`} className="dgroup">{r.title}</h3>;
        if (r.kind === 'seg') return <DeckSeg key={r.path} spec={r} />;
        if (r.kind === 'toggle') return <DeckToggle key={r.path} spec={r} />;
        if (r.kind === 'slider') return <DeckSlider key={r.path} spec={r} />;
        return r.deck !== undefined ? <div key={r.key} className="drow-custom">{r.deck}</div> : r.desktop ? <div key={r.key} className="drow-custom">{r.desktop}</div> : null;
      })}
    </>
  );
}

/** Simple local async loader used by sections. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): [T | null, () => void, boolean] {
  const [v, setV] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    fn().then(r => { if (alive) setV(r); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [n, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, () => setN(x => x + 1), failed];
}
