// ⚠ PREVIEW ONLY — fake StreamController: a dark canvas "game" and synthetic stats. Aliased in place of
// src/renderer/stream/index.ts by tools/ui-preview/build.mjs. Implements the shared contract exactly.
import type { StageEvent } from '../../src/shared/api';
import { fitForTarget } from '../../src/shared/video-fit';
import type { StreamController, StreamControllerEvents, StreamStartOptions, StreamState } from '../../src/shared/stream-controller';

export type FakeMode = 'connecting' | 'connecting-cloud' | 'error-ice' | 'streaming' | 'reconnecting';
export const fakeStreamConfig: { mode: FakeMode } = { mode: 'streaming' };

type Fns = { [K in keyof StreamControllerEvents]: Set<StreamControllerEvents[K]> };

export function createStreamController(): StreamController {
  const fns: Fns = { state: new Set(), stage: new Set(), stats: new Set(), error: new Set(), rumble: new Set(), controllers: new Set(), overlayRequest: new Set(), audioLevel: new Set() };
  const emit = <K extends keyof StreamControllerEvents>(k: K, ...a: Parameters<StreamControllerEvents[K]>) => (fns[k] as Set<(...x: unknown[]) => void>).forEach(f => f(...a));
  let state: StreamState = 'idle';
  const setState = (s: StreamState) => { state = s; emit('state', s); };
  let timers: number[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let target: Pick<StreamStartOptions, 'kind' | 'targetId'> | null = null;

  const stage = (ev: StageEvent) => emit('stage', ev);

  const draw = (c: HTMLCanvasElement, label: string) => {
    const g = c.getContext('2d');
    if (!g) return;
    const w = c.width, h = c.height;
    g.fillStyle = '#0E141C'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#121A24'; g.fillRect(0, h * 0.54, w, h * 0.46);
    g.fillStyle = '#16202C'; g.fillRect(w * 0.08, h * 0.32, w * 0.34, h * 0.22);
    g.fillStyle = '#192433'; g.fillRect(w * 0.5, h * 0.2, w * 0.18, h * 0.34);
    g.fillStyle = '#3A4A60'; g.font = `${Math.round(h / 50)}px sans-serif`; g.textAlign = 'center';
    g.fillText(label, w / 2, h / 2);
  };

  return {
    get state() { return state; },
    on(ev, fn) { (fns[ev] as Set<unknown>).add(fn); return () => (fns[ev] as Set<unknown>).delete(fn); },
    async start(opts: StreamStartOptions) {
      target = opts;
      setState('starting');
      const now = Date.now();
      canvas = document.createElement('canvas');
      canvas.width = 1920; canvas.height = 1080;
      Object.assign(canvas.style, { width: '100%', height: '100%', objectFit: fitForTarget(opts.settings, opts) });
      draw(canvas, opts.settings.ui.lang === 'en' ? '[Game video - FIXTURE]' : '[Изображение игры — FIXTURE]');
      opts.container.replaceChildren(canvas);
      const mode = fakeStreamConfig.mode;
      stage({ stage: 'auth', status: 'active', at: now - 6600 });
      stage({ stage: 'auth', status: 'done', at: now - 6200 });
      if (mode === 'connecting') { stage({ stage: 'provision', status: 'active', at: now - 6200 }); return; }
      if (mode === 'connecting-cloud') { stage({ stage: 'provision', status: 'active', at: now - 6200, queuePosition: 12, etaSeconds: 170 }); return; }
      stage({ stage: 'provision', status: 'done', at: now - 3000 });
      stage({ stage: 'negotiate', status: 'active', at: now - 3000 });
      if (mode === 'error-ice') {
        stage({ stage: 'negotiate', status: 'done', at: now - 1800 });
        stage({ stage: 'connect', status: 'failed', at: now });
        emit('error', { code: 'ice_failed', message: 'FIXTURE ICE failure' });
        setState('error');
        return;
      }
      stage({ stage: 'negotiate', status: 'done', at: now - 1800 });
      stage({ stage: 'connect', status: 'done', at: now - 400 });
      stage({ stage: 'firstFrame', status: 'done', at: now });
      emit('controllers', [{ index: 0, id: 'FIXTURE Xbox Wireless Controller', name: 'Xbox Wireless', connection: 'bluetooth', isFlydigi: false, isDeck: false }]);
      setState('streaming');
      emit('rumble', { at: Date.now() - 2000, left: 0.4, right: 0.25, lt: 0, rt: 0, durationMs: 120 });
      const tick = () => emit('stats', {
        at: Date.now(), frameWidth: opts.settings.streaming.resolution === '720' ? 1280 : 1920, frameHeight: opts.settings.streaming.resolution === '720' ? 720 : 1080,
        fps: 60, kbps: 16900, rttMs: opts.settings.streaming.resolution === '720' ? 4 : 1, jitterMs: 0.4, jitterBufferMs: 2.6, decodeMsPerFrame: 0.3,
        packetsLost: 0, framesDropped: 0, codec: 'H.264 Main 4.2', decoder: 'FIXTURE', hardwareDecode: true,
      });
      tick();
      timers.push(window.setInterval(tick, 1000));
      timers.push(window.setInterval(() => emit('audioLevel', 0.3 + Math.random() * 0.2), 100));
      if (mode === 'reconnecting') timers.push(window.setTimeout(() => setState('reconnecting'), 50));
    },
    async stop() { timers.forEach(t => clearInterval(t)); timers = []; setState('ended'); },
    apply(settings) { if (canvas) canvas.style.objectFit = fitForTarget(settings, target); },
    pressGuide() { /* fixture */ },
    requestKeyframe() { /* fixture */ },
  };
}
