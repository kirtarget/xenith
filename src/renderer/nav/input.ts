// Input sources → nav engine: Gamepad API polling (60 Hz, only when the UI owns the pads) and keyboard.
import { activate, dispatchAction, move, type Dir, type PadAction } from './engine';

export interface InputHooks {
  /** false while streaming with the overlay closed: pads belong to the console. */
  uiOwnsInput(): boolean;
  /** keyboard Esc / F1 while streaming with overlay closed */
  onStreamEscape(): void;
  onInput(kind: 'mouse' | 'keyboard' | 'gamepad'): void;
  onPadsChanged(): void;
}

const BTN: Array<[number, PadAction | Dir]> = [
  [0, 'a'], [1, 'b'], [2, 'x'], [3, 'y'], [4, 'lb'], [5, 'rb'], [6, 'lt'], [7, 'rt'], [8, 'view'], [9, 'menu'],
  [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'],
];
const DIRS = new Set<string>(['up', 'down', 'left', 'right']);
const REPEAT_DELAY = 380, REPEAT_EVERY = 95, STICK = 0.55;

function fire(k: PadAction | Dir): void {
  if (DIRS.has(k)) { move(k as Dir); return; }
  if (k === 'a') { if (!dispatchAction('a')) activate(); return; }
  dispatchAction(k as PadAction);
}

export function startInput(h: InputHooks): () => void {
  let raf = 0, last = 0;
  const held = new Map<string, number>();   // key → next repeat time
  let prev = new Set<string>();

  let owned = false;
  const poll = (t: number) => {
    raf = requestAnimationFrame(poll);
    if (t - last < 15) return;
    last = t;
    const owns = h.uiOwnsInput();
    if (!owns) { owned = false; return; }   // streaming: pads belong to the console, do not even read them
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const now = new Set<string>();
    for (const g of pads) {
      if (!g || !g.connected) continue;
      for (const [i, k] of BTN) { const b = g.buttons[i]; if (b && (i === 6 || i === 7 ? b.value > 0.5 : b.pressed)) now.add(k); }
      const x = g.axes[0] ?? 0, y = g.axes[1] ?? 0;
      if (Math.abs(x) > STICK && Math.abs(x) > Math.abs(y)) now.add(x > 0 ? 'right' : 'left');
      else if (Math.abs(y) > STICK) now.add(y > 0 ? 'down' : 'up');
    }
    if (!owned) { owned = true; prev = now; return; } // presses held across the hand-over must be released first
    if (now.size) {
      for (const k of now) {
        if (!prev.has(k)) {
          h.onInput('gamepad');
          fire(k as PadAction | Dir);
          held.set(k, t + REPEAT_DELAY);
        } else if (DIRS.has(k) && (held.get(k) ?? Infinity) <= t) {
          fire(k as Dir);
          held.set(k, t + REPEAT_EVERY);
        }
      }
    }
    for (const k of held.keys()) if (!now.has(k)) held.delete(k);
    prev = now;
  };
  raf = requestAnimationFrame(poll);

  const isText = (el: EventTarget | null) => el instanceof HTMLInputElement && (el.type === 'search' || el.type === 'text') || el instanceof HTMLTextAreaElement;

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!h.uiOwnsInput()) {
      if (e.key === 'Escape' || e.key === 'F1') { e.preventDefault(); h.onStreamEscape(); }
      return;
    }
    const text = isText(e.target);
    const k = e.key;
    let handled = true;
    if (k === 'ArrowUp' || k === 'ArrowDown') move(k === 'ArrowUp' ? 'up' : 'down');
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { if (text) handled = false; else move(k === 'ArrowLeft' ? 'left' : 'right'); }
    else if (k === 'Escape') { if (!dispatchAction('b') && text) (e.target as HTMLElement).blur(); }
    else if (k === 'Enter') {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement) handled = false; // native click
      else if (!dispatchAction('a')) activate();
    }
    else if (text) handled = false;
    else if (k === 'q' || k === 'Q' || k === 'PageUp') dispatchAction('lb');
    else if (k === 'e' || k === 'E' || k === 'PageDown') dispatchAction('rb');
    else if (k === '[' || k === 'z' || k === 'Z') dispatchAction('lt');
    else if (k === ']' || k === 'c' || k === 'C') dispatchAction('rt');
    else if (k === 'x' || k === 'X') dispatchAction('x');
    else if (k === 'y' || k === 'Y') dispatchAction('y');
    else if (k === 'm' || k === 'M') dispatchAction('menu');
    else handled = false;
    if (k === 'Tab') { h.onInput('keyboard'); return; }
    if (handled) { e.preventDefault(); h.onInput('keyboard'); }
  };
  const onMouse = () => h.onInput('mouse');
  // Mirror focus into an attribute: the gamepad ring must not depend on OS window focus (Gamescope, offscreen capture).
  const onFocusIn = (e: FocusEvent) => { const t = e.target as HTMLElement; if (t?.setAttribute) t.setAttribute('data-focused', ''); };
  const onFocusOut = (e: FocusEvent) => { const t = e.target as HTMLElement; if (t?.removeAttribute) t.removeAttribute('data-focused'); };
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  const onPads = () => h.onPadsChanged();

  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onMouse, { passive: true });
  window.addEventListener('wheel', onMouse, { passive: true });
  window.addEventListener('gamepadconnected', onPads);
  window.addEventListener('gamepaddisconnected', onPads);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerdown', onMouse);
    window.removeEventListener('wheel', onMouse);
    window.removeEventListener('gamepadconnected', onPads);
    window.removeEventListener('gamepaddisconnected', onPads);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
  };
}
