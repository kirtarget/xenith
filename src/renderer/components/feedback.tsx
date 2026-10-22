import type { CSSProperties, ReactNode } from 'react';
import { useApp } from '../state/store';
import { cx } from './controls';

export type Tone = 'ok' | 'warn' | 'bad' | 'idle';

export function StatusDot({ tone, size = 8, className }: { tone: Tone; size?: number; className?: string }) {
  return <span aria-hidden className={cx('dot', `dot--${tone}`, className)} style={{ width: size, height: size, borderRadius: size / 2 }} />;
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cx('badge', `badge--${tone}`)}>{children}</span>;
}

export function Skeleton({ w, h, r = 8, style, className }: { w?: number | string; h: number | string; r?: number; style?: CSSProperties; className?: string }) {
  return <span aria-hidden className={cx('skel', className)} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function ToastHost() {
  const toasts = useApp(s => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={cx('toast', `toast--${t.tone}`)}>
          <StatusDot tone={t.tone === 'info' ? 'idle' : t.tone} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/** States mockup card: dot, title, body, the one action that fixes it. */
export function EmptyState({ tone, title, body, actions, className, live }: {
  tone: Tone; title: string; body: ReactNode; actions?: ReactNode; className?: string; live?: boolean;
}) {
  return (
    <section className={cx('state', className)} aria-live={live ? 'polite' : undefined}>
      <StatusDot tone={tone} size={10} />
      <h2 className="state__title">{title}</h2>
      <p className="state__body">{body}</p>
      {actions && <div className="state__actions">{actions}</div>}
    </section>
  );
}
