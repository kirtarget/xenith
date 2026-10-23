// XenithCore: composes auth, REST, settings, history, catalog and sessions. ipc.ts is a thin mapping onto it.
import { app, session as electronSession } from 'electron';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Account, CloudTitle, ConsoleInfo, DeepPartial, GpuStatus, HapticsDiagnostics, HistoryEntry, IceCandidateInit,
  LaunchIntent, LoginCode, PlatformInfo, SessionKind, Settings, StageEvent, SteamStatus, StreamStats,
} from '../shared/api';
import type { AudioOutput, RumbleSample } from '../shared/core-additions';
import { AuthError, XboxAuth } from './xbox-auth';
import { GssvApi } from './xhome-api';
import { SettingsStore } from './settings';
import { HistoryStore } from './history';
import { CloudCatalog } from './catalog';
import { SessionManager } from './sessions';
import { platform } from './platform';
import { emit } from './events';
import { LOG_PREFIX, log, logWarn, logsDir } from './log';
import { redact } from './redact';

const CONSOLES_TTL = 60_000;

const friendly = (e: unknown) => {
  const m = String((e as any)?.message ?? e);
  return /not implemented/i.test(m) ? 'not_available' : redact(m).slice(0, 200);
};
const clamp01 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export class XenithCore {
  readonly auth = new XboxAuth();
  readonly api = new GssvApi(this.auth);
  readonly history = new HistoryStore();
  readonly catalog: CloudCatalog;
  readonly sessions: SessionManager;
  private acc: Account = { signedIn: false, gamertag: null, avatarUrl: null, hasCloud: null };
  private consoleCache: { at: number; list: ConsoleInfo[] } | null = null;
  private consolesInflight: Promise<ConsoleInfo[]> | null = null;
  private audio: AudioOutput[] = [];
  private rumble: HapticsDiagnostics['rumble'] = { state: 'unknown', lastEventAt: null, last: null };

  constructor(readonly settings: SettingsStore, public intent: LaunchIntent, onActiveSessions?: (n: number) => void) {
    this.catalog = new CloudCatalog(this.auth, this.api, () => this.settings.get(), join(app.getPath('userData'), 'cloud-titles.json'));
    this.sessions = new SessionManager({
      auth: this.auth, api: this.api, history: this.history,
      settings: () => this.settings.get(),
      rememberConsole: (serverId) => { if (this.settings.get().streaming.lastServerId !== serverId) this.settings.set({ streaming: { lastServerId: serverId } }); },
      findConsole: async (serverId) => {
        const hit = this.consoleCache?.list.find((c) => c.serverId === serverId);
        if (hit) return hit;
        return (await this.consoles(true)).find((c) => c.serverId === serverId) ?? null;
      },
      findTitle: (titleId) => this.catalog.find(titleId),
      onActiveChange: onActiveSessions,
    });
    settings.onChange((s) => emit({ type: 'settings', settings: s }));
  }

  // ─── platform / launch ───
  platformInfo(): PlatformInfo {
    try { return platform.info(); } catch { /* platform layer not landed yet */ }
    let isSteamDeck = false;
    if (process.platform === 'linux') {
      try { isSteamDeck = process.env.SteamDeck === '1' || /Jupiter|Galileo/i.test(readFileSync('/sys/devices/virtual/dmi/id/board_name', 'utf8')); } catch { /* not a Deck */ }
    }
    return {
      os: process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux',
      isSteamDeck,
      isGamescope: !!process.env.GAMESCOPE_WAYLAND_DISPLAY || /gamescope/i.test(process.env.XDG_CURRENT_DESKTOP || ''),
      version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    };
  }

  setIntent(i: LaunchIntent) { this.intent = i; emit({ type: 'launchIntent', intent: i }); }

  async launchIntent(): Promise<LaunchIntent> {
    const i = { ...this.intent };
    if (i.kind === 'home' && !i.targetId) {
      i.targetId = this.settings.get().streaming.lastServerId;
      if (!i.targetId && this.auth.hasAccount()) {
        try { const l = await this.consoles(); i.targetId = (l.find((c) => c.remotePlayReady) ?? l[0])?.serverId ?? null; } catch (e) { logWarn('launch.resolve_console_failed', e); }
      }
    }
    return i;
  }

  // ─── settings ───
  settingsGet(): Settings { return this.settings.get(); }
  settingsSet(patch: DeepPartial<Settings>): Settings { return this.settings.set(patch && typeof patch === 'object' ? patch : {}); }
  settingsReset(): Settings { return this.settings.reset(); }

  // ─── account ───
  private setAccount(a: Account) {
    if (JSON.stringify(a) !== JSON.stringify(this.acc)) { this.acc = a; emit({ type: 'account', account: { ...a } }); }
  }

  async account(): Promise<Account> {
    if (!this.auth.hasAccount()) { this.setAccount({ signedIn: false, gamertag: null, avatarUrl: null, hasCloud: null }); return { ...this.acc }; }
    const next: Account = { ...this.acc, signedIn: true };
    const [p, c] = await Promise.allSettled([this.auth.profile(), this.auth.cloudEntitlement()]);
    if (p.status === 'fulfilled') { next.gamertag = p.value.gamertag; next.avatarUrl = p.value.avatarUrl; }
    else {
      logWarn('account.profile_failed', p.reason);
      // revoked/expired refresh token (invalid_grant → 400): report signed out but keep the file (user decides)
      if (p.reason instanceof AuthError && p.reason.code === 'refresh_failed' && p.reason.status === 400) { next.signedIn = false; next.hasCloud = null; }
    }
    if (c.status === 'fulfilled') next.hasCloud = c.value.hasCloud;
    else logWarn('account.cloud_check_failed', c.reason);
    this.setAccount(next);
    return { ...next };
  }

  loginStart(): Promise<LoginCode> {
    return this.auth.startDeviceLogin((status, message) => {
      emit({ type: 'login', status, message });
      if (status === 'done') {
        this.consoleCache = null;
        this.catalog.clear();
        void this.account().catch(() => undefined);
        void this.consoles(true).catch(() => undefined);
      }
    });
  }
  loginCancel() { this.auth.cancelLogin(); }

  async signOut() {
    await this.sessions.stopAll('user');
    this.auth.signOut();
    this.catalog.clear();
    this.consoleCache = null;
    this.setAccount({ signedIn: false, gamertag: null, avatarUrl: null, hasCloud: null });
    emit({ type: 'consoles', consoles: [] });
  }

  // ─── consoles / titles / regions ───
  consoles(refresh = false): Promise<ConsoleInfo[]> {
    if (!refresh && this.consoleCache && Date.now() - this.consoleCache.at < CONSOLES_TTL) return Promise.resolve(this.consoleCache.list.map((c) => ({ ...c })));
    if (this.consolesInflight) return this.consolesInflight;
    this.consolesInflight = (async () => {
      const b = await this.api.base('xhome');
      const list: ConsoleInfo[] = (await this.api.consoles(b)).map((c) => ({ serverId: c.serverId, name: c.name, type: c.type, power: c.power, remotePlayReady: !!c.playPath }));
      this.consoleCache = { at: Date.now(), list };
      emit({ type: 'consoles', consoles: list.map((c) => ({ ...c })) });
      return list.map((c) => ({ ...c }));
    })().finally(() => { this.consolesInflight = null; });
    return this.consolesInflight;
  }

  cloudTitles(refresh = false): Promise<CloudTitle[]> { return this.catalog.list(refresh); }

  async regions(): Promise<{ name: string; isDefault: boolean }[]> {
    const ent = await this.auth.cloudEntitlement();
    if (!ent.offering) return [];
    return (await this.api.regions(ent.offering)).map((r) => ({ name: r.name, isDefault: r.isDefault }));
  }

  // ─── history ───
  historyList(): HistoryEntry[] { return this.history.all(); }
  historyClear() { this.history.clear(); }

  // ─── sessions ───
  sessionStart(kind: SessionKind, targetId: string) { return this.sessions.start(kind, targetId); }
  sessionSdp(id: string, offer: string) { return this.sessions.sdp(id, offer); }
  sessionIce(id: string, local: IceCandidateInit[]) { return this.sessions.ice(id, local); }
  sessionStop(id: string, reason: HistoryEntry['endReason']) {
    return this.sessions.stop(id, ['user', 'error', 'console', 'replaced'].includes(reason) ? reason : 'user');
  }
  sessionReport(id: string, stats: StreamStats) { this.sessions.report(id, stats); }
  sessionStage(id: string, ev: StageEvent) { this.sessions.rendererStage(id, ev); }

  // ─── steam (platform layer) ───
  async steamStatus(): Promise<SteamStatus> {
    try { return await platform.steam.status(); } catch (e) { logWarn('steam.status_unavailable', friendly(e)); return { installed: false, running: false, userIds: [], libraryShortcut: false }; }
  }
  async steamAddLibraryShortcut() {
    try { return await platform.steam.addLibraryShortcut(); } catch (e) { return { ok: false, message: friendly(e) }; }
  }
  async steamAddConsoleShortcut(serverId: string) {
    if (typeof serverId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(serverId) || serverId === '.' || serverId === '..') return { ok: false, message: 'unknown_console' };
    try {
      const console = (await this.consoles()).find(c => c.serverId === serverId);
      if (!console) return { ok: false, message: 'unknown_console' };
      return await platform.steam.addConsoleShortcut(console);
    } catch (e) { return { ok: false, message: friendly(e) }; }
  }
  async steamInstallDeckLayout() {
    try { return await platform.steam.installDeckLayout(); } catch (e) { return { ok: false, message: friendly(e) }; }
  }
  async steamAddCloudShortcut(titleId: string) {
    let title: CloudTitle | undefined;
    try { title = (await this.cloudTitles()).find((t) => t.titleId === titleId); } catch (e) { return { ok: false, message: friendly(e) }; }
    if (!title) return { ok: false, message: 'unknown_title' };
    try { return await platform.steam.addCloudShortcut(title); } catch (e) { return { ok: false, message: friendly(e) }; }
  }
  async steamResyncArtwork() {
    try { return await platform.steam.resyncArtwork(await this.cloudTitles()); } catch (e) { logWarn('steam.resync_failed', friendly(e)); return { ok: false, count: 0 }; }
  }

  // ─── haptics / gpu / audio ───
  reportAudioOutputs(list: AudioOutput[]) {
    if (!Array.isArray(list)) return;
    this.audio = list.filter((d) => d && typeof d.deviceId === 'string').slice(0, 64).map((d) => ({ deviceId: d.deviceId.slice(0, 512), label: String(d.label ?? '').slice(0, 200) }));
  }
  audioOutputs(): AudioOutput[] { return this.audio.map((d) => ({ ...d })); }
  reportRumble(r: RumbleSample) {
    if (!r || typeof r !== 'object') return;
    this.rumble = { state: 'ok', lastEventAt: Date.now(), last: { left: clamp01(r.left), right: clamp01(r.right), lt: clamp01(r.lt), rt: clamp01(r.rt) } };
  }

  async hapticsDiagnostics(): Promise<HapticsDiagnostics> {
    const id = this.settings.get().audio.outputDeviceId;
    const label = this.audio.find((d) => d.deviceId === (id || 'default'))?.label ?? null;
    try { return await platform.hapticsDiagnostics(this.rumble, label); }
    catch (e) {
      logWarn('haptics.unavailable', friendly(e));
      return {
        flydigiDevice: { state: 'unknown', name: null, connection: null },
        spaceStation: { state: 'unknown', installed: false, running: false, version: null },
        gameAudio: { state: label ? 'ok' : 'unknown', deviceLabel: label },
        audioReachesEngine: { state: 'unknown' },
        rumble: { ...this.rumble },
      };
    }
  }

  async gpuStatus(): Promise<GpuStatus> {
    try { return await platform.gpuStatus(); } catch { /* fallback below */ }
    const fs = app.getGPUFeatureStatus() as unknown as Record<string, string>;
    let info: any = null;
    try { info = await app.getGPUInfo('complete'); } catch { /* ignore */ }
    const dev = info?.gpuDevice?.find((d: any) => d.active) ?? info?.gpuDevice?.[0];
    return {
      gpu: dev ? String(dev.deviceString || `${dev.vendorId}:${dev.deviceId}`) : null,
      videoDecode: fs?.video_decode ?? 'unknown',
      decodeProfiles: [],
      angle: info?.auxAttributes?.glRenderer ? String(info.auxAttributes.glRenderer) : null,
      vaapi: null,
    };
  }

  // ─── diagnostics ───
  exportLogs(): string {
    const dir = logsDir();
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && (f.startsWith(LOG_PREFIX) || f.startsWith('session-'))).sort((a, b) => statSync(join(dir, a)).mtimeMs - statSync(join(dir, b)).mtimeMs).slice(-6); } catch { /* no logs */ }
    const parts: string[] = [
      `Xenith diagnostics ${new Date().toISOString()}`,
      `platform: ${JSON.stringify(this.platformInfo())}`,
      `settings: ${JSON.stringify(this.settings.get())}`,
      `account: signedIn=${this.acc.signedIn} hasCloud=${this.acc.hasCloud}`,
      `history: ${JSON.stringify(this.history.all().slice(0, 10).map((h) => ({ kind: h.kind, at: new Date(h.startedAt).toISOString(), dur: h.durationSec, res: `${h.maxWidth}x${h.maxHeight}`, fps: h.fps, kbps: h.avgKbps, lost: h.packetsLost, end: h.endReason, stages: h.stages })))}`,
    ];
    for (const f of files) {
      let text = '';
      try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      if (text.length > 1_000_000) text = '…(truncated)…\n' + text.slice(-1_000_000);
      parts.push(`\n===== ${f} =====\n${text}`);
    }
    const out = join(app.getPath('downloads'), `xenith-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    writeFileSync(out, redact(parts.join('\n')), 'utf8');
    log('logs.exported', { files: files.length });
    return out;
  }

  /** Clears tokens, settings, history, caches and web storage, then relaunches. */
  async resetAllData() {
    log('reset_all_data');
    await this.sessions.stopAll('user');
    this.auth.signOut();
    const ud = app.getPath('userData');
    for (const p of ['secure', 'settings.json', 'history.json', 'cloud-titles.json']) {
      try { if (existsSync(join(ud, p))) rmSync(join(ud, p), { recursive: true, force: true }); } catch (e) { logWarn('reset.rm_failed', { p, e }); }
    }
    try { await electronSession.defaultSession.clearStorageData(); await electronSession.defaultSession.clearCache(); } catch { /* ignore */ }
    try { for (const f of readdirSync(logsDir())) if (f.startsWith(LOG_PREFIX)) rmSync(join(logsDir(), f), { force: true }); } catch { /* ignore */ }
    app.relaunch();
    app.exit(0);
  }
}
