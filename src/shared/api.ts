// Xenith — shared contract between the main process, preload and renderer.
// OWNER: integrator. Agents must not change existing members; additive changes only,
// and every addition must be reported in the agent's hand-off.

// ───────────────────────────── Settings ─────────────────────────────

export type Lang = 'ru' | 'en';
export type StreamProfile = 'low-latency' | 'quality' | 'battery';
export type ResolutionChoice = 'auto' | '1440' | '1080' | '720';
export type BitrateMode = 'auto' | 'balanced' | 'high' | 'custom';
export type CodecChoice = 'main' | 'baseline';
export type VideoFit = 'contain' | 'cover' | 'fill';
export type HudMode = 'off' | 'compact' | 'full';
export type HudCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type GpuMode = 'auto' | 'high-performance' | 'low-power';
export type RenderPipeline = 'auto' | 'd3d11' | 'vulkan' | 'gl';
export type UiScale = 'xs' | 's' | 'm' | 'l' | 'xl';

export interface Settings {
  streaming: {
    profile: StreamProfile;
    resolution: ResolutionChoice;
    bitrateMode: BitrateMode;
    customKbps: number;            // 5000–40000, used when bitrateMode = 'custom'
    codec: CodecChoice;
    autoConnectOnLaunch: boolean;
    lastServerId: string | null;
  };
  video: {
    sharpness: number;             // 0 = off … 10
    upscaleFsr: boolean;           // FSR 1.0 EASU when window is larger than the stream
    brightness: number;            // 0.5–1.5, 1 = neutral (CSS filter on <video>)
    contrast: number;              // 0.5–1.5
    saturation: number;            // 0.5–1.5
    fit: VideoFit;
    cloudFits: Record<string, VideoFit>;
    hud: HudMode;
    hudCorner: HudCorner;
  };
  audio: {
    outputDeviceId: string;        // '' = system default
    volume: number;                // 0–1
  };
  controllers: {
    vibration: boolean;
    triggerRumble: boolean;
    deadZone: number;              // 0–0.3
    guideCombo: boolean;           // short press View+Menu = Xbox button
    overlayCombo: boolean;         // hold View+Menu 0.6 s = Xenith menu
    mouseKeyboard: boolean;
    remap: Record<string, string>; // e.g. { A: 'B' }, empty = default layout
  };
  haptics: {
    bridgeMode: boolean;           // Controller Bridge: receive video, do not render it
  };
  network: {
    regionName: string | null;     // xCloud region; null = server default
    preferIPv6: boolean;
  };
  steam: {
    maintainLibraryShortcut: boolean;
    promptCloudShortcut: boolean;
    artworkSource: 'xcloud' | 'none';
  };
  ui: {
    lang: Lang;
    scale: UiScale;
    startFullscreen: boolean;
    showTips: boolean;
    layout: 'auto' | 'desktop' | 'deck';   // auto = deck layout on Steam Deck / ≤1280×800
  };
  advanced: {
    gpuMode: GpuMode;
    renderPipeline: RenderPipeline;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  streaming: { profile: 'low-latency', resolution: 'auto', bitrateMode: 'auto', customKbps: 20000, codec: 'main', autoConnectOnLaunch: false, lastServerId: null },
  video: { sharpness: 0, upscaleFsr: false, brightness: 1, contrast: 1, saturation: 1, fit: 'contain', cloudFits: {}, hud: 'off', hudCorner: 'top-left' },
  audio: { outputDeviceId: '', volume: 1 },
  controllers: { vibration: true, triggerRumble: true, deadZone: 0.1, guideCombo: true, overlayCombo: true, mouseKeyboard: false, remap: {} },
  haptics: { bridgeMode: false },
  network: { regionName: null, preferIPv6: false },
  steam: { maintainLibraryShortcut: false, promptCloudShortcut: true, artworkSource: 'xcloud' },
  ui: { lang: 'en', scale: 'm', startFullscreen: false, showTips: true, layout: 'auto' },
  advanced: { gpuMode: 'high-performance', renderPipeline: 'auto' },
};

/** Settings that only take effect after an app restart (UI must say so). */
export const RESTART_REQUIRED: ReadonlyArray<string> = ['advanced.gpuMode', 'advanced.renderPipeline'];

// ───────────────────────────── Domain types ─────────────────────────────

export interface Account {
  signedIn: boolean;
  gamertag: string | null;
  avatarUrl: string | null;
  hasCloud: boolean | null;        // null = not checked yet; false = no Game Pass Ultimate
}

export interface LoginCode {
  userCode: string;                // e.g. "CF62LZYS"
  verificationUri: string;         // https://www.microsoft.com/link
  expiresAt: number;               // epoch ms
}

export type PowerState = 'On' | 'ConnectedStandby' | 'Off' | 'Unknown' | string;

export interface ConsoleInfo {
  serverId: string;
  name: string;
  type: string;                    // e.g. "XboxSeriesX"
  power: PowerState;
  remotePlayReady: boolean;        // playPath present
}

export interface CloudTitle {
  titleId: string;                 // xCloud titleId used for /v5/sessions/cloud/play
  productId: string;
  name: string;
  publisher: string | null;
  coverUrl: string | null;         // poster (portrait)
  heroUrl: string | null;          // wide art for Steam hero / grid
  supportsMouseKeyboard: boolean;
  inSteam: boolean;
}

export type SessionKind = 'home' | 'cloud';

/** Connection stages shown in the connection rail. Order is fixed. */
export type StageId = 'auth' | 'provision' | 'negotiate' | 'connect' | 'firstFrame';

export interface StageEvent {
  stage: StageId;
  status: 'active' | 'done' | 'failed';
  at: number;                      // epoch ms
  detail?: string;                 // human text already localized by the main process? NO — raw code, UI localizes
  queuePosition?: number;          // cloud wait queue
  etaSeconds?: number;             // cloud wait time
}

export type SessionErrorCode =
  | 'not_signed_in' | 'auth_expired' | 'no_console' | 'console_unreachable'
  | 'console_busy' | 'console_signin_blocked' | 'provision_failed' | 'no_cloud_entitlement' | 'ice_failed'
  | 'stream_lost' | 'network' | 'unknown';

export interface SessionError { code: SessionErrorCode; message: string }

export interface StreamStats {
  at: number;
  frameWidth: number | null;
  frameHeight: number | null;
  fps: number | null;
  kbps: number | null;
  rttMs: number | null;
  jitterMs: number | null;
  jitterBufferMs: number | null;
  decodeMsPerFrame: number | null;
  packetsLost: number;
  framesDropped: number;
  codec: string | null;            // "H.264 Main 4.2"
  decoder: string | null;          // decoderImplementation when exposed
  hardwareDecode: boolean | null;  // null = unknown
}

export interface HistoryEntry {
  id: string;
  kind: SessionKind;
  targetId: string;                // serverId or titleId
  targetName: string;
  startedAt: number;
  durationSec: number;
  connectMs: number | null;        // play → first frame
  stages: Partial<Record<StageId, number>>; // ms spent per stage
  maxWidth: number | null;
  maxHeight: number | null;
  fps: number | null;
  avgKbps: number | null;
  packetsLost: number;
  bitrateTrace: number[];          // ≤ 60 points, kbps
  endReason: 'user' | 'error' | 'console' | 'replaced';
}

export interface ControllerInfo {
  index: number;
  id: string;                      // Gamepad.id
  name: string;                    // friendly
  connection: 'usb' | 'bluetooth' | 'dongle' | 'virtual' | 'unknown';
  isFlydigi: boolean;
  isDeck: boolean;
}

export type CheckState = 'ok' | 'warn' | 'fail' | 'unknown';
/** Every HapticsDiagnostics check may carry a human-readable detail (raw, UI localizes known codes). */
export interface CheckDetail { detail?: string }

export interface HapticsDiagnostics {
  flydigiDevice: { state: CheckState; detail?: string; name: string | null; connection: ControllerInfo['connection'] | null };
  spaceStation: { state: CheckState; detail?: string; installed: boolean; running: boolean; version: string | null };
  gameAudio: { state: CheckState; detail?: string; deviceLabel: string | null };
  audioReachesEngine: { state: CheckState };     // only 'unknown' until verified on hardware
  rumble: { state: CheckState; detail?: string; lastEventAt: number | null; last: { left: number; right: number; lt: number; rt: number } | null };
}

export interface GpuStatus {
  gpu: string | null;
  videoDecode: string;             // e.g. "hardware accelerated"
  hardwareH264?: boolean;          // WebRTC decode probe: H.264 power-efficient (hardware) at stream sizes
  decodeProfiles: string[];        // e.g. ["h264 baseline up to 4096x2304", ...]
  angle: string | null;
  vaapi: boolean | null;           // linux only
}

export interface SteamStatus {
  installed: boolean;
  running: boolean;
  userIds: string[];
  libraryShortcut: boolean;        // Xenith shortcut present
}

export interface PlatformInfo {
  os: 'win32' | 'linux' | 'darwin';
  isSteamDeck: boolean;
  isGamescope: boolean;            // SteamOS gaming mode
  deckModel?: 'lcd' | 'oled' | null;
  version: string;                 // Xenith version
  electron: string;
  chrome: string;
}

export interface LaunchIntent {
  kind: SessionKind | null;        // from --xhome / --xcloud=<titleId>
  targetId: string | null;
}

// ───────────────────────────── IPC API ─────────────────────────────
// Renderer calls window.xenith.<method>(...). Main registers ipcMain.handle(`xenith:${method}`).
// Events: main → renderer on channel 'xenith:event' with an XenithEvent payload.

export interface XenithApi {
  platform(): Promise<PlatformInfo>;
  launchIntent(): Promise<LaunchIntent>;

