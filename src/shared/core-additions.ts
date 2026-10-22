// Additive contract extensions proposed by the CORE agent (src/shared/api.ts is untouched).
// The integrator may fold these into api.ts.
import type { LaunchIntent, XenithApi, XenithEvent } from './api';

export interface AudioOutput { deviceId: string; label: string }
export interface RumbleSample { left: number; right: number; lt: number; rt: number }

export interface XenithCoreExtras {
  /** Renderer pushes navigator.mediaDevices.enumerateDevices() audio outputs; main caches them for
   *  audioOutputs() and for the X-Haptics "game audio device" check. Fire-and-forget. */
  reportAudioOutputs(list: AudioOutput[]): void;
  /** Renderer forwards StreamController 'rumble' events (throttle to ≤10 Hz) so
   *  hapticsDiagnostics() can show the last rumble. Fire-and-forget. */
  reportRumble(r: RumbleSample): void;
}

/** Extra event: a second launch (e.g. a Steam shortcut with --xcloud=<titleId>) while Xenith is running. */
export type XenithEventExt = XenithEvent | { type: 'launchIntent'; intent: LaunchIntent };

export type XenithApiFull = XenithApi & XenithCoreExtras;
