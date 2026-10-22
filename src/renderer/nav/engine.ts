// Geometry-based spatial navigation over [data-nav] elements (DESIGN.md §6).
// Layers (screens, sheets, modals) register handlers; the top-most modal layer also scopes focus.

export type Dir = 'up' | 'down' | 'left' | 'right';
export type PadAction = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'menu' | 'view';
export type Handler = () => boolean | void;   // return false to let lower layers handle it
export type Handlers = Partial<Record<PadAction, Handler>>;

interface Layer { id: number; handlers: { current: Handlers }; scope: { current: HTMLElement | null } | null; modal: boolean }

const layers: Layer[] = [];
let layerSeq = 1;

export function pushLayer(handlers: { current: Handlers }, scope: { current: HTMLElement | null } | null, modal: boolean): () => void {
  const layer: Layer = { id: layerSeq++, handlers, scope, modal };
  layers.push(layer);
  return () => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); };
}

export function dispatchAction(a: PadAction): boolean {
  for (let i = layers.length - 1; i >= 0; i--) {
    const h = layers[i].handlers.current[a];
    if (h && h() !== false) return true;
    if (layers[i].modal) return a === 'b' ? false : true; // modal swallows everything else
  }
  return false;
}

export function activeScope(): HTMLElement {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.modal && l.scope?.current) return l.scope.current;
  }
  return (document.querySelector('[data-nav-root]') as HTMLElement) ?? document.body;
}

function visible(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('[inert],[hidden]')) return false;
  const anyEl = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (anyEl.checkVisibility && !anyEl.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function candidates(scope = activeScope()): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-nav]')).filter(visible);
}

export function focusEl(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  (el as HTMLElement & { focus(o?: { preventScroll?: boolean; focusVisible?: boolean }): void }).focus({ preventScroll: true, focusVisible: true });
  // focusin does not fire while the OS window is unfocused (Gamescope hand-off, offscreen) — mark explicitly.
  document.querySelectorAll('[data-focused]').forEach(n => { if (n !== el) n.removeAttribute('data-focused'); });
  if (document.activeElement === el) el.setAttribute('data-focused', '');
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return document.activeElement === el;
}

export function focusDefault(scope = activeScope()): boolean {
  const list = candidates(scope);
  const def = list.find(e => e.hasAttribute('data-nav-default'));
  return focusEl(def ?? list[0]);
}

export function focusById(id: string, scope = activeScope()): boolean {
  const el = scope.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(id)}"]`);
  return !!el && visible(el) && focusEl(el);
}

function currentFocus(scope: HTMLElement): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && scope.contains(a)) {
    const n = a.closest<HTMLElement>('[data-nav]');
    if (n && visible(n)) return n;
  }
  return null;
}

interface R { l: number; r: number; t: number; b: number; cx: number; cy: number }
const rect = (e: Element): R => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2 }; };

function score(from: R, to: R, dir: Dir): number {
  const E = 2; // tolerance for touching edges
  let primary: number, gap: number;
  switch (dir) {
    case 'right': if (to.l < from.r - E && to.cx <= from.cx + 1) return Infinity; primary = Math.max(0, to.l - from.r); gap = Math.max(0, Math.max(to.t, from.t) - Math.min(to.b, from.b)); break;
    case 'left': if (to.r > from.l + E && to.cx >= from.cx - 1) return Infinity; primary = Math.max(0, from.l - to.r); gap = Math.max(0, Math.max(to.t, from.t) - Math.min(to.b, from.b)); break;
    case 'down': if (to.t < from.b - E && to.cy <= from.cy + 1) return Infinity; primary = Math.max(0, to.t - from.b); gap = Math.max(0, Math.max(to.l, from.l) - Math.min(to.r, from.r)); break;
    case 'up': if (to.b > from.t + E && to.cy >= from.cy - 1) return Infinity; primary = Math.max(0, from.t - to.b); gap = Math.max(0, Math.max(to.l, from.l) - Math.min(to.r, from.r)); break;
  }
  const horizontal = dir === 'left' || dir === 'right';
  const centre = horizontal ? Math.abs(to.cy - from.cy) : Math.abs(to.cx - from.cx);
  return primary + gap * 4 + centre * 0.15;
}

function best(from: R, list: HTMLElement[], dir: Dir, self: HTMLElement): HTMLElement | null {
  let pick: HTMLElement | null = null, min = Infinity;
  for (const c of list) {
    if (c === self || c.contains(self) || self.contains(c)) continue;
    const s = score(from, rect(c), dir);
    if (s < min) { min = s; pick = c; }
  }
  return pick;
}

/** Returns true when focus moved or a control consumed the direction. */
export function move(dir: Dir): boolean {
  const scope = activeScope();
  const cur = currentFocus(scope);
  if (!cur) return focusDefault(scope);
  if ((dir === 'left' || dir === 'right') && cur.hasAttribute('data-nav-lr')) {
    cur.dispatchEvent(new CustomEvent('navadjust', { detail: dir === 'left' ? -1 : 1, bubbles: true }));
    return true;
  }
  if ((dir === 'up' || dir === 'down') && cur.hasAttribute('data-nav-ud')) {
    cur.dispatchEvent(new CustomEvent('navadjust', { detail: dir === 'up' ? 1 : -1, bubbles: true }));
    return true;
  }
  const all = candidates(scope);
  const from = rect(cur);
  const region = cur.closest<HTMLElement>('[data-nav-region]');
  if (region) {
    const inRegion = all.filter(c => region.contains(c));
    const hit = best(from, inRegion, dir, cur);
    if (hit) return focusEl(hit);
    const contain = region.getAttribute('data-nav-contain'); // 'v' | 'h' | 'all'
    if (contain === 'all' || (contain === 'v' && (dir === 'up' || dir === 'down')) || (contain === 'h' && (dir === 'left' || dir === 'right'))) return true;
  }
  const hit = best(from, all, dir, cur);
  return hit ? focusEl(hit) : false;
}

export function activate(): boolean {
  const scope = activeScope();
  const cur = currentFocus(scope);
  if (!cur) return focusDefault(scope);
  if (cur instanceof HTMLInputElement && (cur.type === 'checkbox' || cur.type === 'radio')) { cur.click(); return true; }
  if (cur instanceof HTMLInputElement && cur.type === 'range') { cur.dispatchEvent(new CustomEvent('navactivate', { bubbles: true })); return true; }
  cur.click();
  return true;
}

// ─────────── focus memory per screen ───────────
const memory = new Map<string, string>();
export function rememberFocus(key: string): void {
  const a = document.activeElement as HTMLElement | null;
  const id = a?.closest<HTMLElement>('[data-nav-id]')?.dataset.navId;
  if (id) memory.set(key, id);
}
export function restoreFocus(key: string): boolean {
  const id = memory.get(key);
  return (id ? focusById(id) : false) || focusDefault();
}