  settingsGet(): Promise<Settings>;
  settingsSet(patch: DeepPartial<Settings>): Promise<Settings>;
  settingsReset(): Promise<Settings>;
  resetAllData(): Promise<void>;           // clears tokens, settings, history; relaunches

  account(): Promise<Account>;
  loginStart(): Promise<LoginCode>;        // progress via 'login' events
  loginCancel(): Promise<void>;
  signOut(): Promise<void>;

  consoles(refresh?: boolean): Promise<ConsoleInfo[]>;
  cloudTitles(refresh?: boolean): Promise<CloudTitle[]>;
  regions(): Promise<{ name: string; isDefault: boolean }[]>;

  history(): Promise<HistoryEntry[]>;
  historyClear(): Promise<void>;

  /** Session control: main does REST + tokens; renderer's StreamController does WebRTC. */
  sessionStart(kind: SessionKind, targetId: string): Promise<{ sessionId: string }>;
  sessionSdp(sessionId: string, offerSdp: string): Promise<string>;      // returns answer SDP
  sessionIce(sessionId: string, local: IceCandidateInit[]): Promise<IceCandidateInit[]>;
  sessionStop(sessionId: string, reason: HistoryEntry['endReason']): Promise<void>;
  sessionReport(sessionId: string, stats: StreamStats): void;            // fire-and-forget, feeds history
  sessionStage(sessionId: string, ev: StageEvent): void;                 // renderer-side stages (connect, firstFrame)

