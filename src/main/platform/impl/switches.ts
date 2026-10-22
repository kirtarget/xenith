// Chromium command-line switches applied before app 'ready'. planSwitches() is pure (unit-tested);
// applySwitchPlan() writes them with app.commandLine.
//
// Chromium 156 (Electron 45) feature names for Linux VA-API, per chromium/src docs/gpu/vaapi.md (main, 2026):
//   OpenGL path : --use-gl=angle --use-angle=gl
//                 --enable-features=AcceleratedVideoDecodeLinuxGL[,AcceleratedVideoDecodeLinuxZeroCopyGL]
//   Vulkan path : --use-gl=angle --use-angle=vulkan
//                 --enable-features=VaapiIgnoreDriverChecks,Vulkan,DefaultANGLEVulkan,VulkanFromANGLE
//   both        : --ignore-gpu-blocklist
// "VaapiVideoDecoder" / "VaapiVideoDecodeLinuxGL" are the pre-2024 names and no longer exist in 156.
// See docs/platform/linux-gpu.md.
import type { Settings } from '../../../shared/api';
import type { DeckDetection } from './deck';

export interface SwitchPlan {
  switches: Array<[string, string?]>;
  enableFeatures: string[];
  disableFeatures: string[];
  notes: string[];
}

export function planSwitches(settings: Pick<Settings, 'advanced'>, platform: NodeJS.Platform, deck: DeckDetection, env: Record<string, string | undefined> = {}): SwitchPlan {
  const plan: SwitchPlan = { switches: [], enableFeatures: [], disableFeatures: [], notes: [] };
  const sw = (k: string, v?: string) => { if (!plan.switches.some(([x]) => x === k)) plan.switches.push(v === undefined ? [k] : [k, v]); };
  const { gpuMode, renderPipeline } = settings.advanced;

  // GPU selection (Windows/macOS dual-GPU systems; no-op on single-GPU Linux like the Deck).
  if (gpuMode === 'high-performance') sw('force_high_performance_gpu');
  else if (gpuMode === 'low-power') sw('force_low_power_gpu');

  sw('enable-gpu-rasterization');

  if (platform === 'win32') {
    if (renderPipeline === 'd3d11' || renderPipeline === 'vulkan' || renderPipeline === 'gl') sw('use-angle', renderPipeline);
    else plan.notes.push('ANGLE backend: Chromium default (D3D11)');
  } else if (platform === 'linux') {
    if (deck.isGamescope) {
      // gamescope exposes an Xwayland DISPLAY to clients; its Wayland socket is not a general desktop compositor.
      sw('ozone-platform', 'x11');
      sw('force-device-scale-factor', '1');
      plan.notes.push('gamescope: X11 via Xwayland, scale 1, app should start fullscreen');
    } else {
      sw('ozone-platform-hint', 'auto');
      if (deck.isWayland) plan.enableFeatures.push('WaylandWindowDecorations');
    }
    if (env.XENITH_NO_VAAPI === '1') {
      plan.notes.push('VA-API disabled by XENITH_NO_VAAPI=1');
    } else {
      sw('ignore-gpu-blocklist');
      sw('use-gl', 'angle');
      if (renderPipeline === 'vulkan') {
        sw('use-angle', 'vulkan');
        plan.enableFeatures.push('VaapiIgnoreDriverChecks', 'Vulkan', 'DefaultANGLEVulkan', 'VulkanFromANGLE');
      } else {
        sw('use-angle', 'gl');
        plan.enableFeatures.push('AcceleratedVideoDecodeLinuxGL');
        // Zero-copy helps on EGL/Wayland; gamescope (X11 via Xwayland, EGL) also benefits on Mesa.
        if (deck.isWayland || deck.isGamescope) plan.enableFeatures.push('AcceleratedVideoDecodeLinuxZeroCopyGL');
      }
    }
  } else if (platform === 'darwin') {
    if (renderPipeline === 'gl') sw('use-angle', 'gl');
    // auto/d3d11/vulkan → Chromium default (Metal)
  }
  return plan;
}

/** Merges a comma list switch with whatever is already on the command line (e.g. set by core). */
export function mergeFeatureList(existing: string | undefined, add: string[]): string {
  const out = (existing ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const f of add) if (!out.includes(f)) out.push(f);
  return out.join(',');
}

export interface CommandLineLike {
  appendSwitch(name: string, value?: string): void;
  getSwitchValue(name: string): string;
  hasSwitch(name: string): boolean;
}

export function applySwitchPlan(cl: CommandLineLike, plan: SwitchPlan): void {
  for (const [k, v] of plan.switches) {
    if (k === 'force_high_performance_gpu' && cl.hasSwitch('force_low_power_gpu')) continue;
    if (k === 'force_low_power_gpu' && cl.hasSwitch('force_high_performance_gpu')) continue; // core sets HP today
    if (v === undefined) cl.appendSwitch(k); else cl.appendSwitch(k, v);
  }
  if (plan.enableFeatures.length) cl.appendSwitch('enable-features', mergeFeatureList(cl.getSwitchValue('enable-features'), plan.enableFeatures));
  if (plan.disableFeatures.length) cl.appendSwitch('disable-features', mergeFeatureList(cl.getSwitchValue('disable-features'), plan.disableFeatures));
}
