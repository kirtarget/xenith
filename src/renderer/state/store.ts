// Tiny external store (no deps): getState / setState / useApp(selector) via useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SETTINGS,
  type Account, type CloudTitle, type ConsoleInfo, type ControllerInfo, type HapticsDiagnostics, type HistoryEntry,
  type LoginCode, type PlatformInfo, type SessionError, type SessionKind, type Settings, type StageId, type StreamStats,
} from '../../shared/api';
import type { RumbleEvent, StreamState } from '../../shared/stream-controller';

export type Screen = 'home' | 'cloud' | 'settings' | 'connecting';
export type SettingsSection = 'streaming' | 'video' | 'audio' | 'controllers' | 'haptics' | 'network' | 'steam' | 'ui' | 'advanced';
export type InputKind = 'mouse' | 'keyboard' | 'gamepad';
export type StageStatus = 'pending' | 'active' | 'done' | 'failed';

export const STAGES: StageId[] = ['auth', 'provision', 'negotiate', 'connect', 'firstFrame'];

export interface StageState {
  status: StageStatus;
  startedAt: number | null;
  endedAt: number | null;
  detail?: string;
  queuePosition?: number;
  etaSeconds?: number;
}

export type SessionPhase = 'idle' | 'connecting' | 'streaming' | 'reconnecting' | 'error';

export interface SessionState {
  phase: SessionPhase;
  engineState: StreamState;
  kind: SessionKind;
  targetId: string;
  targetName: string;
  startedAt: number;
  firstFrameAt: number | null;
  stages: Record<StageId, StageState>;
  error: SessionError | null;
  failedStage: StageId | null;
  stats: StreamStats | null;
  lossTrend: number;            // packets lost over the last ~10 s of stats
  overlayOpen: boolean;
  lastRumble: RumbleEvent | null;
  audioLevel: number;
}

export interface Toast { id: number; text: string; tone: 'info' | 'ok' | 'bad' }

export type LoginStatus = 'idle' | 'loading' | 'waiting' | 'expired' | 'error' | 'done';

export interface AppState {
  booted: boolean;
  platform: PlatformInfo | null;
  settings: Settings;
  account: Account | null;
  consoles: ConsoleInfo[] | null;
  consolesFailed: boolean;
  selectedServerId: string | null;
  history: HistoryEntry[] | null;
  cloud: CloudTitle[] | null;
  cloudFailed: boolean;
  haptics: HapticsDiagnostics | null;
  controllers: ControllerInfo[];
  route: { screen: Screen; section: SettingsSection; returnTo: Screen };
  session: SessionState | null;
  lastSessionError: { error: SessionError; kind: SessionKind; targetId: string; targetName: string; stage: StageId | null } | null;
  login: { status: LoginStatus; code: LoginCode | null; message?: string };
  sheet: 'account' | 'console' | null;
  toasts: Toast[];
  input: InputKind;
  deck: boolean;
}

export function emptyStages(): Record<StageId, StageState> {
  const o = {} as Record<StageId, StageState>;
  for (const id of STAGES) o[id] = { status: 'pending', startedAt: null, endedAt: null };
  return o;
}

let state: AppState = {
  booted: false,
  platform: null,
  settings: DEFAULT_SETTINGS,
  account: null,
  consoles: null,
  consolesFailed: false,
  selectedServerId: null,
  history: null,
  cloud: null,
  cloudFailed: false,
  haptics: null,
  controllers: [],
  route: { screen: 'home', section: 'streaming', returnTo: 'home' },
  session: null,
  lastSessionError: null,
  login: { status: 'idle', code: null },
  sheet: null,
  toasts: [],
  input: 'mouse',
  deck: false,
};

const listeners = new Set<() => void>();

export function getState(): AppState { return state; }

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach(l => l());
}

export function setSession(patch: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)): void {
  const cur = state.session;
  if (!cur) return;
  const p = typeof patch === 'function' ? patch(cur) : patch;
  setState({ session: { ...cur, ...p } });
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Selector must return existing references (or primitives) to stay stable. */
export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}

// ─────────── helpers ───────────

export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const b = out[k];
    // `remap` is a record the user replaces as a whole
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) && k !== 'remap'
      ? deepMerge(b, v)
      : v;
  }
  return out as T;
}

export function getPath(obj: unknown, path: string): unknown {
  let v: unknown = obj;
  for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

export function patchFromPath(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.');
  const root: Record<string, unknown> = {};
  let cur = root;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else { const n: Record<string, unknown> = {}; cur[k] = n; cur = n; }
  });
  return root;
}
