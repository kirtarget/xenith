// Picture pipeline on top of the vendored <video>: CSS picture filters + fit, CAS sharpening (vendored WebGL2Player),
// FSR 1.0 EASU+RCAS (vendored Video.startFSR, three.js), and Controller Bridge (nothing rendered).
import { WebGL2Player } from '../../../vendor/xstreaming-player/src/Fsr/WebGL2Player';
import type { VideoFit } from '../../shared/api';

export type PostMode = 'none' | 'cas' | 'fsr' | 'hidden';

export interface PostConfig {
  sharpness: number;   // 0..10 (effective)
  fsr: boolean;
  brightness: number; contrast: number; saturation: number;
  fit: VideoFit;
  bridge: boolean;
}

/** Xenith sharpness 1..10 -> RCAS stops (0 = strongest). 0 -> 10 stops (practically no sharpening, EASU only). */
export const rcasStops = (s: number) => (s <= 0 ? 10 : 2 * (1 - Math.min(10, s) / 10));
/** Xenith sharpness 1..10 -> vendored CAS sharpenFactor (mix = factor/2, so 10 -> full CAS). */
export const casFactor = (s: number) => Math.min(10, Math.max(0, s)) / 5;

export class PostProcessor {
  mode: PostMode = 'none';
  private cfg: PostConfig | null = null;
  private ready = false;
  private cas: WebGL2Player | null = null;
  private fsrCanvas: HTMLCanvasElement | null = null;
  private ro: ResizeObserver;
  private debounce: number | null = null;
  private onVideoResize = () => this.schedule();

  constructor(private holder: HTMLElement, private video: HTMLVideoElement, private player: any, private log: (t: string, d?: unknown) => void = () => {}) {
    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(holder);
    video.addEventListener('resize', this.onVideoResize);
  }

  /** Called on the first decoded frame (canvas paths need real video dimensions). */
  setReady() { this.ready = true; this.reconcile(); }

  apply(cfg: PostConfig) {
    if (this.mode === 'fsr' && this.cfg?.fit !== cfg.fit) this.teardownMode();
    this.cfg = cfg;
    this.reconcile();
  }

  dispose() {
    this.teardownMode();
    this.ro.disconnect();
    this.video.removeEventListener('resize', this.onVideoResize);
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.cfg = null;
  }

  private schedule() {
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => { this.debounce = null; this.reconcile(true); }, 150);
  }

  /** True when the stream is shown larger than its native size (FSR only makes sense then). */
  private upscaling(): boolean {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return false;
    const r = this.holder.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return Math.min(r.width / vw, r.height / vh) * dpr > 1.01;
  }

  private want(): PostMode {
    const c = this.cfg;
    if (!c) return 'none';
    if (c.bridge) return 'hidden';
    if (!this.ready) return 'none';
    if (c.fsr && this.upscaling()) return 'fsr';
    if (c.sharpness > 0) return 'cas';
    return 'none';
  }

  private reconcile(resized = false) {
    const c = this.cfg;
    if (!c) return;
    this.video.style.objectFit = c.fit;
    this.player._video_format = c.fit === 'fill' ? 'Stretch' : c.fit === 'cover' ? 'Zoom' : '';
    const f: string[] = [];
    if (c.brightness !== 1) f.push(`brightness(${c.brightness})`);
    if (c.contrast !== 1) f.push(`contrast(${c.contrast})`);
    if (c.saturation !== 1) f.push(`saturate(${c.saturation})`);
    this.holder.style.filter = f.join(' ');
    const m = this.want();
    if (m !== this.mode || (resized && m === 'fsr')) { this.teardownMode(); this.setupMode(m, c); }
    else if (m === 'cas') this.cas?.updateOptions({ sharpness: casFactor(c.sharpness) } as any, true);
    else if (m === 'fsr') this.player._videoComponent?.setRcasStops(rcasStops(c.sharpness));
    if (this.cas) this.cas.getCanvas().style.objectFit = c.fit;
  }

  private setupMode(m: PostMode, c: PostConfig) {
    this.mode = m;
    this.video.style.display = m === 'hidden' ? 'none' : '';
    this.video.style.opacity = m === 'cas' || m === 'fsr' ? '0' : '1';
    try {
      if (m === 'cas') {
        const p = new WebGL2Player(this.video);
        // brightness/contrast/saturation stay neutral in the shader (vendored scale is /100); CSS filter does them.
        p.updateOptions({ processing: 'cas', processingMode: 'quality', sharpness: casFactor(c.sharpness), brightness: 100, contrast: 100, saturation: 100 } as any);
        const cv = p.getCanvas();
        Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: c.fit, pointerEvents: 'none' });
        this.cas = p;
        p.init().catch((e) => this.log('post.cas.err', String(e)));
      } else if (m === 'fsr') {
        const cv = document.createElement('canvas');
        Object.assign(cv.style, { position: 'absolute', pointerEvents: 'none' });
        this.holder.appendChild(cv);
        this.fsrCanvas = cv;
        this.player._videoComponent.startFSR(cv, rcasStops(c.sharpness));
      }
      this.log('post.mode', m);
    } catch (e) {
      this.log('post.err', String((e as any)?.message || e));
      this.teardownMode();
      this.mode = 'none';
      this.video.style.opacity = '1';
    }
  }

  private teardownMode() {
    if (this.cas) { try { this.cas.destroy(); } catch { /* ignore */ } this.cas = null; }
    if (this.fsrCanvas) {
      try { this.player._videoComponent?.stopFSR(); } catch { /* ignore */ }
      this.fsrCanvas.remove();
      this.fsrCanvas = null;
    }
    this.video.style.opacity = '1';
    this.video.style.display = '';
    this.mode = 'none';
  }
}
