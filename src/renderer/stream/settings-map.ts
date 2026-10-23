// Maps user Settings to the concrete knobs the stream engine turns.
import type { SessionKind, Settings, VideoFit } from '../../shared/api';
import { fitForTarget } from '../../shared/video-fit';

export type ResolutionAlias = '1440' | '1080HQ' | '1080' | '720HQ' | '720';

export interface EffectiveSettings {
  /** Control-channel `userRequestedResolutionUpdate` alias (official web client semantics). */
  resolutionAlias: ResolutionAlias;
  /** Client dimensions sent in-stream (`dimensionschanged`). */
  dims: { w: number; h: number };
  /** `clientdevicecapabilities` payload. Upstream default `{}`; T3 showed no measurable effect of a filled object. */
  caps: Record<string, unknown>;
  /** H.264 profile-level-id prefixes to prefer in the offer. */
  codecProfiles: string[];
  /** b=AS cap (kbps) written into the offer's video section; null = none. Needs a new session to change. */
  capKbps: number | null;
  /** `rateControlBitrateUpdate` request (kbps); null = do not send. Live. */
  requestKbps: number | null;
  /** RTCRtpReceiver.jitterBufferTarget (ms) for audio+video; null = browser default. Live. */
  jitterBufferTargetMs: number | null;
  /** 0 = off, 1..10. */
  sharpness: number;
  /** FSR 1.0 (EASU+RCAS) when the window is larger than the stream. */
  fsr: boolean;
  fit: VideoFit;
}

export const BALANCED_CAP_KBPS = 12000;
export const HIGH_REQUEST_KBPS = 30000;
export const QUALITY_DEFAULT_SHARPNESS = 3;
export const QUALITY_JITTER_TARGET_MS = 40;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export function effectiveSettings(s: Settings, target: { kind: SessionKind; targetId: string } | null = null): EffectiveSettings {
  const st = s.streaming;
  const battery = st.profile === 'battery';
  const customKbps = clamp(st.customKbps, 5000, 40000);
  const highBitrate = st.bitrateMode === 'high' || (st.bitrateMode === 'custom' && customKbps >= 15000);

  const res = battery ? '720' : st.resolution;
  let resolutionAlias: ResolutionAlias;
  if (res === 'auto' || res === '1440') resolutionAlias = '1440';          // desktop Auto -> "1440" (official client)
  else if (res === '1080') resolutionAlias = highBitrate ? '1080HQ' : '1080';
  else resolutionAlias = highBitrate && !battery ? '720HQ' : '720';

  const dims = resolutionAlias === '1440' ? { w: 2560, h: 1440 }
    : resolutionAlias.startsWith('1080') ? { w: 1920, h: 1080 } : { w: 1280, h: 720 };

  const capKbps = st.bitrateMode === 'balanced' ? BALANCED_CAP_KBPS : st.bitrateMode === 'custom' ? customKbps : null;
  const requestKbps = st.bitrateMode === 'high' ? HIGH_REQUEST_KBPS : st.bitrateMode === 'custom' ? customKbps : null;

  const jitterBufferTargetMs = st.profile === 'low-latency' ? 0 : st.profile === 'quality' ? QUALITY_JITTER_TARGET_MS : null;

  const userSharp = Math.round(clamp(s.video.sharpness, 0, 10));
  const sharpness = battery ? 0 : st.profile === 'quality' && userSharp === 0 ? QUALITY_DEFAULT_SHARPNESS : userSharp;

  return {
    resolutionAlias, dims, caps: {},
    codecProfiles: st.codec === 'baseline' ? ['42e', '420'] : ['4d'],
    capKbps, requestKbps, jitterBufferTargetMs,
    sharpness, fsr: !battery && s.video.upscaleFsr, fit: fitForTarget(s, target),
  };
}
