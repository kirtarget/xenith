// Pure formatting of Chromium GPU info (unit-tested). Input = app.getGPUInfo('complete') / getGPUFeatureStatus().

// media::VideoCodecProfile (media/base/video_codecs.h). Values are part of Chromium's stable IPC enum.
const PROFILE: Record<number, string> = {
  0: 'h264 baseline', 1: 'h264 main', 2: 'h264 extended', 3: 'h264 high', 4: 'h264 high 10', 5: 'h264 high 4:2:2',
  6: 'h264 high 4:4:4', 7: 'h264 scalable baseline', 8: 'h264 scalable high', 9: 'h264 stereo high', 10: 'h264 multiview high',
  11: 'vp8', 12: 'vp9 profile 0', 13: 'vp9 profile 1', 14: 'vp9 profile 2', 15: 'vp9 profile 3',
  16: 'hevc main', 17: 'hevc main 10', 18: 'hevc main still picture',
  19: 'dolby vision 0', 20: 'dolby vision 4', 21: 'dolby vision 5', 22: 'dolby vision 7', 23: 'theora',
  24: 'av1 main', 25: 'av1 high', 26: 'av1 professional', 27: 'dolby vision 8', 28: 'dolby vision 9',
  29: 'hevc range extensions', 30: 'hevc high throughput', 31: 'hevc multiview main', 32: 'hevc scalable main',
  33: 'hevc 3d main', 34: 'hevc screen extended', 35: 'hevc scalable rext', 36: 'hevc high throughput screen extended',
  37: 'vvc main 10', 38: 'vvc main 12', 39: 'vvc main 12 intra', 40: 'vvc multilayer main 10', 41: 'vvc main 10 4:4:4',
  42: 'vvc main 12 4:4:4', 43: 'vvc main 16 4:4:4', 44: 'vvc main 12 4:4:4 intra', 45: 'vvc main 16 4:4:4 intra',
  46: 'vvc multilayer main 10 4:4:4', 47: 'vvc main 10 still', 48: 'vvc main 12 still', 49: 'vvc main 10 4:4:4 still',
  50: 'vvc main 12 4:4:4 still', 51: 'vvc main 16 4:4:4 still',
};

export function profileName(p: number | string): string {
  const n = typeof p === 'string' ? Number(p) : p;
  return PROFILE[n] ?? `profile ${p}`;
}

export interface RawProfile { profile: number | string; maxResolutionWidth?: number; maxResolutionHeight?: number; maxResolution?: { width: number; height: number } }

// Electron's GPUInfo enumerator writes every profile to the same auxAttributes key, so in practice only the LAST
// supported profile survives (observed on Electron 45: a single AV1 entry). Use the WebRTC probe for the real list.
export function decodeProfilesOf(info: any): RawProfile[] {
  const a = info?.auxAttributes ?? {};
  const v = a.videoDecodeAcceleratorSupportedProfile ?? info?.videoDecodeAcceleratorSupportedProfile ?? info?.videoDecodeAcceleratorSupportedProfiles ?? [];
  return Array.isArray(v) ? v : [v];
}

