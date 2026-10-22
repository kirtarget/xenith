import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
export { cx };

// ─────────── Button ───────────
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 's' | 'm' | 'l' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  navId?: string;
  navDefault?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'm', icon, navId, navDefault, block, className, children, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-nav=""
      data-nav-id={navId}
      data-nav-default={navDefault ? '' : undefined}
      className={cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export function IconButton({ label, children, navId, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; navId?: string }) {
  return (
    <button type="button" data-nav="" data-nav-id={navId} aria-label={label} title={label} className={cx('icon-btn', className)} {...rest}>
      {children}
    </button>
  );
}

// ─────────── Toggle (real checkbox, switch role) ───────────
export function Toggle({ checked, onChange, label, labelledBy, disabled, navId }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string; labelledBy?: string; disabled?: boolean; navId?: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="toggle"
      data-nav=""
      data-nav-id={navId}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(e.currentTarget.checked)}
    />
  );
}

// ─────────── Segmented (radiogroup of real buttons) ───────────
export interface Option<T extends string> { value: T; label: string; disabled?: boolean }

export function Segmented<T extends string>({ value, options, onChange, labelledBy, label, grid, size = 'm', navIdPrefix }: {
  value: T; options: Option<T>[]; onChange: (v: T) => void; labelledBy?: string; label?: string; grid?: number; size?: 'm' | 'l'; navIdPrefix?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={cx('seg', size === 'l' && 'seg--l', !!grid && 'seg--grid')}
      style={grid ? { gridTemplateColumns: `repeat(${grid}, minmax(0, 1fr))` } : undefined}
      data-nav-region=""
    >
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          data-nav=""
          data-nav-id={navIdPrefix ? `${navIdPrefix}-${o.value}` : undefined}
          className="seg__opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─────────── Slider (native range + live value; gamepad left/right via navadjust) ───────────
export function Slider({ value, min, max, step = 1, onChange, format, id, label, labelledBy, disabled, width, navId }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string;
  id?: string; label?: string; labelledBy?: string; disabled?: boolean; width?: number | string; navId?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const auto = useId();
  const inputId = id ?? auto;
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const latest = useRef({ local, onChange, min, max, step });
  latest.current = { local, onChange, min, max, step };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onAdjust = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      const { local: v, min: lo, max: hi, step: st, onChange: cb } = latest.current;
      const next = Math.min(hi, Math.max(lo, +(v + d * st).toFixed(4)));
      if (next !== v) { setLocal(next); cb(next); }
    };
    el.addEventListener('navadjust', onAdjust);
    return () => el.removeEventListener('navadjust', onAdjust);
  }, []);

  const pct = ((local - min) / (max - min)) * 100;
  return (
    <span className={cx('slider', disabled && 'is-disabled')} style={{ width }}>
      <input
        ref={ref}
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-valuetext={format ? format(local) : undefined}
        data-nav=""
        data-nav-lr=""
        data-nav-id={navId}
        style={{ ['--fill' as string]: `${pct}%` }}
        onChange={e => { const v = Number(e.currentTarget.value); setLocal(v); onChange(v); }}
      />
      {format && <output htmlFor={inputId} className="slider__value">{format(local)}</output>}
    </span>
  );
}
