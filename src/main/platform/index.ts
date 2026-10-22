// Platform layer contract (main process). OWNER of implementation: platform agent.
// The core agent imports ONLY these functions; until implemented they throw 'not implemented'.
import type { GpuStatus, HapticsDiagnostics, PlatformInfo, Settings, SteamStatus, CloudTitle } from '../../shared/api';

export interface PlatformLayer {
  /** Called before app 'ready': applies Chromium switches (GPU mode, ANGLE backend, VA-API on Linux, low-latency flags). */
  applyEarlySwitches(settings: Settings): void;
  info(): PlatformInfo;
  gpuStatus(): Promise<GpuStatus>;
  hapticsDiagnostics(lastRumble: HapticsDiagnostics['rumble'], audioDeviceLabel: string | null): Promise<HapticsDiagnostics>;
  steam: {
    status(): Promise<SteamStatus>;
    addLibraryShortcut(): Promise<{ ok: boolean; message: string }>;
    addCloudShortcut(title: CloudTitle): Promise<{ ok: boolean; message: string }>;
    resyncArtwork(titles: CloudTitle[]): Promise<{ ok: boolean; count: number }>;
    shortcutTitleIds(): Promise<string[]>;   // xCloud titleIds that already have a Steam shortcut
  };
}

const notImplemented = (name: string) => () => { throw new Error(`platform.${name} not implemented`); };

// Placeholder so the core compiles before the platform agent lands. Replaced by ./impl.
export let platform: PlatformLayer = {
  applyEarlySwitches: () => {},
  info: notImplemented('info') as any,
  gpuStatus: notImplemented('gpuStatus') as any,
  hapticsDiagnostics: notImplemented('hapticsDiagnostics') as any,
  steam: {
    status: notImplemented('steam.status') as any,
    addLibraryShortcut: notImplemented('steam.addLibraryShortcut') as any,
    addCloudShortcut: notImplemented('steam.addCloudShortcut') as any,
    resyncArtwork: notImplemented('steam.resyncArtwork') as any,
    shortcutTitleIds: async () => [],
  },
};
export function setPlatformLayer(p: PlatformLayer) { platform = p; }
