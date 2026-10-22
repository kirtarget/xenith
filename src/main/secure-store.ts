// Secure token storage. Uses Electron safeStorage (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux).
// Files: <userData>/secure/<name>.bin (msa_refresh.bin = MSA refresh token, token_cache.bin = short-lived tokens).
// Imports the refresh token produced by tools/auth-spike.mjs (raw DPAPI blob) once.
import { app, safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const secureDir = () => { const d = join(app.getPath('userData'), 'secure'); mkdirSync(d, { recursive: true }); return d; };
const file = (name: string) => join(secureDir(), name + '.bin');
const LEGACY_DONE = 'legacy_import_done';

// SteamOS: KWallet cannot start in gaming mode (kwalletd6 is D-Bus-activated without a display and aborts), so
// safeStorage is unavailable there, while desktop mode would use KWallet: tokens saved in one mode would not open in
// the other. On SteamOS (and any Linux without a working OS keyring) secrets are AES-256-GCM encrypted with a random
// per-user key kept in <userData>/secure/.key (mode 0600, directory 0700). Protection is file permissions, like
// Steam's own login tokens on the Deck. Windows/macOS always use the OS store.
const FILE_MAGIC = Buffer.from('XNF1');
const isSteamOS = () => process.platform === 'linux' && (process.env.SteamDeck === '1' ||
  (() => { try { return /ID=steamos/i.test(readFileSync('/etc/os-release', 'utf8')); } catch { return false; } })());
export function secretBackend(): 'os' | 'file' | 'none' {
  if (process.platform === 'linux' && (isSteamOS() || !safeStorage.isEncryptionAvailable())) return 'file';
  return safeStorage.isEncryptionAvailable() ? 'os' : 'none';
}
function fileKey(): Buffer {
  const d = secureDir(); try { chmodSync(d, 0o700); } catch { /* ignore */ }
  const k = join(d, '.key');
  if (existsSync(k)) { const b = readFileSync(k); if (b.length === 32) return b; }
  const key = randomBytes(32); writeFileSync(k, key, { mode: 0o600 }); return key;
}
function fileEncrypt(value: string): Buffer {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', fileKey(), iv);
  const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return Buffer.concat([FILE_MAGIC, iv, c.getAuthTag(), body]);
}
function fileDecrypt(b: Buffer): string {
  const iv = b.subarray(4, 16), tag = b.subarray(16, 32), d = createDecipheriv('aes-256-gcm', fileKey(), iv);
  d.setAuthTag(tag); return Buffer.concat([d.update(b.subarray(32)), d.final()]).toString('utf8');
}

export function saveSecret(name: string, value: string) {
  const backend = secretBackend();
  if (backend === 'none') throw new Error('OS secure storage unavailable');
  const f = file(name), tmp = f + '.tmp';
  writeFileSync(tmp, backend === 'file' ? fileEncrypt(value) : safeStorage.encryptString(value), { mode: 0o600 });
  renameSync(tmp, f);
}

export function loadSecret(name: string): string | null {
  if (!existsSync(file(name))) return null;
  const b = readFileSync(file(name));
  if (b.subarray(0, 4).equals(FILE_MAGIC)) return fileDecrypt(b);
  return safeStorage.decryptString(b);
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
