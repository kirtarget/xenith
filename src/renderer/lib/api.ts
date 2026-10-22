// Typed access to window.xenith including CORE's additive extras (src/shared/core-additions.ts).
import type { SessionError, SessionErrorCode, XenithEvent } from '../../shared/api';
import type { XenithApiFull, XenithEventExt } from '../../shared/core-additions';

export const xapi = (): XenithApiFull => window.xenith as XenithApiFull;

/** Subscribe to main events including extension events (launchIntent). */
export function onXenithEvent(fn: (ev: XenithEventExt) => void): () => void {
  return window.xenith.on(fn as unknown as (ev: XenithEvent) => void);
}

const CODES: SessionErrorCode[] = ['not_signed_in', 'auth_expired', 'no_console', 'console_unreachable', 'console_busy', 'provision_failed', 'no_cloud_entitlement', 'ice_failed', 'stream_lost', 'network', 'unknown'];

/** IPC errors arrive as "[<SessionErrorCode>] message" (possibly wrapped by Electron's "Error invoking remote method …: Error: "). */
export function parseIpcError(e: unknown): SessionError {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\[([a-z_]+)\]\s*(.*)$/s);
  if (m && (CODES as string[]).includes(m[1])) return { code: m[1] as SessionErrorCode, message: m[2] };
  return { code: 'unknown', message: msg };
}

export function reportAudioOutputs(list: { deviceId: string; label: string }[]): void {
  try { xapi().reportAudioOutputs?.(list); } catch { /* older main */ }
}
