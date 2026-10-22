// Harness page: runs the real StreamController with env-configured settings, logs everything, auto-stops.
import { createStreamController, type XenithStreamController } from '../../src/renderer/stream/index';
import { DEFAULT_SETTINGS, type Settings, type StreamStats } from '../../src/shared/api';

const x = (window as any).xenithTest;
const L = (e: string, d?: unknown) => x.log(e, d);
const hud = document.getElementById('hud')!;

function merge<T>(base: T, patch: any): T {
  if (patch === undefined || patch === null) return base;
  if (typeof patch !== 'object' || Array.isArray(patch)) return patch as T;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const k of Object.keys(patch)) out[k] = merge((base as any)?.[k], patch[k]);
  return out;
}

interface Phase { label: string; from: number; samples: any[] }

/** Compares what the WebGL output canvas shows with the decoded video: 16-row luminance profiles + correlation
 *  (upright vs flipped). Proves the post-processing path renders a real, correctly oriented picture. */
function probe(): Promise<unknown> {
  const stage = document.getElementById('stage')!;
  const video = stage.querySelector('video') as HTMLVideoElement | null;
  const canvas = Array.from(stage.querySelectorAll('canvas')).find((c) => (c as HTMLCanvasElement).width > 1) as HTMLCanvasElement | undefined;
  if (!video) return Promise.resolve({ err: 'no video' });
  const ROWS = 16;
  const prof = (get: (row: number) => number[]) => Array.from({ length: ROWS }, (_, r) => { const px = get(r); let s = 0; for (let i = 0; i < px.length; i += 4) s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; return +(s / (px.length / 4)).toFixed(1); });
  const corr = (a: number[], b: number[]) => { const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length; let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? +(n / Math.sqrt(da * db)).toFixed(3) : null; };
  return new Promise((res) => {
    video.requestVideoFrameCallback(() => {
      const c2 = document.createElement('canvas'); c2.width = 320; c2.height = 180;
      const g2 = c2.getContext('2d', { willReadFrequently: true })!; g2.drawImage(video, 0, 0, 320, 180);
      const vp = prof((r) => Array.from(g2.getImageData(0, Math.floor((r + 0.5) * 180 / ROWS), 320, 1).data));
      const out: any = { videoSize: `${video.videoWidth}x${video.videoHeight}`, videoOpacity: video.style.opacity, videoProfile: vp };
      if (canvas) {
        const gl = (canvas.getContext('webgl2') as WebGL2RenderingContext | null);
        out.canvas = `${canvas.width}x${canvas.height} css ${canvas.style.width || '100%'}x${canvas.style.height || '100%'}`;
        if (gl) {
          const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
          const cp = prof((r) => { const y = H - 1 - Math.floor((r + 0.5) * H / ROWS); const buf = new Uint8Array(W * 4); gl.readPixels(0, y, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); return Array.from(buf); });
          out.canvasProfile = cp; out.corrUpright = corr(vp, cp); out.corrFlipped = corr(vp, [...cp].reverse());
        }
      }
      res(out);
    });
  });
}

