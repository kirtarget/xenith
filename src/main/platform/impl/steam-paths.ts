// Locating Steam and its users. Read-only, no electron.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { regGet } from './sys';
import { accountIdFromSteamId64 } from './steam-ids';

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

export function linuxSteamCandidates(home = homedir()): string[] {
  return [
    join(home, '.steam/steam'),                                         // symlink maintained by the Steam runtime
    join(home, '.local/share/Steam'),                                    // native install / SteamOS
    join(home, '.steam/root'),
    join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam'),   // Flatpak
    join(home, '.var/app/com.valvesoftware.Steam/.steam/steam'),
  ];
}

/** Steam root directory (contains steamapps/, userdata/), or null. XENITH_STEAM_ROOT overrides (tests). */
export async function findSteamRoot(): Promise<string | null> {
  const override = process.env.XENITH_STEAM_ROOT;
  if (override) return isDir(override) ? override : null;
  if (process.platform === 'win32') {
    const candidates = [
      await regGet('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
      await regGet('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
      await regGet('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
      process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)']!, 'Steam') : null,
    ];
    for (const c of candidates) if (c && isDir(c)) return c.replace(/\//g, '\\');
    return null;
  }
  if (process.platform === 'darwin') {
    const p = join(homedir(), 'Library/Application Support/Steam');
    return isDir(p) ? p : null;
  }
  const seen = new Set<string>();
  for (const c of linuxSteamCandidates()) {
    let real = c;
    try { real = realpathSync(c); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    if (isDir(join(real, 'userdata')) || existsSync(join(real, 'steam.sh'))) return real;
  }
  return null;
}

export function userIds(root: string): string[] {
  try {
    return readdirSync(join(root, 'userdata')).filter((n) => /^\d+$/.test(n) && n !== '0' && isDir(join(root, 'userdata', n)));
  } catch { return []; }
}

/** Account id (userdata folder) of the logged-in or most recent user, if determinable. */
export async function activeUserId(root: string): Promise<string | null> {
  if (process.platform === 'win32' && !process.env.XENITH_STEAM_ROOT) {
    const v = await regGet('HKCU\\Software\\Valve\\Steam\\ActiveProcess', 'ActiveUser');
    if (v && v !== '0') return v;
  }
  if (process.platform === 'linux' && !process.env.XENITH_STEAM_ROOT) {
    for (const f of [join(homedir(), '.steam/registry.vdf'), join(homedir(), '.var/app/com.valvesoftware.Steam/.steam/registry.vdf')]) {
      try {
        const m = /"ActiveUser"\s+"(\d+)"/i.exec(readFileSync(f, 'utf8'));
        if (m && m[1] !== '0') return m[1];
      } catch { /* none */ }
    }
  }
  try {
    const text = readFileSync(join(root, 'config', 'loginusers.vdf'), 'utf8');
    // "users" { "7656119..." { ... "MostRecent" "1" ... } }
    const re = /"(\d{17})"\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    let first: string | null = null;
    while ((m = re.exec(text))) {
      const id = accountIdFromSteamId64(m[1]);
      first ??= id;
      if (/"MostRecent"\s+"1"/i.test(m[2])) return id;
    }
    return first;
  } catch { return null; }
}

/** Users we write shortcuts for: the active user if known, else every userdata folder. */
export async function targetUserIds(root: string): Promise<string[]> {
  const all = userIds(root);
  const active = await activeUserId(root);
  if (active && all.includes(active)) return [active];
  return all;
}

export const shortcutsPath = (root: string, uid: string) => join(root, 'userdata', uid, 'config', 'shortcuts.vdf');
export const gridDir = (root: string, uid: string) => join(root, 'userdata', uid, 'config', 'grid');
