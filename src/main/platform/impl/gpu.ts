import { app, BrowserWindow } from 'electron';
import type { GpuStatus } from '../../../shared/api';
import { angleBackendOf, decodeProfilesOf, devicesOf, formatProfiles, formatWebrtcProbe, GpuDevice, parseAngleRenderer, videoDecodeText, WEBRTC_PROBE_CODECS, WEBRTC_PROBE_SIZES, WebrtcProbe } from './gpu-format';

export type GpuStatusExt = GpuStatus & {
  hardwareH264: boolean;          // WebRTC H.264 decode at ≥1080p reported powerEfficient (= hardware decoder)
  devices: GpuDevice[];           // all adapters Chromium enumerated; `active` = the one used
  glRenderer: string | null;
  featureStatus: Record<string, string>;
  gpuInfoProfiles: string[];      // what app.getGPUInfo() exposes (Electron keeps only the last profile — see docs)
  webrtcProbe: WebrtcProbe | null;
};

let probeCache: WebrtcProbe | null = null;

/**
 * Asks the real WebRTC decoder factory, via navigator.mediaCapabilities.decodingInfo({type:'webrtc'}), which codecs
 * decode power-efficiently (= in hardware) and up to what size. Runs in a hidden about:blank window, ~150 ms, cached.
 */
export async function probeWebrtcDecode(): Promise<WebrtcProbe | null> {
  if (probeCache) return probeCache;
  let w: BrowserWindow | null = null;
  try {
    w = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await w.loadURL('about:blank');
    const script = `(async () => {
      const codecs = ${JSON.stringify(WEBRTC_PROBE_CODECS)}, sizes = ${JSON.stringify(WEBRTC_PROBE_SIZES)}, out = {};
      for (const [name, contentType] of codecs) { out[name] = [];
        for (const [width, height] of sizes) {
          try { const d = await navigator.mediaCapabilities.decodingInfo({ type: 'webrtc', video: { contentType, width, height, bitrate: 20000000, framerate: 60 } });
                out[name].push([width, height, d.supported, d.powerEfficient]); } catch { out[name].push([width, height, false, false]); }
        } }
      return out; })()`;
    probeCache = await w.webContents.executeJavaScript(script, true);
    return probeCache;
  } catch { return null; } finally { w?.destroy(); }
}

export async function gpuStatus(): Promise<GpuStatusExt> {
  let info: any = null;
  try { info = await app.getGPUInfo('complete'); } catch { info = null; }
  const featureStatus = app.getGPUFeatureStatus() as unknown as Record<string, string>;
  const devices = devicesOf(info);
  const glRenderer: string | null = info?.auxAttributes?.glRenderer ?? null;
  const angle = parseAngleRenderer(glRenderer ?? undefined);
  const active = devices.find((d) => d.active) ?? devices[0];
  const gpuInfoProfiles = formatProfiles(decodeProfilesOf(info));
  const probe = await probeWebrtcDecode();
  const webrtc = probe ? formatWebrtcProbe(probe) : { profiles: [], hardwareH264: false };
  const videoDecode = videoDecodeText(featureStatus.video_decode);
  const gpu = active?.name ?? angle.gpu ?? (active ? `${active.vendor} 0x${active.deviceId.toString(16)}` : null);
  return {
    gpu,
    videoDecode,
    decodeProfiles: webrtc.profiles.length ? webrtc.profiles : gpuInfoProfiles,
    angle: angleBackendOf(info) ?? angle.backend,
    vaapi: process.platform === 'linux' ? (videoDecode === 'hardware accelerated' && webrtc.hardwareH264) : null,
    hardwareH264: webrtc.hardwareH264,
    devices,
    glRenderer,
    featureStatus,
    gpuInfoProfiles,
    webrtcProbe: probe,
  };
}
