// Secure token storage. Uses Electron safeStorage (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux).
// Files: <userData>/secure/<name>.bin (msa_refresh.bin = MSA refresh token, token_cache.bin = short-lived tokens).
// Imports the refresh token produced by tools/auth-spike.mjs (raw DPAPI blob) once.
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const secureDir = () => { const d = join(app.getPath('userData'), 'secure'); mkdirSync(d, { recursive: true }); return d; };
const file = (name: string) => join(secureDir(), name + '.bin');
const LEGACY_DONE = 'legacy_import_done';

export function saveSecret(name: string, value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage unavailable');
  const f = file(name), tmp = f + '.tmp';
  writeFileSync(tmp, safeStorage.encryptString(value));
  renameSync(tmp, f);
}

export function loadSecret(name: string): string | null {
  if (existsSync(file(name))) return safeStorage.decryptString(readFileSync(file(name)));
  return null;
}

export function deleteSecret(name: string) {
  try { unlinkSync(file(name)); } catch { /* absent */ }
}

/** After sign-out (or a completed import) the Stage-1 legacy token must never be re-imported. */
export function markLegacyImportDone() {
  try { writeFileSync(join(secureDir(), LEGACY_DONE), new Date().toISOString()); } catch { /* ignore */ }
}

/** One-time import of the refresh token saved by the Stage-1 auth spike (raw DPAPI CurrentUser). */
export function importLegacyRefreshToken(): string | null {
  if (process.platform !== 'win32') return null;
  if (existsSync(join(secureDir(), LEGACY_DONE))) return null;
  const legacy = join(process.env.LOCALAPPDATA || '', 'Xenith', 'msa_refresh.bin');
  if (!existsSync(legacy)) return null;
  const ps = `Add-Type -AssemblyName System.Security; $b=[IO.File]::ReadAllBytes('${legacy.replace(/'/g, "''")}'); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  if (out) { saveSecret('msa_refresh', out); markLegacyImportDone(); }
  return out || null;
}