async function main() {
  const cfg = await x.config();
  let settings: Settings = merge(DEFAULT_SETTINGS, cfg.settings);
  L('settings', settings);
  const ctrl = createStreamController() as XenithStreamController;
  const t0 = performance.now();
  let streamingAt = 0;
  const phases: Phase[] = [{ label: 'initial', from: 0, samples: [] }];
  let rumbles = 0, audioN = 0, audioSum = 0, audioMax = 0, audioNonZero = 0;
  const memTrace: any[] = [];

  ctrl.on('state', (s) => { L('state', { s, ms: Math.round(performance.now() - t0) }); if (s === 'streaming' && !streamingAt) { streamingAt = performance.now(); schedule(); } });
  ctrl.on('stage', (ev) => L('stage', { ...ev, ms: Math.round(performance.now() - t0) }));
  ctrl.on('error', (e) => L('error', e));
  ctrl.on('controllers', (c) => L('controllers', c));
  ctrl.on('overlayRequest', () => L('overlayRequest', { ms: Math.round(performance.now() - t0) }));
  ctrl.on('hudToggle', () => L('hudToggle', { ms: Math.round(performance.now() - t0) }));
  ctrl.on('rumble', (r) => { rumbles++; if (rumbles <= 30 || rumbles % 50 === 0) L('rumble', { n: rumbles, ...r }); });
  ctrl.on('audioLevel', (v) => { audioN++; audioSum += v; audioMax = Math.max(audioMax, v); if (v > 0.001) audioNonZero++; });
  ctrl.on('stats', (s: StreamStats) => {
    hud.textContent = `${cfg.name}  ${s.frameWidth}x${s.frameHeight} ${s.fps ?? '-'}fps ${s.kbps ?? '-'}kbps  dec ${s.decodeMsPerFrame ?? '-'}ms  jb ${s.jitterBufferMs ?? '-'}ms  rtt ${s.rttMs ?? '-'}  ${s.codec ?? ''}  lost ${s.packetsLost}`;
  });
  ctrl.onDebug((e) => {
    if (e.type === 'stats') { phases[phases.length - 1].samples.push({ t: Math.round((performance.now() - (streamingAt || t0)) / 1000), ...(e.data as any) }); L('stats', e.data); }
    else L('dbg.' + e.type, e.data);
  });

  setInterval(() => {
    const pm = (performance as any).memory;
    const m = pm ? { t: Math.round((performance.now() - t0) / 1000), usedMB: +(pm.usedJSHeapSize / 1048576).toFixed(1), totalMB: +(pm.totalJSHeapSize / 1048576).toFixed(1), dom: document.getElementsByTagName('*').length } : null;
    if (m) { memTrace.push(m); L('mem', m); }
    if (audioN) { L('audio', { n: audioN, avg: +(audioSum / audioN).toFixed(4), max: +audioMax.toFixed(4), nonZero: audioNonZero }); audioN = 0; audioSum = 0; audioMax = 0; audioNonZero = 0; }
  }, 10000);

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    for (const a of cfg.actions as any[]) {
      setTimeout(async () => {
        phases.push({ label: a.label || a.do, from: Math.round((performance.now() - streamingAt) / 1000), samples: [] });
        L('action', a);
        if (a.do === 'apply') { settings = merge(settings, a.settings); ctrl.apply(settings); }
        else if (a.do === 'guide') ctrl.pressGuide();
        else if (a.do === 'probe') L('probe', await probe());
        else if (a.do === 'overlayOpen') ctrl.setOverlayOpen(true);
        else if (a.do === 'overlayClose') ctrl.setOverlayOpen(false);
        else L('action.result', { do: a.do, r: await ctrl.debugAction(a.do) });
      }, a.at * 1000);
    }
    setTimeout(finish, cfg.seconds * 1000);
  }

  async function finish() {
    const agg = (arr: any[], k: string) => { const v = arr.map((s) => s[k]).filter((n) => typeof n === 'number'); return v.length ? { avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), min: Math.min(...v), max: Math.max(...v), n: v.length } : null; };
    const result = phases.map((p) => {
      const s = p.samples.filter((x) => x.t >= p.from + 3); // skip 3 s settling after each phase change / start
      const last = p.samples[p.samples.length - 1] || {};
      return {
        label: p.label, from: p.from, n: s.length,
        frame: last.frameWidth ? `${last.frameWidth}x${last.frameHeight}` : null, codec: last.codec, fmtp: last.fmtp, decoder: last.decoder, hardwareDecode: last.hardwareDecode, post: last.post,
        fps: agg(s, 'fps'), kbps: agg(s, 'kbps'), decodeMs: agg(s, 'decodeMsPerFrame'), procMs: agg(s, 'processingMsPerFrame'), jitterBufferMs: agg(s, 'jitterBufferMs'),
        audioJbMs: agg(s, 'audioJitterBufferMs'), rttMs: agg(s, 'rttMs'), jitterMs: agg(s, 'jitterMs'),
        packetsLost: last.packetsLost, framesDropped: last.framesDropped, freezeCount: last.freezeCount, jbTargetMs: agg(s, 'jitterBufferTargetMs'), jbMinMs: agg(s, 'jitterBufferMinimumMs'), remoteFmtp: last.remoteFmtp,
      };
    });
    L('result', { phases: result, rumbles, mem: { first: memTrace[0], last: memTrace[memTrace.length - 1] } });
    await ctrl.stop('user');
    L('stopped', { state: ctrl.state });
    setTimeout(() => x.done(), 1500);
  }

  try {
    await ctrl.start({ kind: cfg.cloudTitle ? 'cloud' : 'home', targetId: cfg.cloudTitle || cfg.serverId, targetName: cfg.cloudTitle || cfg.consoleName || 'Xbox', container: document.getElementById('stage')!, settings });
  } catch (e: any) {
    L('start.failed', e?.sessionError || String(e?.message || e));
    setTimeout(() => x.done(), 2000);
  }
}

main().catch((e) => { L('fatal', String(e?.stack || e)); setTimeout(() => x.done(), 2000); });