export function formatProfiles(raw: RawProfile[]): string[] {
  const out: string[] = [];
  for (const p of raw) {
    if (p == null) continue;
    const w = p.maxResolutionWidth ?? p.maxResolution?.width;
    const h = p.maxResolutionHeight ?? p.maxResolution?.height;
    const s = `${profileName(p.profile)}${w && h ? ` up to ${w}×${h}` : ''}`;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function videoDecodeText(status: string | undefined): string {
  switch (status) {
    case 'enabled': case 'enabled_on': case 'enabled_force': case 'enabled_force_on': return 'hardware accelerated';
    case 'disabled_software': case 'unavailable_software': return 'software only';
    case 'disabled_off': case 'disabled_off_ok': case 'unavailable_off': case 'unavailable_off_ok': return 'disabled';
    default: return status ? `unknown (${status})` : 'unknown';
  }
}

const VENDORS: Record<number, string> = { 0x1002: 'AMD', 0x10de: 'NVIDIA', 0x8086: 'Intel', 0x1414: 'Microsoft', 0x106b: 'Apple', 0x1af4: 'VirtIO', 0x15ad: 'VMware' };
export const vendorName = (id: number) => VENDORS[id] ?? `0x${id.toString(16).padStart(4, '0')}`;

export interface GpuDevice { active: boolean; vendorId: number; deviceId: number; vendor: string; name: string | null; driverVersion: string | null }
export function devicesOf(info: any): GpuDevice[] {
  const list = info?.gpuDevice ?? [];
  return (Array.isArray(list) ? list : [list]).map((d: any) => ({
    active: !!d.active, vendorId: d.vendorId ?? 0, deviceId: d.deviceId ?? 0, vendor: vendorName(d.vendorId ?? 0),
    name: d.deviceString || null, driverVersion: d.driverVersion || null,
  }));
}

/** "ANGLE (AMD, AMD Radeon RX 9070 XT (0x00007550) Direct3D11 vs_5_0 ps_5_0, D3D11)" → { backend: 'D3D11', gpu: 'AMD Radeon RX 9070 XT' } */
export function parseAngleRenderer(glRenderer: string | undefined): { backend: string | null; gpu: string | null } {
  if (!glRenderer) return { backend: null, gpu: null };
  const m = /^ANGLE \((.*)\)$/.exec(glRenderer.trim());
  if (!m) return { backend: null, gpu: glRenderer };
  const parts = m[1].split(', ');
  const backend = parts.length >= 3 ? parts[parts.length - 1].replace(/-[\d.]+$/, '') : null;
  const gpuRaw = parts.length >= 2 ? parts.slice(1, parts.length >= 3 ? -1 : undefined).join(', ') : parts[0];
  const gpu = gpuRaw.replace(/\s*\(0x[0-9a-f]+\).*$/i, '').replace(/\s+(Direct3D|Vulkan|OpenGL).*$/i, '').trim() || null;
  return { backend, gpu };
}

/** auxAttributes.glImplementationParts "(gl=egl-angle,angle=d3d11)" → "D3D11" */
export function angleBackendOf(info: any): string | null {
  const parts: string = info?.auxAttributes?.glImplementationParts ?? '';
  const m = /angle=([a-z0-9-]+)/i.exec(parts);
  if (!m || m[1] === 'none') return null;
  const map: Record<string, string> = { d3d11: 'D3D11', d3d9: 'D3D9', vulkan: 'Vulkan', opengl: 'OpenGL', gl: 'OpenGL', gles: 'OpenGL ES', metal: 'Metal', swiftshader: 'SwiftShader' };
  return map[m[1].toLowerCase()] ?? m[1];
}

// WebRTC decode probe (navigator.mediaCapabilities.decodingInfo({ type: 'webrtc' })).
export const WEBRTC_PROBE_CODECS: Array<[string, string]> = [
  ['h264 baseline', 'video/h264; profile-level-id=42e01f'],
  ['h264 main', 'video/h264; profile-level-id=4d002a'],
  ['h264 high', 'video/h264; profile-level-id=64002a'],
  ['hevc main', 'video/h265'],
  ['vp9', 'video/vp9'],
  ['av1', 'video/av1'],
];
export const WEBRTC_PROBE_SIZES: Array<[number, number]> = [[1920, 1080], [2560, 1440], [3840, 2160], [4096, 2304], [7680, 4320]];
/** codec name → [width, height, supported, powerEfficient][] */
export type WebrtcProbe = Record<string, Array<[number, number, boolean, boolean]>>;

/** Hardware = powerEfficient. "h264 main up to 4096×2304"; software-only codecs → "vp8 (software)". */
export function formatWebrtcProbe(probe: WebrtcProbe): { profiles: string[]; hardwareH264: boolean } {
  const profiles: string[] = [];
  let hardwareH264 = false;
  for (const [name] of WEBRTC_PROBE_CODECS) {
    const rows = probe[name] ?? [];
    const hw = rows.filter((r) => r[2] && r[3]);
    if (hw.length) {
      const max = hw.reduce((a, b) => (b[0] * b[1] > a[0] * a[1] ? b : a));
      profiles.push(`${name} up to ${max[0]}×${max[1]}`);
      if (name.startsWith('h264') && hw.some((r) => r[0] >= 1920)) hardwareH264 = true;
    } else if (rows.some((r) => r[2])) profiles.push(`${name} (software)`);
  }
  return { profiles, hardwareH264 };
}