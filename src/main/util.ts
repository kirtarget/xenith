// Small shared helpers for the main process (no Electron imports — safe for unit tests).
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

/** Sleep that resolves early (without throwing) when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Atomic JSON write: write a temp file next to the target, then rename over it. */
export function writeJsonAtomic(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try { renameSync(tmp, file); } catch (e) { try { unlinkSync(tmp); } catch { /* ignore */ } throw e; }
}

export function readJson<T = unknown>(file: string): T | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function randomId(): string {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Races a promise against a timeout; resolves undefined on timeout instead of rejecting. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<undefined>((r) => { t = setTimeout(() => r(undefined), ms); })]);
  } finally { if (t) clearTimeout(t); }
}
