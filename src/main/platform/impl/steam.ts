// Steam integration: library shortcut, per-title xCloud shortcuts, grid artwork. Mirrors what XBPlay offers,
// implemented from Steam's public file formats only.
import { app, nativeImage, net } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CloudTitle, Settings, SteamStatus } from '../../../shared/api';
import { listShortcuts, parseShortcuts, serializeShortcuts, ShortcutSpec, ShortcutView, upsertShortcut, xcloudTitleIdOf } from './shortcuts';
import { findSteamRoot, gridDir, shortcutsPath, targetUserIds, userIds } from './steam-paths';
import { processNames } from './sys';

export const LIBRARY_NAME = 'Xenith';
export const CLOUD_PREFIX = 'Xenith: ';
export const TAG = 'Xenith';

const MSG = {
  noSteam: 'Steam не найден.',
  noUsers: 'В Steam нет ни одного пользователя. Войдите в Steam и повторите.',
  doneRunning: 'Готово. Перезапустите Steam, чтобы увидеть ярлык.',
  doneStopped: 'Готово. Ярлык появится при следующем запуске Steam.',
  failed: (e: string) => `Не удалось записать ярлык: ${e}`,
};

const quote = (p: string) => `"${p}"`;

/** The executable Steam should start. Packaged: the installed exe / AppImage. Dev: electron + app path. */
export function xenithLaunchTarget(): { exe: string; startDir: string; argsPrefix: string; packaged: boolean } {
  const env = process.env;
  if (process.platform === 'linux' && env.APPIMAGE) return { exe: env.APPIMAGE, startDir: dirname(env.APPIMAGE), argsPrefix: '', packaged: true };
  if (process.platform === 'win32' && env.PORTABLE_EXECUTABLE_FILE) return { exe: env.PORTABLE_EXECUTABLE_FILE, startDir: dirname(env.PORTABLE_EXECUTABLE_FILE), argsPrefix: '', packaged: true };
  if (app.isPackaged) return { exe: process.execPath, startDir: dirname(process.execPath), argsPrefix: '', packaged: true };
  const appPath = app.getAppPath();
  return { exe: process.execPath, startDir: appPath, argsPrefix: `${quote(appPath)} `, packaged: false };
}

function readDoc(file: string) {
  return parseShortcuts(existsSync(file) ? readFileSync(file) : null);
}

