// ⚠ FIXTURES — fake data for the UI preview harness only. Never shipped, never sent anywhere.
// Values are shaped after the approved mockups so screenshots can be compared side by side.
import { DEFAULT_SETTINGS, type Account, type CloudTitle, type ConsoleInfo, type GpuStatus, type HapticsDiagnostics, type HistoryEntry, type PlatformInfo, type Settings, type SteamStatus } from '../../src/shared/api';

export const FIXTURE_MARK = 'FIXTURE';

export function fxPlatform(deck: boolean): PlatformInfo {
  return deck
    ? { os: 'linux', isSteamDeck: true, isGamescope: true, version: '0.1.0-preview', electron: '45.0.0', chrome: '142.0' }
    : { os: 'win32', isSteamDeck: false, isGamescope: false, version: '0.1.0-preview', electron: '45.0.0', chrome: '142.0' };
}

export function fxSettings(deck: boolean): Settings {
  const s: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (deck) { s.streaming.profile = 'battery'; s.streaming.resolution = '720'; s.video.hud = 'compact'; }
  else { s.video.hud = 'full'; s.video.sharpness = 3; }
  return s;
}

export const fxAccount: Account = { signedIn: true, gamertag: 'FixtureGamer', avatarUrl: null, hasCloud: true };

export const fxConsoles: ConsoleInfo[] = [
  { serverId: 'FIXTURE-SERVER-1', name: 'Xbox', type: 'XboxSeriesX', power: 'ConnectedStandby', remotePlayReady: true },
];
export const fxConsoles2: ConsoleInfo[] = [
  ...fxConsoles,
  { serverId: 'FIXTURE-SERVER-2', name: 'Xbox в спальне', type: 'XboxSeriesS', power: 'Off', remotePlayReady: true },
];

// Trace shaped after the Main mockup sparkline (kbps)
const TRACE = [3000, 9800, 15400, 16200, 15900, 16600, 16200, 17000, 15900, 16200, 17300, 16200, 15400, 16600, 16200, 17000, 15900, 13900, 14600, 16200, 16600, 16200, 17000, 15900, 16200, 16200];

function at(hh: number, mm: number, daysAgo = 0) { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hh, mm, 0, 0); return d.getTime(); }

export function fxHistory(): HistoryEntry[] {
  const base = { kind: 'home' as const, targetId: 'FIXTURE-SERVER-1', targetName: 'Xbox', maxWidth: 1920, maxHeight: 1080, fps: 60, packetsLost: 0, endReason: 'user' as const };
  return [
    { ...base, id: 'fx-h1', startedAt: at(20, 7), durationSec: 45, connectMs: 19100, stages: { auth: 400, provision: 11600, negotiate: 2900, connect: 4300, firstFrame: 0 }, avgKbps: 16900, bitrateTrace: TRACE },
    { ...base, id: 'fx-h2', startedAt: at(19, 12), durationSec: 45, connectMs: 17800, stages: { auth: 380, provision: 10400, negotiate: 2800, connect: 4200 }, avgKbps: 16400, bitrateTrace: TRACE.slice(4) },
    { ...base, id: 'fx-h3', startedAt: at(19, 5), durationSec: 64, connectMs: 18300, stages: { auth: 410, provision: 10900, negotiate: 2900, connect: 4100 }, avgKbps: 15800, bitrateTrace: TRACE.slice(2) },
    { ...base, id: 'fx-h4', kind: 'cloud', targetId: 'FX-TITLE-03', targetName: 'Игра-заглушка 3', startedAt: at(22, 40, 1), durationSec: 2860, connectMs: 24100, stages: {}, avgKbps: 12100, packetsLost: 14, bitrateTrace: TRACE },
  ];
}

const NAMES = [
  'Игра-заглушка 1', 'Игра-заглушка 2', 'Игра-заглушка 3', 'Длинное название игры-заглушки для проверки обрезки', 'Fixture Racing', 'Fixture Quest',
  'Игра-заглушка 7', 'Fixture Tactics', 'Игра-заглушка 9', 'Fixture Puzzle', 'Игра-заглушка 11', 'Fixture Arena',
  'Игра-заглушка 13', 'Fixture Odyssey', 'Игра-заглушка 15', 'Fixture Drift', 'Игра-заглушка 17', 'Fixture Legends',
];
const HUES = [212, 148, 28, 268, 190, 8, 330, 96, 240, 48, 172, 300, 120, 220, 16, 280, 60, 200];

/** Generated covers as blob: URLs (allowed by the CSP) — gradients with a big initial, no network. */
function cover(i: number, w: number, h: number): string {
  const hue = HUES[i % HUES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,34%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},50%,14%)"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${w * 0.72}" cy="${h * 0.3}" r="${w * 0.32}" fill="hsla(${hue},70%,70%,.16)"/>
  <text x="${w * 0.08}" y="${h * 0.9}" font-family="sans-serif" font-size="${w * 0.1}" fill="rgba(255,255,255,.55)">FIXTURE ${String(i + 1).padStart(2, '0')}</text></svg>`;
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}

export function fxCloud(): CloudTitle[] {
  return NAMES.map((name, i) => ({
    titleId: `FX-TITLE-${String(i + 1).padStart(2, '0')}`,
    productId: `FXPRODUCT${i}`,
    name,
    publisher: i % 2 ? 'Fixture Studios' : 'Студия-заглушка',
    coverUrl: cover(i, 300, 400),
    heroUrl: cover(i, 640, 360),
    supportsMouseKeyboard: i % 3 === 0,
    inSteam: i % 4 === 1,
  }));
}

export const fxHaptics: HapticsDiagnostics = {
  flydigiDevice: { state: 'warn', name: null, connection: null },
  spaceStation: { state: 'warn', installed: false, running: false, version: null },
  gameAudio: { state: 'ok', deviceLabel: 'Динамики' },
  audioReachesEngine: { state: 'unknown' },
  rumble: { state: 'ok', lastEventAt: Date.now() - 3000, last: { left: 0.4, right: 0.25, lt: 0, rt: 0 } },
};

export const fxGpu: GpuStatus = {
  gpu: 'FIXTURE GPU (NVIDIA GeForce RTX 3070)',
  videoDecode: 'Hardware accelerated',
  decodeProfiles: ['h264 baseline up to 4096x2304', 'h264 main up to 4096x2304', 'h264 high up to 4096x2304', 'vp9 profile0 up to 8192x8192'],
  angle: 'D3D11',
  vaapi: null,
};
export const fxGpuDeck: GpuStatus = { gpu: 'FIXTURE AMD Custom APU 0405', videoDecode: 'Hardware accelerated', decodeProfiles: ['h264 main up to 4096x2304'], angle: null, vaapi: true };

export const fxSteam: SteamStatus = { installed: true, running: false, userIds: ['FIXTURE-1'], libraryShortcut: false };
export const fxRegions = [{ name: 'Швеция', isDefault: true }, { name: 'Германия', isDefault: false }, { name: 'Польша', isDefault: false }, { name: 'Нидерланды', isDefault: false }];