  steamStatus(): Promise<SteamStatus>;
  steamAddLibraryShortcut(): Promise<{ ok: boolean; message: string }>;
  steamAddConsoleShortcut(serverId: string): Promise<{ ok: boolean; message: string }>;
  steamInstallDeckLayout(): Promise<{ ok: boolean; message: string }>;
  steamAddCloudShortcut(titleId: string): Promise<{ ok: boolean; message: string }>;
  steamResyncArtwork(): Promise<{ ok: boolean; count: number }>;

  hapticsDiagnostics(): Promise<HapticsDiagnostics>;
  gpuStatus(): Promise<GpuStatus>;
  audioOutputs(): Promise<{ deviceId: string; label: string }[]>; // filled by renderer enumerateDevices, cached by main
  showSteamKeyboard(): Promise<boolean>;

  window: {
    toggleFullscreen(): Promise<boolean>;
    setFullscreen(on: boolean): Promise<boolean>;
    minimize(): Promise<void>;
    quit(): Promise<void>;
  };
  openExternal(url: string): Promise<void>;   // only https://www.microsoft.com/link and Flydigi download page are allowed
  copyText(text: string): Promise<void>;
  exportLogs(): Promise<string>;              // path of a zip/txt in Downloads, tokens redacted

  on(listener: (ev: XenithEvent) => void): () => void;
}

export interface IceCandidateInit { candidate: string; sdpMLineIndex: number | string | null; sdpMid: string | null }

export type XenithEvent =
  | { type: 'login'; status: 'waiting' | 'done' | 'expired' | 'error'; message?: string }
  | { type: 'account'; account: Account }
  | { type: 'stage'; sessionId: string; ev: StageEvent }
  | { type: 'sessionError'; sessionId: string; error: SessionError }
  | { type: 'sessionEnded'; sessionId: string; entry: HistoryEntry | null }
  | { type: 'settings'; settings: Settings }
  | { type: 'consoles'; consoles: ConsoleInfo[] }
  | { type: 'power'; state: 'suspend' | 'resume' }
  | { type: 'menu'; action: 'toggle-overlay' | 'toggle-fullscreen' | 'press-guide' };

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

declare global { interface Window { xenith: XenithApi } }
