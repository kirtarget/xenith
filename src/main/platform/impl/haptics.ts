// Haptics diagnostics: Flydigi device + Flydigi Space Station detection. Read-only system queries.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HapticsDiagnostics } from '../../../shared/api';
import {
  Connection, connectionFromLinuxBus, connectionFromWindows, isSpaceStationApp, matchFlydigi, parseLinuxHidDir,
  parseWindowsIds, SPACE_STATION_PROCESS, SPACE_STATION_UNINSTALL_KEY,
} from './flydigi';
import { powershellJson, processNames } from './sys';

export interface FlydigiDeviceHit { name: string; model: string; by: string; connection: Connection; id: string }

/** HapticsDiagnostics plus human-readable details (additive; see contract notes in the hand-off). */
export type HapticsDiagnosticsExt = HapticsDiagnostics & {
  flydigiDevice: HapticsDiagnostics['flydigiDevice'] & { detail: string; candidates: FlydigiDeviceHit[] };
  spaceStation: HapticsDiagnostics['spaceStation'] & { detail: string; installPath: string | null; processes: string[] };
  gameAudio: HapticsDiagnostics['gameAudio'] & { detail: string };
  audioReachesEngine: HapticsDiagnostics['audioReachesEngine'] & { detail: string };
};

const WIN_SCRIPT = `
$d = Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID[_&](0[0-9]{1,4})?(37D7|04B4)' -or $_.Name -match 'flydigi' } | Select-Object Name,PNPDeviceID,PNPClass,Status
$k = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
$a = Get-ItemProperty $k | Where-Object { $_.DisplayName -match 'flydigi|space ?station' -or $_.Publisher -match 'flydigi' -or $_.PSChildName -eq '${SPACE_STATION_UNINSTALL_KEY}' } | Select-Object DisplayName,DisplayVersion,InstallLocation,Publisher,PSChildName,DisplayIcon
$p = Get-Process | Where-Object { $_.ProcessName -match 'flydigi|spacestation|fdspace' } | ForEach-Object { $_.ProcessName }
@{ devices = @($d); apps = @($a); procs = @($p) } | ConvertTo-Json -Depth 4 -Compress`;

interface WinProbe {
  devices: Array<{ Name: string | null; PNPDeviceID: string; PNPClass: string | null; Status: string | null }>;
  apps: Array<{ DisplayName: string | null; DisplayVersion: string | null; InstallLocation: string | null; Publisher: string | null; PSChildName: string; DisplayIcon: string | null }>;
  procs: string[];
}

