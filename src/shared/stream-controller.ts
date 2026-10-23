// Contract between the renderer UI (screens) and the stream engine (src/renderer/stream/).
// OWNER: integrator. The stream agent implements `createStreamController` in
// src/renderer/stream/index.ts; the UI agent only imports from there and never touches WebRTC.

import type { ControllerInfo, SessionError, SessionKind, Settings, StageEvent, StreamStats } from './api';

export interface StreamStartOptions {
  kind: SessionKind;
  targetId: string;               // serverId or titleId
  targetName: string;
  container: HTMLElement;         // element the engine mounts <video>/<canvas> into; UI owns layout
  settings: Settings;             // snapshot at start; live changes go through apply()
  /** Forward mouse and keyboard even if the setting is off (Steam Deck: cloud title with mouse support, trackpad = mouse). */
  autoMouseKeyboard?: boolean;
}

export type StreamState = 'idle' | 'starting' | 'streaming' | 'reconnecting' | 'ended' | 'error';

export interface RumbleEvent { at: number; left: number; right: number; lt: number; rt: number; durationMs: number }

export interface StreamControllerEvents {
  state: (s: StreamState) => void;
  stage: (ev: StageEvent) => void;
  stats: (s: StreamStats) => void;            // ~1 Hz, real getStats() values only
  error: (e: SessionError) => void;
  rumble: (r: RumbleEvent) => void;
  controllers: (list: ControllerInfo[]) => void;
  overlayRequest: () => void;                 // user held View+Menu (overlayCombo)
  audioLevel: (rms: number) => void;          // 0–1, ~10 Hz, for X-Haptics diagnostics
  hudToggle: () => void;                      // lone short View tap (View still reaches the console; UI may ignore)
}

export interface StreamController {
  start(opts: StreamStartOptions): Promise<void>;
  stop(reason?: 'user' | 'error'): Promise<void>;
  /** Live-apply settings that can change mid-session (sharpness, picture, HUD-independent, audio device, vibration, dead zone, bridge mode). */
  apply(settings: Settings): void;
  pressGuide(): void;                          // send Xbox (Nexus) button
  requestKeyframe(): void;
  /** While the Xenith overlay is open the UI owns the pads: engine sends neutral input and resumes after release. */
  setOverlayOpen?(open: boolean): void;
  readonly state: StreamState;
  on<K extends keyof StreamControllerEvents>(ev: K, fn: StreamControllerEvents[K]): () => void;
}

export type CreateStreamController = () => StreamController;
