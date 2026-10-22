// In-process event bus; main.ts forwards every event to the renderer on 'xenith:event'.
import type { XenithEventExt } from '../shared/core-additions';

type Listener = (ev: XenithEventExt) => void;
const listeners = new Set<Listener>();

export function onEvent(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

export function emit(ev: XenithEventExt) {
  for (const l of listeners) { try { l(ev); } catch { /* listener errors never break the emitter */ } }
}
