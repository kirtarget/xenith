// Steam id helpers for non-Steam shortcuts.
//
// Classic Steam formula for a non-Steam shortcut id, computed from the exact strings stored in
// shortcuts.vdf:  appid = crc32(Exe + AppName) | 0x80000000   (unsigned 32 bit)
// where Exe is the stored value *including* the surrounding double quotes Steam adds.
// shortcuts.vdf stores it as a signed int32 ("appid" key). Steam honours whatever appid is stored in
// the file, so writing this value makes the id (and thus the artwork file names) deterministic.
// Grid artwork files are named with the unsigned decimal value (config/grid/<appid>p.jpg ...), and the
// 64-bit "game id" used by steam://rungameid/ is (appid << 32) | 0x02000000.
// The CRC part matches steamgrid (github.com/boppreh/steamgrid, games.go:
// crc32.ChecksumIEEE(exe+name) | 0x80000000). See docs/platform/steam.md.

import { crc32 } from './crc32';

export function shortcutAppId(exe: string, appName: string): number {
  return (crc32(exe + appName) | 0x80000000) >>> 0;
}

/** Value as written to the int32 "appid" field of shortcuts.vdf. */
export function toSigned32(appid: number): number { return appid | 0; }
export function toUnsigned32(v: number): number { return v >>> 0; }

/** 64-bit id used by steam://rungameid/<id>. */
export function shortcutGameId64(appid: number): bigint {
  return (BigInt(appid >>> 0) << 32n) | 0x02000000n;
}

export const STEAMID64_BASE = 76561197960265728n;
/** userdata/<accountId> folder name from a SteamID64 (loginusers.vdf keys). */
export function accountIdFromSteamId64(id64: string): string {
  try { return (BigInt(id64) - STEAMID64_BASE).toString(); } catch { return ''; }
}