/** Atomic write with a one-time backup of the user's original file (shortcuts.vdf.xenith-backup). */
function writeDoc(file: string, bytes: Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  const backup = `${file}.xenith-backup`;
  if (existsSync(file) && !existsSync(backup)) copyFileSync(file, backup);
  const tmp = `${file}.xenith-tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}

const isOurs = (s: ShortcutView) => s.tags.includes(TAG) || s.appName === LIBRARY_NAME || s.appName.startsWith(CLOUD_PREFIX);

export interface SteamDeps { getSettings?: () => Settings | null }

export function createSteam(deps: SteamDeps = {}) {
  async function isRunning(): Promise<boolean> {
    const names = await processNames();
    return names.includes('steam') || names.includes('steamwebhelper');
  }

  async function forEachTarget(fn: (file: string, uid: string, root: string) => void): Promise<{ ok: boolean; message: string }> {
    const root = await findSteamRoot();
    if (!root) return { ok: false, message: MSG.noSteam };
    const users = await targetUserIds(root);
    if (!users.length) return { ok: false, message: MSG.noUsers };
    try {
      for (const uid of users) fn(shortcutsPath(root, uid), uid, root);
    } catch (e: any) {
      return { ok: false, message: MSG.failed(e?.message ?? String(e)) };
    }
    return { ok: true, message: (await isRunning()) ? MSG.doneRunning : MSG.doneStopped };
  }

  function librarySpec(): ShortcutSpec {
    const t = xenithLaunchTarget();
    return { appName: LIBRARY_NAME, exe: quote(t.exe), startDir: quote(t.startDir), icon: t.exe, launchOptions: t.argsPrefix.trim(), tags: [TAG] };
  }
  function cloudSpec(title: CloudTitle): ShortcutSpec {
    const t = xenithLaunchTarget();
    return { appName: `${CLOUD_PREFIX}${title.name}`, exe: quote(t.exe), startDir: quote(t.startDir), icon: t.exe, launchOptions: `${t.argsPrefix}--xcloud=${title.titleId}`, tags: [TAG, 'Xbox Cloud'] };
  }

  async function allShortcuts(): Promise<Array<{ uid: string; root: string; s: ShortcutView }>> {
    const root = await findSteamRoot();
    if (!root) return [];
    const out: Array<{ uid: string; root: string; s: ShortcutView }> = [];
    for (const uid of await targetUserIds(root)) {
      try { for (const s of listShortcuts(readDoc(shortcutsPath(root, uid)))) out.push({ uid, root, s }); } catch { /* unreadable file: skip */ }
    }
    return out;
  }

  async function status(): Promise<SteamStatus> {
    const root = await findSteamRoot();
    if (!root) return { installed: false, running: false, userIds: [], libraryShortcut: false };
    const list = await allShortcuts();
    return {
      installed: true,
      running: await isRunning(),
      userIds: userIds(root),
      libraryShortcut: list.some(({ s }) => s.appName === LIBRARY_NAME && !xcloudTitleIdOf(s)),
    };
  }

  async function addLibraryShortcut() {
    const spec = librarySpec();
    return forEachTarget((file) => {
      const doc = readDoc(file);
      upsertShortcut(doc, spec, (s) => s.appName === LIBRARY_NAME && !xcloudTitleIdOf(s));
      writeDoc(file, serializeShortcuts(doc));
    });
  }

  async function addCloudShortcut(title: CloudTitle) {
    const spec = cloudSpec(title);
    const targets: Array<{ root: string; uid: string; appid: number }> = [];
    const res = await forEachTarget((file, uid, root) => {
      const doc = readDoc(file);
      const { appid } = upsertShortcut(doc, spec, (s) => isOurs(s) && xcloudTitleIdOf(s) === title.titleId);
      writeDoc(file, serializeShortcuts(doc));
      targets.push({ root, uid, appid });
    });
    if (res.ok && artworkEnabled()) for (const t of targets) await writeArtwork(gridDir(t.root, t.uid), t.appid, title).catch(() => 0);
    return res;
  }

  function artworkEnabled() {
    return (deps.getSettings?.()?.steam.artworkSource ?? 'xcloud') !== 'none';
  }

  async function resyncArtwork(titles: CloudTitle[]) {
    if (!artworkEnabled()) return { ok: true, count: 0 };
    const byId = new Map(titles.map((t) => [t.titleId, t]));
    let count = 0;
    for (const { uid, root, s } of await allShortcuts()) {
      if (!isOurs(s)) continue;
      const tid = xcloudTitleIdOf(s);
      const title = tid ? byId.get(tid) : undefined;
      if (title && (await writeArtwork(gridDir(root, uid), s.appid, title).catch(() => 0)) > 0) count++;
    }
    return { ok: true, count };
  }

  async function shortcutTitleIds(): Promise<string[]> {
    const ids = new Set<string>();
    for (const { s } of await allShortcuts()) { const t = isOurs(s) ? xcloudTitleIdOf(s) : null; if (t) ids.add(t); }
    return [...ids];
  }

  return { status, addLibraryShortcut, addCloudShortcut, resyncArtwork, shortcutTitleIds };
}

// ─── artwork ───

/** Steam grid sizes: portrait capsule 600×900 (<appid>p), hero 3840×1240 → we write 1920×620 (<appid>_hero),
 *  wide capsule 920×430 (<appid>). Images are centre-cropped to the aspect ratio, then resized, saved as JPEG. */
export const GRID_SLOTS = [
  { suffix: 'p', w: 600, h: 900, src: 'cover' as const },
  { suffix: '_hero', w: 1920, h: 620, src: 'hero' as const },
  { suffix: '', w: 920, h: 430, src: 'hero' as const },
];

async function fetchImage(url: string): Promise<Electron.NativeImage | null> {
  try {
    const r = await net.fetch(url);
    if (!r.ok) return null;
    const img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
    return img.isEmpty() ? null : img;
  } catch { return null; }
}

export function cropRect(srcW: number, srcH: number, w: number, h: number) {
  const target = w / h;
  if (srcW / srcH > target) { const cw = Math.round(srcH * target); return { x: Math.round((srcW - cw) / 2), y: 0, width: cw, height: srcH }; }
  const ch = Math.round(srcW / target);
  return { x: 0, y: Math.round((srcH - ch) / 2), width: srcW, height: ch };
}

export async function writeArtwork(dir: string, appid: number, title: Pick<CloudTitle, 'coverUrl' | 'heroUrl'>): Promise<number> {
  const cache = new Map<string, Electron.NativeImage | null>();
  let written = 0;
  mkdirSync(dir, { recursive: true });
  for (const slot of GRID_SLOTS) {
    const url = slot.src === 'cover' ? (title.coverUrl ?? title.heroUrl) : (title.heroUrl ?? title.coverUrl);
    if (!url) continue;
    if (!cache.has(url)) cache.set(url, await fetchImage(url));
    const img = cache.get(url);
    if (!img) continue;
    const { width, height } = img.getSize();
    const out = img.crop(cropRect(width, height, slot.w, slot.h)).resize({ width: slot.w, height: slot.h, quality: 'best' });
    writeFileSync(join(dir, `${appid >>> 0}${slot.suffix}.jpg`), out.toJPEG(90));
    written++;
  }
  return written;
}
