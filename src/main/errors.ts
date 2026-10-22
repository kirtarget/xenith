// Maps internal errors to the contract's SessionErrorCode.
import type { SessionError, SessionErrorCode } from '../shared/api';
import { AuthError } from './xbox-auth';
import { GssvError } from './xhome-api';
import { redact } from './redact';

export class SessionFail extends Error {
  constructor(public code: SessionErrorCode, message: string) { super(message); this.name = 'SessionFail'; }
}

export function toSessionError(e: unknown, fallback: SessionErrorCode = 'unknown'): SessionError {
  const message = redact(String((e as any)?.message ?? e ?? 'error')).slice(0, 300);
  if (e instanceof SessionFail) return { code: e.code, message };
  if (e instanceof AuthError) {
    if (e.code === 'no_account') return { code: 'not_signed_in', message };
    if (e.code === 'no_cloud') return { code: 'no_cloud_entitlement', message };
    if (e.code === 'network') return { code: 'network', message };
    return { code: 'auth_expired', message };
  }
  if (e instanceof GssvError) {
    if (e.status === 0 && e.code === 'network') return { code: 'network', message };
    if (e.status === 401) return { code: 'auth_expired', message };
    return { code: fallback, message };
  }
  if ((e as any)?.name === 'TimeoutError' || /fetch failed/i.test(message)) return { code: 'network', message };
  return { code: fallback, message };
}

/** Error thrown back over IPC: message starts with the code so the renderer can parse it ("[code] message"). */
export function ipcError(err: SessionError): Error {
  const e = new Error(`[${err.code}] ${err.message}`);
  (e as any).code = err.code;
  return e;
}
