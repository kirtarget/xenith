// Small OS helpers (no electron). Everything is read-only.
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

export function run(cmd: string, args: string[], timeoutMs = 8000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** Runs a PowerShell script and parses its JSON output (null on any failure). */
export async function powershellJson<T = any>(script: string, timeoutMs = 15000): Promise<T | null> {
  const wrapped = `$ProgressPreference='SilentlyContinue';$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);${script}`;
  const encoded = Buffer.from(wrapped, 'utf16le').toString('base64');
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], timeoutMs);
  const text = r.stdout.trim();
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** `reg query` a single value. Returns the string data (REG_DWORD as decimal string) or null. */
export async function regGet(key: string, name: string): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const r = await run('reg', ['query', key, '/v', name]);
  if (!r.ok) return null;
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s+(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(line);
    if (m && m[1].toLowerCase() === name.toLowerCase()) {
      if (m[2] === 'REG_DWORD' || m[2] === 'REG_QWORD') return String(parseInt(m[3], 16));
      return m[3];
    }
  }
  return null;
}

/** Lower-cased process image names (without .exe on Windows). */
export async function processNames(): Promise<string[]> {
  if (process.platform === 'win32') {
    const r = await run('tasklist', ['/fo', 'csv', '/nh']);
    return r.stdout.split(/\r?\n/).map((l) => /^"([^"]+)"/.exec(l)?.[1] ?? '').filter(Boolean).map((n) => n.replace(/\.exe$/i, '').toLowerCase());
  }
  if (process.platform === 'linux') {
    const out: string[] = [];
    let pids: string[] = [];
    try { pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return out; }
    for (const p of pids) { try { out.push(readFileSync(`/proc/${p}/comm`, 'utf8').trim().toLowerCase()); } catch { /* gone */ } }
    return out;
  }
  const r = await run('ps', ['-axco', 'command']);
  return r.stdout.split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
