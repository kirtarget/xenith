// Settings normalisation (pure, unit-tested): deep-merge with DEFAULT_SETTINGS, type checks,
// enum validation and numeric clamping. Unknown keys are dropped; missing keys get defaults,
// so files written by older or newer versions always load.
import { DEFAULT_SETTINGS, type DeepPartial, type Settings } from '../shared/api';
import { MAX_CLOUD_FITS } from '../shared/video-fit';

interface Spec { enum?: readonly string[]; min?: number; max?: number; int?: boolean; nullableString?: boolean; record?: boolean; maxLen?: number; keyPattern?: RegExp; maxEntries?: number }

const SPEC: Record<string, Spec> = {
  'streaming.profile': { enum: ['low-latency', 'quality', 'battery'] },
  'streaming.resolution': { enum: ['auto', '1440', '1080', '720'] },
  'streaming.bitrateMode': { enum: ['auto', 'balanced', 'high', 'custom'] },
  'streaming.customKbps': { min: 5000, max: 40000, int: true },
  'streaming.codec': { enum: ['main', 'baseline'] },
  'streaming.lastServerId': { nullableString: true },
  'video.sharpness': { min: 0, max: 10 },
  'video.brightness': { min: 0.5, max: 1.5 },
  'video.contrast': { min: 0.5, max: 1.5 },
  'video.saturation': { min: 0.5, max: 1.5 },
  'video.fit': { enum: ['contain', 'cover', 'fill'] },
  'video.cloudFits': { record: true, enum: ['contain', 'cover', 'fill'], keyPattern: /^(?!\.{1,2}$)(?!__proto__$|constructor$|prototype$)[A-Za-z0-9._-]{1,64}$/, maxEntries: MAX_CLOUD_FITS },
  'video.hud': { enum: ['off', 'compact', 'full'] },
  'video.hudCorner': { enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] },
  'audio.outputDeviceId': { maxLen: 512 },
  'audio.volume': { min: 0, max: 1 },
  'controllers.deadZone': { min: 0, max: 0.3 },
  'controllers.remap': { record: true },
  'network.regionName': { nullableString: true },
  'steam.artworkSource': { enum: ['xcloud', 'none'] },
  'ui.lang': { enum: ['ru', 'en'] },
  'ui.scale': { enum: ['xs', 's', 'm', 'l', 'xl'] },
  'ui.layout': { enum: ['auto', 'desktop', 'deck'] },
  'advanced.gpuMode': { enum: ['auto', 'high-performance', 'low-power'] },
  'advanced.renderPipeline': { enum: ['auto', 'd3d11', 'vulkan', 'gl'] },
};

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

function normalize(def: any, raw: any, path: string): any {
  const spec = SPEC[path] || {};
  if (spec.record) {
    if (!isObj(raw)) return { ...def };
    const o: Record<string, string> = {};
    let count = 0;
    for (const [k, v] of Object.entries(raw)) {
      if (count >= (spec.maxEntries ?? Infinity)) break;
      if (typeof v !== 'string' || v.length > 32) continue;
      if (spec.keyPattern ? !spec.keyPattern.test(k) : k.length > 32) continue;
      if (spec.enum && !spec.enum.includes(v)) continue;
      o[k] = v;
      count++;
    }
    return o;
  }
  if (spec.nullableString) {
    if (raw === null) return null;
    return typeof raw === 'string' && raw.length > 0 && raw.length <= 256 ? raw : def;
  }
  if (isObj(def)) {
    const src = isObj(raw) ? raw : {};
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(def)) out[k] = normalize(def[k], src[k], path ? `${path}.${k}` : k);
    return out;
  }
  if (typeof def === 'number') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return def;
    let v = n;
    if (spec.min !== undefined) v = Math.max(spec.min, v);
    if (spec.max !== undefined) v = Math.min(spec.max, v);
    if (spec.int) v = Math.round(v);
    return v;
  }
  if (typeof def === 'boolean') return typeof raw === 'boolean' ? raw : def;
  if (typeof def === 'string') {
    if (typeof raw !== 'string') return def;
    if (spec.enum && !spec.enum.includes(raw)) return def;
    if (spec.maxLen !== undefined && raw.length > spec.maxLen) return def;
    return raw;
  }
  return def;
}

export function normalizeSettings(raw: unknown): Settings {
  return normalize(DEFAULT_SETTINGS, raw, '') as Settings;
}

/** Record settings are replaced as a whole rather than merged as settings groups. */
function merge(base: any, patch: any, path: string): any {
  if (!isObj(patch) || SPEC[path]?.record) return patch === undefined ? base : patch;
  if (!isObj(base)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = merge(base[k], v, path ? `${path}.${k}` : k);
  return out;
}

export function applySettingsPatch(current: Settings, patch: DeepPartial<Settings> | unknown): Settings {
  // invalid values in the patch fall back to the CURRENT value (not the default)
  const cur = normalizeSettings(current);
  return normalize(cur, merge(cur, patch, ''), '') as Settings;
}