function windowsPaths(): string[] {
  const env = process.env;
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean) as string[];
  const startMenus = [env.ProgramData && join(env.ProgramData, 'Microsoft\\Windows\\Start Menu\\Programs'), env.APPDATA && join(env.APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs')].filter(Boolean) as string[];
  const hits: string[] = [];
  for (const dir of [...roots, ...startMenus]) {
    try { for (const n of readdirSync(dir)) if (/flydigi|space ?station/i.test(n)) hits.push(join(dir, n)); } catch { /* missing */ }
  }
  return hits;
}

function pickDevice(hits: FlydigiDeviceHit[]): FlydigiDeviceHit | null {
  if (!hits.length) return null;
  const rank = (h: FlydigiDeviceHit) => (h.by === 'id' ? 0 : h.by === 'vendor' ? 1 : 2) * 10 + (h.connection === 'unknown' ? 1 : 0);
  return [...hits].sort((a, b) => rank(a) - rank(b))[0];
}

async function probeWindows(): Promise<{ hits: FlydigiDeviceHit[]; ss: HapticsDiagnosticsExt['spaceStation'] }> {
  const r = await powershellJson<WinProbe>(WIN_SCRIPT, 20000);
  const hits: FlydigiDeviceHit[] = [];
  const seen = new Set<string>();
  for (const d of r?.devices ?? []) {
    if (!d?.PNPDeviceID) continue;
    const { vid, pid } = parseWindowsIds(d.PNPDeviceID);
    const m = matchFlydigi(vid, pid, d.Name);
    if (!m) continue;
    const conn = connectionFromWindows(d.PNPDeviceID, d.Name ?? '');
    const key = `${m.model}|${conn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ name: d.Name ?? m.model, model: m.model, by: m.by, connection: conn, id: d.PNPDeviceID });
  }
  const apps = (r?.apps ?? []).filter((a) => a && isSpaceStationApp(a.DisplayName, a.Publisher, a.PSChildName));
  const paths = windowsPaths();
  const procs = (r?.procs ?? []).filter((p) => typeof p === 'string' && SPACE_STATION_PROCESS.test(p));
  const installed = apps.length > 0 || paths.some((p) => /flydigi/i.test(p));
  const running = procs.length > 0;
  const app = apps[0];
  const installPath = app?.InstallLocation || paths.find((p) => !/Start Menu/i.test(p)) || null;
  const state = installed && running ? 'ok' : installed ? 'warn' : running ? 'warn' : 'fail';
  const detail = r === null ? 'PowerShell query failed' :
    installed ? `installed${app?.DisplayName ? ` as "${app.DisplayName}"` : ''}${installPath ? ` at ${installPath}` : ''}; ${running ? `running (${procs.join(', ')})` : 'not running'}` :
    running ? `process running (${procs.join(', ')}) but no installation found` : 'not installed (no uninstall entry, Start menu entry or Program Files folder)';
  return { hits, ss: { state, installed, running, version: app?.DisplayVersion ?? null, detail, installPath, processes: procs } };
}

function probeLinux(): FlydigiDeviceHit[] {
  const base = '/sys/bus/hid/devices';
  const hits: FlydigiDeviceHit[] = [];
  let dirs: string[] = [];
  try { dirs = readdirSync(base); } catch { return hits; }
  for (const dir of dirs) {
    const p = parseLinuxHidDir(dir);
    if (!p) continue;
    let name = '';
    try { name = /^HID_NAME=(.*)$/m.exec(readFileSync(join(base, dir, 'uevent'), 'utf8'))?.[1] ?? ''; } catch { /* no uevent */ }
    const m = matchFlydigi(p.vid, p.pid, name);
    if (!m) continue;
    const conn = connectionFromLinuxBus(p.bus, name);
    if (hits.some((h) => h.model === m.model && h.connection === conn)) continue;
    hits.push({ name: name || m.model, model: m.model, by: m.by, connection: conn, id: dir });
  }
  return hits;
}

export async function hapticsDiagnostics(lastRumble: HapticsDiagnostics['rumble'], audioDeviceLabel: string | null): Promise<HapticsDiagnosticsExt> {
  let hits: FlydigiDeviceHit[] = [];
  let ss: HapticsDiagnosticsExt['spaceStation'];
  if (process.platform === 'win32') {
    const w = await probeWindows();
    hits = w.hits; ss = w.ss;
  } else {
    hits = process.platform === 'linux' ? probeLinux() : [];
    ss = { state: 'unknown', installed: false, running: false, version: null, installPath: null, processes: [], detail: 'Flydigi Space Station is Windows-only' };
  }
  const dev = pickDevice(hits);
  const flydigiDevice: HapticsDiagnosticsExt['flydigiDevice'] = dev
    ? { state: 'ok', name: dev.name, connection: dev.connection, candidates: hits,
        detail: `${dev.model} (${dev.by === 'id' ? 'matched by USB id' : dev.by === 'vendor' ? 'matched by Flydigi vendor id' : 'matched by name'}; ${dev.connection === 'usb' ? 'USB — cable and 2.4 GHz dongle share ids' : dev.connection})` }
    : { state: 'fail', name: null, connection: null, candidates: [], detail: 'no Flydigi device found (VID 37D7, 04B4:2412 or "Flydigi" name)' };
  const label = audioDeviceLabel?.trim() || null;
  const gameAudio: HapticsDiagnosticsExt['gameAudio'] = !label
    ? { state: 'unknown', deviceLabel: null, detail: 'no game audio device selected (system default)' }
    : /flydigi|apex|vader/i.test(label)
      ? { state: 'ok', deviceLabel: label, detail: 'game audio goes to a Flydigi audio endpoint' }
      : { state: 'warn', deviceLabel: label, detail: 'game audio is not routed to a Flydigi audio endpoint' };
  return {
    flydigiDevice,
    spaceStation: ss,
    gameAudio,
    audioReachesEngine: { state: 'unknown', detail: 'cannot be verified without the controller and Space Station: Xenith has no way to observe whether Space Station\'s haptic engine receives the audio' },
    rumble: lastRumble,
  };
}

