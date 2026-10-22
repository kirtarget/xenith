// Gamescope (Steam Deck gaming mode) maps a window to a Steam game by walking the window's process
// ancestors up to Steam's `reaper SteamLaunch AppId=…`. Xenith's Steam launcher starts it as a systemd
// unit (Chromium's GPU process fails inside the Steam client's process tree), which breaks that chain:
// the window is drawn but gamescope never focuses it and Steam shows its loading screen forever.
// Gamescope also honours the STEAM_GAME window property, so set it explicitly.
import type { BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { log, logWarn } from './log';

export function steamAppIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const game = env.SteamGameId;
  if (game && /^\d+$/.test(game)) {
    const v = BigInt(game);
    const id = v > 0xffffffffn ? v >> 32n : v;   // non-Steam shortcut: gameid64 = appid << 32 | 0x02000000
    if (id > 0n) return id.toString();
  }
  const app = env.SteamAppId;
  return app && /^\d+$/.test(app) && app !== '0' ? app : null;
}

export function tagSteamGameWindow(w: BrowserWindow) {
  if (process.platform !== 'linux') return;
  const appId = steamAppIdFromEnv();
  if (!appId) return;
  let xid: number;
  try {
    const h = w.getNativeWindowHandle();
    xid = h.length >= 8 ? Number(h.readBigUInt64LE(0)) : h.readUInt32LE(0);
  } catch { return; }
  if (!xid) return;
  execFile('xprop', ['-id', String(xid), '-f', 'STEAM_GAME', '32c', '-set', 'STEAM_GAME', appId], { timeout: 5000 }, (err) => {
    if (err) logWarn('steam.window_tag_failed', { message: String(err.message || err) });
    else log('steam.window_tagged', { appId, xid });
  });
}