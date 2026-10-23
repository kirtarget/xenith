import type { DeepPartial, SessionKind, Settings, VideoFit } from './api';

export interface VideoFitTarget { kind: SessionKind; targetId: string }
export const MAX_CLOUD_FITS = 1000;

export function fitForTarget(settings: Settings, target: VideoFitTarget | null): VideoFit {
  if (target?.kind === 'cloud' && Object.hasOwn(settings.video.cloudFits, target.targetId)) return settings.video.cloudFits[target.targetId];
  return settings.video.fit;
}

export function fitPatch(settings: Settings, target: VideoFitTarget | null, fit: VideoFit): DeepPartial<Settings> {
  return target?.kind === 'cloud'
    ? { video: { cloudFits: Object.fromEntries([
      ...Object.entries(settings.video.cloudFits).filter(([id]) => id !== target.targetId).slice(1 - MAX_CLOUD_FITS),
      [target.targetId, fit],
    ]) } }
    : { video: { fit } };
}
