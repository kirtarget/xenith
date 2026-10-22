import { useState, type ReactNode } from 'react';
import { useApp } from '../state/store';
import { useI18n } from '../i18n';
import { cx } from './controls';
import { IconCheck, IconCross } from './Icons';

// ─────────── Rail (connection stages) ───────────
export interface RailItem { key: string; label: string; sub: string; status: 'past' | 'pending' | 'active' | 'done' | 'failed' }

export function Rail({ items, label, live, compact }: { items: RailItem[]; label: string; live?: boolean; compact?: boolean }) {
  return (
    <ol className={cx('rail', live ? 'rail--live' : 'rail--past', compact && 'rail--compact')} aria-label={label} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(it => (
        <li key={it.key} className={cx('rail__item', `is-${it.status}`)} aria-current={it.status === 'active' ? 'step' : undefined}>
          <span aria-hidden className="rail__bar">{it.status === 'active' && <span className="rail__run" />}</span>
          {live ? (
            <>
              <span className="rail__label">
                {it.status === 'done' && <IconCheck size={16} className="rail__icon" />}
                {it.status === 'failed' && <IconCross size={16} className="rail__icon rail__icon--bad" />}
                {it.label}
              </span>
              <span className="rail__sub">{it.sub}</span>
            </>
          ) : (
            <>
              <span className="rail__cap">{it.label}</span>
              <span className="rail__val">{it.sub}</span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

// ─────────── Sparkline ───────────
export function Sparkline({ points, label, height = 56 }: { points: number[]; label: string; height?: number }) {
  const W = 300, H = height, pad = 4;
  if (points.length < 2) return <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="spark" style={{ height }}><path d={`M0 ${H - 0.5} H${W}`} className="spark__base" /></svg>;
  const max = Math.max(...points), min = 0;
  const span = max - min || 1;
  const step = W / (points.length - 1);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(H - pad - ((v - min) / span) * (H - pad * 2)).toFixed(1)}`).join(' ');
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="spark" style={{ height }}>
      <path d={d} className="spark__line" vectorEffect="non-scaling-stroke" />
      <path d={`M0 ${H - 0.5} H${W}`} className="spark__base" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ─────────── SettingRow ───────────
let rowSeq = 0;
export function useRowId(prefix: string) { const [id] = useState(() => `${prefix}-${++rowSeq}`); return id; }

export function SettingRow({ title, desc, control, restart, disabled, titleId, last, stack }: {
  title: string; desc?: ReactNode; control: ReactNode; restart?: string | null; disabled?: boolean; titleId?: string; last?: boolean; stack?: boolean;
}) {
  return (
    <div className={cx('row', disabled && 'is-disabled', last && 'row--last', stack && 'row--stack')}>
      <div className="row__text">
        <span id={titleId} className="row__title">{title}</span>
        {desc && <span className="row__desc">{desc}</span>}
        {restart && <span className="row__restart">{restart}</span>}
      </div>
      <div className="row__control">{control}</div>
    </div>
  );
}

// ─────────── CoverCard ───────────
export function CoverCard({ name, meta, coverUrl, onOpen, navId, label }: {
  name: string; meta: string; coverUrl: string | null; onOpen: () => void; navId: string; label: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <article className="cover">
      <button type="button" className="cover__art" data-nav="" data-nav-id={navId} aria-label={label} onClick={onOpen}>
        {coverUrl && !failed
          ? <img src={coverUrl} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
          : <span aria-hidden className="cover__ph">{initials}</span>}
      </button>
      <div className="cover__text">
        <span className="cover__name" title={name}>{name}</span>
        <span className="cover__meta">{meta}</span>
      </div>
    </article>
  );
}

// ─────────── KeyHint / HintBar ───────────
export type HintKey = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lbrb' | 'ltrt' | 'menu' | 'lr';
export interface Hint { k: HintKey; label: string }

function glyph(k: HintKey, input: 'mouse' | 'keyboard' | 'gamepad', deck: boolean, isDeckHw: boolean): string {
  const pad = input === 'gamepad' || (deck && input !== 'keyboard');
  if (pad) {
    const l = isDeckHw || deck ? 'L1' : 'LB', r = isDeckHw || deck ? 'R1' : 'RB';
    return ({ a: 'A', b: 'B', x: 'X', y: 'Y', lb: l, rb: r, lbrb: `${l} ${r}`, ltrt: isDeckHw || deck ? 'L2 R2' : 'LT RT', menu: '☰', lr: '‹ ›' } as Record<HintKey, string>)[k];
  }
  return ({ a: 'Enter', b: 'Esc', x: 'X', y: 'Y', lb: 'Q', rb: 'E', lbrb: 'Q E', ltrt: '[ ]', menu: 'M', lr: '← →' } as Record<HintKey, string>)[k];
}

export function KeyHint({ k, label }: Hint) {
  const input = useApp(s => s.input);
  const deck = useApp(s => s.deck);
  const hw = useApp(s => !!s.platform?.isSteamDeck);
  const g = glyph(k, input, deck, hw);
  if (deck) {
    const round = g.length === 1;
    return (
      <span className="dhint">
        <span aria-hidden className={cx('dhint__key', round ? 'dhint__key--round' : 'dhint__key--pill', k === 'a' && 'dhint__key--a')}>{g}</span>
        <span className="dhint__label">{label}</span>
      </span>
    );
  }
  return <span className="hint"><b>{g}</b> {label}</span>;
}

export function HintBar({ hints }: { hints: Hint[] }) {
  const deck = useApp(s => s.deck);
  const { s } = useI18n();
  return (
    <footer className={deck ? 'dhints' : 'hints'} aria-label={s.hints.aria}>
      {hints.map(h => <KeyHint key={h.k + h.label} {...h} />)}
    </footer>
  );
}

export function useHints() { return useI18n().s.hints; }
