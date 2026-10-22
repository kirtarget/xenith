import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { focusDefault, focusEl, pushLayer, rememberFocus, restoreFocus, type Handlers } from './engine';
import { getState } from '../state/store';

/** Register screen/sheet/modal actions. Latest handlers are always used; the layer lives while mounted. */
export function useNavLayer(handlers: Handlers, opts: { scope?: RefObject<HTMLElement | null>; modal?: boolean; enabled?: boolean } = {}): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  const enabled = opts.enabled ?? true;
  useLayoutEffect(() => {
    if (!enabled) return;
    return pushLayer(ref, opts.scope ?? null, !!opts.modal);
  }, [enabled, opts.modal]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Default focus for a screen, restored when the user comes back to it. */
export function useScreenFocus(key: string, ready = true): void {
  useEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => {
      if (getState().input === 'mouse' && document.activeElement && document.activeElement !== document.body) return;
      restoreFocus(key);
    });
    return () => { cancelAnimationFrame(id); rememberFocus(key); };
  }, [key, ready]);
}

/** Sheets and modals: focus inside on open, give focus back to the opener on close. */
export function useFocusTrap(scope: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => { if (scope.current) focusDefault(scope.current); });
    return () => {
      cancelAnimationFrame(id);
      if (opener && opener.isConnected) requestAnimationFrame(() => focusEl(opener));
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
