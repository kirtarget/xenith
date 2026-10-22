// ⚠ PREVIEW ONLY — a fake window.xenith backed by fixtures. Calls no Xbox / Microsoft endpoint.
import { DEFAULT_SETTINGS, type DeepPartial, type Settings, type XenithApi, type XenithEvent } from '../../src/shared/api';
import type { XenithApiFull } from '../../src/shared/core-additions';
import * as fx from './fixtures';

export interface FakeConfig {
  deck: boolean;
  signedIn: boolean;
  consoles: 'one' | 'two' | 'empty' | 'loading';
  history: 'full' | 'empty';
  hasCloud: boolean | null;
  cloudLoading: boolean;
  lang: 'ru' | 'en';
  scale: Settings['ui']['scale'];
  layout: Settings['ui']['layout'];
}

const listeners = new Set<(ev: XenithEvent) => void>();
export function fakeEmit(ev: XenithEvent): void { listeners.forEach(l => l(ev)); }

const never = <T,>() => new Promise<T>(() => undefined);
const delay = <T,>(v: T, ms = 30) => new Promise<T>(r => setTimeout(() => r(v), ms));

function merge<T>(a: T, b: unknown): T {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return (b === undefined ? a : b) as T;
  const o: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) o[k] = o[k] && typeof o[k] === 'object' && v && typeof v === 'object' && !Array.isArray(v) && k !== 'remap' ? merge(o[k], v) : v;
  return o as T;
}

export function installFakeApi(cfg: FakeConfig): void {
  let settings = fx.fxSettings(cfg.deck);
  settings.ui.lang = cfg.lang;
  settings.ui.scale = cfg.scale;
  settings.ui.layout = cfg.layout;
  let account = cfg.signedIn ? { ...fx.fxAccount, hasCloud: cfg.hasCloud } : { signedIn: false, gamertag: null, avatarUrl: null, hasCloud: null };
  const history = cfg.history === 'full' ? fx.fxHistory() : [];
  const cloud = fx.fxCloud();

  const api: XenithApi & Partial<XenithApiFull> = {
    platform: () => delay(fx.fxPlatform(cfg.deck)),
    launchIntent: () => delay({ kind: null, targetId: null }),
    settingsGet: () => delay(settings),
    settingsSet: (patch: DeepPartial<Settings>) => { settings = merge(settings, patch); return delay(settings, 20); },
    settingsReset: () => { settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); return delay(settings); },
    resetAllData: () => delay(undefined),
    account: () => delay(account),
    loginStart: () => delay({ userCode: 'CF62LZYS', verificationUri: 'https://www.microsoft.com/link', expiresAt: Date.now() + 14.5 * 60000 }, 60),
    loginCancel: () => delay(undefined),
    signOut: () => { account = { signedIn: false, gamertag: null, avatarUrl: null, hasCloud: null }; return delay(undefined); },
    consoles: () => cfg.consoles === 'loading' ? never() : delay(cfg.consoles === 'empty' ? [] : cfg.consoles === 'two' ? fx.fxConsoles2 : fx.fxConsoles, 40),
    cloudTitles: () => cfg.cloudLoading ? never() : delay(cloud, 40),
    regions: () => delay(fx.fxRegions),
    history: () => delay(history),
    historyClear: () => delay(undefined),
    sessionStart: () => delay({ sessionId: 'FIXTURE-SESSION' }),
    sessionSdp: () => delay('v=0 FIXTURE'),
    sessionIce: () => delay([]),
    sessionStop: () => delay(undefined),
    sessionReport: () => undefined,
    sessionStage: () => undefined,
    steamStatus: () => delay(fx.fxSteam),
    steamAddLibraryShortcut: () => delay({ ok: true, message: 'Ярлык добавлен (заглушка)' }),
    steamAddCloudShortcut: () => delay({ ok: true, message: 'Игра добавлена в Steam (заглушка)' }),
    steamResyncArtwork: () => delay({ ok: true, count: 12 }),
    hapticsDiagnostics: () => delay({ ...fx.fxHaptics, rumble: { ...fx.fxHaptics.rumble, lastEventAt: Date.now() - 3000 } }),
    gpuStatus: () => delay(cfg.deck ? fx.fxGpuDeck : fx.fxGpu),
    audioOutputs: () => delay([{ deviceId: 'fx-speakers', label: 'Динамики (заглушка)' }, { deviceId: 'fx-hdmi', label: 'HDMI-телевизор (заглушка)' }]),
    window: {
      toggleFullscreen: () => delay(false),
      setFullscreen: (on: boolean) => delay(on),
      minimize: () => delay(undefined),
      quit: () => delay(undefined),
    },
    openExternal: () => delay(undefined),
    copyText: () => delay(undefined),
    exportLogs: () => delay('C:\\Users\\FIXTURE\\Downloads\\xenith-log-fixture.txt'),
    reportAudioOutputs: () => undefined,
    reportRumble: () => undefined,
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  (window as unknown as { xenith: XenithApi }).xenith = api;
}
