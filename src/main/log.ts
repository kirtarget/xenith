// JSONL logging to userData/logs. One file per app run (new file after 5 MB), keep the newest 20.
// Every line passes through scrub()/redact(): no tokens, Authorization headers or ice-pwd on disk.
import { app } from 'electron';
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { redact, scrub } from './redact';

export const LOG_PREFIX = 'xenith-';
const MAX_FILES = 20;
const MAX_BYTES = 5 * 1024 * 1024;

let file = '';
let bytes = 0;
let toConsole = process.env.XENITH_LOG_CONSOLE !== '0';

export function logsDir(): string { return join(app.getPath('userData'), 'logs'); }
export function currentLogFile(): string { return file; }
export function setConsoleLogging(on: boolean) { toConsole = on; }

/** Deletes the oldest Xenith core logs beyond MAX_FILES (other tools' logs in the folder are left alone). */
export function rotateLogs(dir: string, keep = MAX_FILES) {
  try {
    const files = readdirSync(dir).filter((f) => f.startsWith(LOG_PREFIX) && f.endsWith('.jsonl')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) { try { unlinkSync(join(dir, f)); } catch { /* in use */ } }
  } catch { /* no dir */ }
}

function openNew() {
  const dir = logsDir();
  mkdirSync(dir, { recursive: true });
  file = join(dir, `${LOG_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  bytes = 0;
  rotateLogs(dir, MAX_FILES - 1);
}

export type LogLevel = 'info' | 'warn' | 'error';

export function log(event: string, data?: unknown, level: LogLevel = 'info') {
  let line: string;
  try { line = redact(JSON.stringify({ t: new Date().toISOString(), level, event, data: data === undefined ? undefined : scrub(data) })); }
  catch { line = JSON.stringify({ t: new Date().toISOString(), level, event, data: '[unserializable]' }); }
  if (toConsole) console.log(line);
  try {
    if (!file || bytes > MAX_BYTES) openNew();
    appendFileSync(file, line + '\n');
    bytes += line.length + 1;
  } catch { /* logging must never throw */ }
}
export const logWarn = (event: string, data?: unknown) => log(event, data, 'warn');
export const logError = (event: string, data?: unknown) => log(event, data, 'error');
