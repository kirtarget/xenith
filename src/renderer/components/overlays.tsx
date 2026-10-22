import { useRef, useState, type ReactNode } from 'react';
import { useFocusTrap, useNavLayer } from '../nav/hooks';
import { useI18n } from '../i18n';
import { Button, cx, IconButton } from './controls';
import { IconCheck, IconClose } from './Icons';

/** Side sheet from the right edge (never covers the centre of the stream). */
export function Sheet({ open, title, onClose, children, footer, width, labelledById }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; labelledById?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { s } = useI18n();
  useNavLayer({ b: () => { onClose(); return true; } }, { scope: ref, modal: true, enabled: open });
  useFocusTrap(ref, open);
  if (!open) return null;
  const tid = labelledById ?? 'sheet-title';
  return (
    <div className="layer" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-labelledby={tid} style={width ? { width } : undefined}>
        <header className="sheet__head">
          <h2 id={tid} className="sheet__title">{title}</h2>
          <IconButton label={s.common.close} onClick={onClose}><IconClose /></IconButton>
        </header>
        <div className="sheet__body">{children}</div>
        {footer && <footer className="sheet__foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Confirm dialog. Destructive actions get the danger button and default focus on cancel. */
export function Modal({ open, title, body, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean;
  onConfirm: () => void | Promise<void>; onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { s } = useI18n();
  const [busy, setBusy] = useState(false);
  useNavLayer({ b: () => { onCancel(); return true; } }, { scope: ref, modal: true, enabled: open });
  useFocusTrap(ref, open);
  if (!open) return null;
  return (
    <div className="layer layer--center">
      <div ref={ref} className="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-body">
        <h2 id="modal-title" className="modal__title">{title}</h2>
        <p id="modal-body" className="modal__body">{body}</p>
        <div className="modal__actions">
          <Button variant="outline" size="l" navDefault={danger} onClick={onCancel}>{cancelLabel ?? s.common.cancel}</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            size="l"
            navDefault={!danger}
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface ListOption<T extends string> { value: T; label: string; hint?: string }

/** Gamepad-friendly select: a button showing the value; A opens a sheet with the options. */
export function ListSelect<T extends string>({ value, options, onChange, title, labelledBy, navId, minWidth = 260, disabled, buttonLabel }: {
  value: T; options: ListOption<T>[]; onChange: (v: T) => void; title: string; labelledBy?: string; navId?: string; minWidth?: number; disabled?: boolean;
  /** Render as an outline button with this label (e.g. «Сменить консоль») instead of a value box. */
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find(o => o.value === value);
  return (
    <>
      {buttonLabel ? (
        <Button variant="outline" navId={navId} disabled={disabled} aria-haspopup="listbox" onClick={() => setOpen(true)}>{buttonLabel}</Button>
      ) : <button
        type="button"
        className="select"
        data-nav=""
        data-nav-id={navId}
        aria-haspopup="listbox"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : title}
        disabled={disabled}
        style={{ minWidth }}
        onClick={() => setOpen(true)}
      >
        <span className="select__value">{cur?.label ?? value}</span>
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10l5 5 5-5" /></svg>
      </button>}
      <Sheet open={open} title={title} onClose={() => setOpen(false)} labelledById="list-title">
        <div role="listbox" aria-labelledby="list-title" className="options">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              data-nav=""
              data-nav-default={o.value === value ? '' : undefined}
              className={cx('option', o.value === value && 'is-selected')}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span className="option__text">
                <span>{o.label}</span>
                {o.hint && <span className="option__hint">{o.hint}</span>}
              </span>
              {o.value === value && <IconCheck size={18} className="option__check" />}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
