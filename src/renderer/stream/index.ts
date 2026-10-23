// Xenith stream engine (renderer). Implements the StreamController contract on top of the vendored
// xstreaming-player (MIT, vendor/xstreaming-player). Main does REST + tokens; this file does WebRTC.
import xStreamingPlayer from '../../../vendor/xstreaming-player/src/index';
import type { SessionError, SessionErrorCode, Settings, StageEvent, StageId, StreamStats } from '../../shared/api';
import type { StreamController, StreamControllerEvents, StreamStartOptions, StreamState } from '../../shared/stream-controller';
import type { XenithApiFull } from '../../shared/core-additions';
import { effectiveSettings, type EffectiveSettings } from './settings-map';
import { setVideoBandwidth } from './sdp';
import { StatsSampler } from './stats';
import { InputManager } from './input';
import { AudioTap } from './audio';
import { PostProcessor, type PostConfig } from './postprocess';

export { effectiveSettings } from './settings-map';
export { describeCodec } from './sdp';

/** Contract events + additive ones (proposed for stream-controller.ts). */
export interface XenithStreamEvents extends StreamControllerEvents {
  /** Lone short View press while streaming (not part of a View+Menu combo). View is still forwarded to the console. */
  hudToggle: () => void;
}

/** Non-contract diagnostics stream (test harness / log export). */
export interface StreamDebugEvent { at: number; type: string; data?: unknown }

const ERROR_CODES: SessionErrorCode[] = ['not_signed_in', 'auth_expired', 'no_console', 'console_unreachable', 'console_busy',
  'provision_failed', 'no_cloud_entitlement', 'ice_failed', 'stream_lost', 'network', 'unknown'];

export class StreamFailure extends Error {
  constructor(public sessionError: SessionError) { super(`${sessionError.code}: ${sessionError.message}`); }
}
class Aborted extends Error { constructor() { super('aborted'); } }

/** Main rejects IPC calls with Error messages; a leading/embedded SessionErrorCode token is honoured. */
export function toSessionError(e: unknown, fallback: SessionErrorCode): SessionError {
  if (e instanceof StreamFailure) return e.sessionError;
  const raw = String((e as any)?.message ?? e ?? 'unknown error');
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
  const m = new RegExp(`\\b(${ERROR_CODES.join('|')})\\b`).exec(message);
  let code = (m?.[1] as SessionErrorCode | undefined) ?? fallback;
  if (!m && /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(message)) code = 'network';
  return { code, message };
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) => new Promise<T>((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${what} timeout`)), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

function waitGathering(pc: RTCPeerConnection, ms: number) {
  return new Promise<void>((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', on); res(); };
    const on = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', on);
  });
}

function waitConnected(pc: RTCPeerConnection, ms: number) {
  return new Promise<void>((res, rej) => {
    if (pc.connectionState === 'connected') return res();
    const fin = (err?: Error) => { clearTimeout(t); pc.removeEventListener('connectionstatechange', on); err ? rej(err) : res(); };
    const on = () => {
      if (pc.connectionState === 'connected') fin();
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fin(new Error(`connection ${pc.connectionState}`));
    };
    const t = setTimeout(() => fin(new Error(`connect timeout (${pc.connectionState}/${pc.iceConnectionState})`)), ms);
    pc.addEventListener('connectionstatechange', on);
  });
}

interface Live {
  gen: number;
  sessionId: string;
  player: any;
  pc: RTCPeerConnection;
  holder: HTMLDivElement;
  sampler: StatsSampler;
  input: InputManager;
  post: PostProcessor | null;
  audioTap: AudioTap | null;
  audioEl: HTMLAudioElement | null;
  video: HTMLVideoElement | null;
  timers: number[];
  connected: boolean;
  firstFrame: { w: number; h: number } | null;
  firstFrameSent: boolean;
  inputStarted: boolean;
  lostTimer: number | null;
  answerSdp: string | null;
  connectedAt: number;
}

export class XenithStreamController implements StreamController {
  private _state: StreamState = 'idle';
  private listeners = new Map<string, Set<(...a: any[]) => void>>();
  private debugListeners = new Set<(e: StreamDebugEvent) => void>();
  private opts: StreamStartOptions | null = null;
  private settings: Settings | null = null;
  private eff: EffectiveSettings | null = null;
  private gen = 0;
  private live: Live | null = null;
  private stopping = false;
  private recovering = false;
  private reSessions = 0;
  private lastRumbleReport = 0;
  private overlayOpen = false;
  private offMain: (() => void) | null = null;

  static readonly MAX_RESESSIONS = 2;
  static readonly RESESSION_DELAYS_MS = [1500, 6000];
  /** Chromium's own ICE consent checks often recover a short 'disconnected' blip by themselves. */
  static readonly DISCONNECT_GRACE_MS = 4000;
  /** After this long streaming without trouble the re-session budget is refilled. */
  static readonly STABLE_RESET_MS = 60_000;

  get state() { return this._state; }

  on<K extends keyof XenithStreamEvents>(ev: K, fn: XenithStreamEvents[K]): () => void {
    let set = this.listeners.get(ev);
    if (!set) this.listeners.set(ev, (set = new Set()));
    set.add(fn as any);
    return () => { set!.delete(fn as any); };
  }

  /** Diagnostics (non-contract). */
  onDebug(fn: (e: StreamDebugEvent) => void): () => void { this.debugListeners.add(fn); return () => { this.debugListeners.delete(fn); }; }

  private emit<K extends keyof XenithStreamEvents>(ev: K, ...args: Parameters<XenithStreamEvents[K]>) {
    for (const fn of this.listeners.get(ev) ?? []) { try { fn(...args); } catch (e) { console.error('[xenith-stream] listener', ev, e); } }
  }

  private debug(type: string, data?: unknown) {
    const e = { at: Date.now(), type, data };
    for (const fn of this.debugListeners) { try { fn(e); } catch { /* ignore */ } }
  }

  private setState(s: StreamState) {
    if (s === this._state) return;
    this._state = s;
    this.debug('state', s);
    this.emit('state', s);
  }

  private stage(stage: StageId, status: StageEvent['status'], detail?: string) {
    const ev: StageEvent = { stage, status, at: Date.now(), ...(detail ? { detail } : {}) };
    this.emit('stage', ev);
    // Main owns auth/provision/negotiate (it does the REST exchange); the renderer reports what only it can see.
    const id = this.live?.sessionId;
    if (id && (stage === 'connect' || stage === 'firstFrame')) {
      try { window.xenith.sessionStage(id, ev); } catch { /* ignore */ }
    }
  }

  // ───────────────────────── lifecycle ─────────────────────────

  async start(opts: StreamStartOptions): Promise<void> {
    if (this._state === 'starting' || this._state === 'streaming' || this._state === 'reconnecting') throw new Error('stream already active');
    this.opts = opts;
    this.settings = opts.settings;
    this.eff = effectiveSettings(opts.settings, opts);
    this.stopping = false;
    this.recovering = false;
    this.reSessions = 0;
    this.debug('start', { kind: opts.kind, targetId: opts.targetId, eff: this.eff });
    this.listenMain();
    this.setState('starting');
    try {
      await this.connect();
    } catch (e) {
      if (e instanceof Aborted || this.stopping) return;
      const err = toSessionError(e, 'unknown');
      await this.fail(err);
      throw new StreamFailure(err);
    }
  }

  async stop(reason: 'user' | 'error' = 'user'): Promise<void> {
    if (this._state === 'idle' || this._state === 'ended' || this._state === 'error') return;
    this.stopping = true;
    this.gen++;
    const id = this.live?.sessionId ?? null;
    this.teardown();
    if (id) {
      try { await window.xenith.sessionStop(id, reason === 'error' ? 'error' : 'user'); } catch (e) { this.debug('stop.err', String((e as any)?.message || e)); }
    }
    this.offMain?.(); this.offMain = null;
    this.setState('ended');
  }

  /** Main reports server-side session death (keepalive 404/410 etc.) as 'sessionError'; treat it as a lost stream. */
  private listenMain() {
    if (this.offMain || typeof window.xenith?.on !== 'function') return;
    this.offMain = window.xenith.on((ev) => {
      if (ev.type !== 'sessionError') return;
      const live = this.live;
      if (!live || ev.sessionId !== live.sessionId) return;
      this.debug('main.sessionError', ev.error);
      if (live.connected) this.handleLoss(`main:${ev.error.code}`);
    });
  }

  private async fail(err: SessionError) {
    const id = this.live?.sessionId ?? null;
    this.gen++;
    this.teardown();
    if (id) { try { await window.xenith.sessionStop(id, 'error'); } catch { /* ignore */ } }
    this.offMain?.(); this.offMain = null;
    this.debug('error', err);
    this.emit('error', err);
    this.setState('error');
  }

  private async connect(): Promise<void> {
    const gen = ++this.gen;
    const opts = this.opts!;
    const x = window.xenith;
    const check = () => { if (gen !== this.gen || this.stopping) throw new Aborted(); };

    let sessionId: string;
    try { ({ sessionId } = await x.sessionStart(opts.kind, opts.targetId)); }
    catch (e) { check(); throw new StreamFailure(toSessionError(e, 'provision_failed')); }
    if (gen !== this.gen || this.stopping) { x.sessionStop(sessionId, 'user').catch(() => {}); throw new Aborted(); }
    this.debug('session', sessionId);

    const live = this.createLive(gen, sessionId);
    this.live = live;
    const eff = this.eff!;

    const offer: any = await live.player.createOffer();
    check();
    let sdp: string = offer.sdp;
    if (eff.capKbps) sdp = setVideoBandwidth(sdp, eff.capKbps);
    this.debug('sdp.offer', sdp);
    let answer: string;
    try { answer = await x.sessionSdp(sessionId, sdp); } catch (e) { check(); throw new StreamFailure(toSessionError(e, 'network')); }
    check();
    this.debug('sdp.answer', answer);
    live.answerSdp = answer;
    live.player.setRemoteOffer(answer);
    await waitGathering(live.pc, 3000);
    check();
    const local = live.player.getIceCandidates().map((c: RTCIceCandidate) => ({ candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex, sdpMid: c.sdpMid }));
    let remote: any[];
    try { remote = await x.sessionIce(sessionId, local); } catch (e) { check(); throw new StreamFailure(toSessionError(e, 'ice_failed')); }
    check();
    this.debug('ice', { local: local.length, remote: remote.length });
    live.player.setIceCandidates(remote);

    this.stage('connect', 'active');
    try { await waitConnected(live.pc, 20000); }
    catch (e) { check(); throw new StreamFailure({ code: 'ice_failed', message: String((e as any)?.message || e) }); }
    check();
    live.connected = true;
    live.connectedAt = Date.now();
    this.stage('connect', 'done');
    this.stage('firstFrame', 'active');
    if (live.firstFrame) this.sendFirstFrame(live);
    this.applyJitterTarget(live);
    this.setState('streaming');
    live.timers.push(window.setInterval(() => this.tick(live), 1000));
  }

  private createLive(gen: number, sessionId: string): Live {
    const opts = this.opts!, s = this.settings!, eff = this.eff!;
    const container = opts.container;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const holder = document.createElement('div');
    holder.id = `xenith-stream-${gen}-${Math.random().toString(36).slice(2, 8)}`;
    holder.className = 'xenith-stream';
    Object.assign(holder.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' });
    container.appendChild(holder);

    // Vendored Message.ts patches read these when the message channel handshakes.
    (globalThis as any).__xenithDims = { w: eff.dims.w, h: eff.dims.h };
    (globalThis as any).__xenithCaps = eff.caps;

    const player: any = new xStreamingPlayer(holder.id, { ui_touchenabled: false, input_mousekeyboard: s.controllers.mouseKeyboard || !!this.opts?.autoMouseKeyboard, input_legacykeyboard: true });
    player.setVibrationMode('Webview');
    player.setCodecPreferences('video/H264', { profiles: eff.codecProfiles });
    player._xenith_nexus_combo = false;
    player.bind();
    const pc: RTCPeerConnection = player._webrtcClient;

    const live: Live = {
      gen, sessionId, player, pc, holder, sampler: null as any, input: null as any, post: null, audioTap: null, audioEl: null,
      video: null, timers: [], connected: false, firstFrame: null, firstFrameSent: false, inputStarted: false, lostTimer: null, answerSdp: null, connectedAt: 0,
    };
    live.sampler = new StatsSampler(pc, () => live.answerSdp);
    this.live = live; // before install(): the first controllers scan must reach listeners

    live.input = new InputManager(player, {
      overlay: () => { if (this.live === live) { this.debug('overlayRequest'); this.emit('overlayRequest'); } },
      hudToggle: () => { if (this.live === live) { this.debug('hudToggle'); this.emit('hudToggle'); } },
      controllers: (list) => { if (this.live === live) { this.debug('controllers', list); this.emit('controllers', list); } },
      rumble: (r) => {
        if (this.live !== live) return;
        this.emit('rumble', r);
        // Feeds main's haptics diagnostics (core-additions), throttled to <= 10 Hz; a stop (all zero) always goes out.
        const zero = !r.left && !r.right && !r.lt && !r.rt;
        if (zero || r.at - this.lastRumbleReport >= 100) {
          this.lastRumbleReport = r.at;
          try { (window.xenith as XenithApiFull).reportRumble?.({ left: r.left, right: r.right, lt: r.lt, rt: r.rt }); } catch { /* ignore */ }
        }
      },
    });
    live.input.install();
    live.input.autoMouseKeyboard = !!this.opts?.autoMouseKeyboard;
    live.input.apply(s);
    live.input.setPaused(this.overlayOpen); // survives re-sessions

    // Resolution alias / bitrate request go out right after input starts (official web client order).
    const ic = player.getChannelProcessor('input');
    const origStart = ic.start.bind(ic);
    ic.start = () => { origStart(); live.inputStarted = true; if (this.live === live) this.sendStreamRequests(live, null); };

    pc.addEventListener('track', (ev) => this.onTrack(live, ev));
    pc.addEventListener('connectionstatechange', () => this.onConnState(live));
    player.getChannel('input')?.addEventListener('close', () => { if (this.live === live && live.connected) this.handleLoss('input-channel-closed'); });

    player.setMessageHandler((m: any) => { this.debug('console.msg', { target: m?.target, content: String(m?.content ?? '').slice(0, 300) }); return false; });
    player.setSdpHandler(async (_c: any, offer: any) => {
      try { player.setRemoteOffer(await window.xenith.sessionSdp(sessionId, offer.sdp)); } catch (e) { this.debug('renegotiate.err', String(e)); }
    });
    return live;
  }

  private onTrack(live: Live, ev: RTCTrackEvent) {
    if (this.live !== live) return;
    if (ev.track.kind === 'video') {
      const v: HTMLVideoElement | undefined = live.player._videoComponent?._video;
      if (!v) return;
      live.video = v;
      Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
      v.style.objectFit = this.eff!.fit;
      live.post = new PostProcessor(live.holder, v, live.player, (t, d) => this.debug(t, d));
      live.post.apply(this.postConfig());
      v.requestVideoFrameCallback((_now, meta) => {
        if (this.live !== live) return;
        live.firstFrame = { w: meta.width, h: meta.height };
        if (live.connected) this.sendFirstFrame(live);
        live.post?.setReady();
      });
    } else if (ev.track.kind === 'audio') {
      live.audioEl = live.player._audioComponent?._audioRender ?? null;
      this.applyAudio(live);
      try { live.audioTap = new AudioTap(ev.track, (rms) => { if (this.live === live) this.emit('audioLevel', rms); }); }
      catch (e) { this.debug('audioTap.err', String(e)); }
    }
    this.applyJitterTarget(live);
  }

  private sendFirstFrame(live: Live) {
    if (live.firstFrameSent || !live.firstFrame) return;
    live.firstFrameSent = true;
    this.stage('firstFrame', 'done', `${live.firstFrame.w}x${live.firstFrame.h}`);
  }

  private onConnState(live: Live) {
    if (this.live !== live) return;
    const st = live.pc.connectionState;
    this.debug('pc.state', st);
    if (!live.connected) return;
    if (st === 'failed') this.handleLoss('failed');
    else if (st === 'disconnected') {
      if (live.lostTimer === null) live.lostTimer = window.setTimeout(() => {
        live.lostTimer = null;
        if (this.live === live && live.pc.connectionState === 'disconnected') this.handleLoss('disconnected');
      }, XenithStreamController.DISCONNECT_GRACE_MS);
    }
  }

  private async tick(live: Live) {
    if (this.live !== live) return;
    if (this.reSessions > 0 && live.connectedAt && Date.now() - live.connectedAt > XenithStreamController.STABLE_RESET_MS) { this.reSessions = 0; this.debug('resession.budget.reset'); }
    if (live.pc.connectionState === 'closed' && !this.stopping) { this.handleLoss('pc-closed'); return; }
    try {
      const r = await live.sampler.sample();
      if (!r || this.live !== live) return;
      this.emit('stats', r.stats);
      this.debug('stats', { ...r.stats, ...r.extra, post: live.post?.mode ?? null });
      try { window.xenith.sessionReport(live.sessionId, r.stats); } catch { /* ignore */ }
    } catch (e) { this.debug('stats.err', String(e)); }
  }

  // ───────────────────────── reconnect ─────────────────────────

  private async handleLoss(reason: string) {
    const live = this.live;
    if (!live || this.stopping || this.recovering || this._state !== 'streaming') return;
    this.recovering = true;
    this.debug('loss', reason);
    this.setState('reconnecting');
    try {
      // No ICE restart here: measured on xHome (TESTLOG S12) an ICE-restart re-offer makes the console close the
      // input channel within 0.4 s and GET /sdp keeps returning the previous answer, so it never recovers.
      // A full re-session (new sessionStart) is what works (~8-9 s to first frame).
      while (this.reSessions < XenithStreamController.MAX_RESESSIONS && !this.stopping) {
        this.reSessions++;
        const oldId = this.live?.sessionId;
        this.teardown();
        if (oldId) { try { await window.xenith.sessionStop(oldId, 'replaced'); } catch { /* console may already have dropped it */ } }
        // Back off: right after a DELETE the console can answer play() with
        // "WNSError ... WaitingForServerToRegister" (TESTLOG S16), so give it a moment.
        await new Promise((r) => setTimeout(r, XenithStreamController.RESESSION_DELAYS_MS[this.reSessions - 1] ?? 5000));
        if (this.stopping) return;
        this.debug('resession', this.reSessions);
        try { await this.connect(); this.debug('resession.ok', this.reSessions); return; }
        catch (e) { if (e instanceof Aborted || this.stopping) return; this.debug('resession.err', String((e as any)?.message || e)); }
      }
      if (!this.stopping) await this.fail({ code: 'stream_lost', message: `stream lost (${reason}); reconnect failed` });
    } finally {
      this.recovering = false;
    }
  }

  private async tryIceRestart(live: Live): Promise<boolean> {
    const x = window.xenith;
    const t0 = performance.now();
    try {
      const before = live.player.getIceCandidates().length;
      live.pc.restartIce();
      const offer: any = await live.player.createOffer();
      let sdp: string = offer.sdp;
      if (this.eff?.capKbps) sdp = setVideoBandwidth(sdp, this.eff.capKbps);
      const answer = await withTimeout(x.sessionSdp(live.sessionId, sdp), 15000, 'sdp');
      if (this.live !== live) return false;
      live.answerSdp = answer;
      live.player.setRemoteOffer(answer);
      await waitGathering(live.pc, 3000);
      const local = live.player.getIceCandidates().slice(before).map((c: RTCIceCandidate) => ({ candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex, sdpMid: c.sdpMid }));
      const remote = await withTimeout(x.sessionIce(live.sessionId, local), 15000, 'ice');
      if (this.live !== live) return false;
      live.player.setIceCandidates(remote);
      await waitConnected(live.pc, 10000);
      this.debug('iceRestart.ok', { ms: Math.round(performance.now() - t0), local: local.length });
      return true;
    } catch (e) {
      this.debug('iceRestart.err', { ms: Math.round(performance.now() - t0), err: String((e as any)?.message || e) });
      return false;
    }
  }

  private teardown() {
    const live = this.live;
    if (!live) return;
    this.live = null;
    for (const t of live.timers) clearInterval(t);
    if (live.lostTimer !== null) clearTimeout(live.lostTimer);
    try { live.post?.dispose(); } catch { /* ignore */ }
    try { live.audioTap?.close(); } catch { /* ignore */ }
    try { live.input.dispose(); } catch { /* ignore */ }
    try { live.player.close(); } catch (e) { this.debug('close.err', String(e)); }
    live.holder.remove();
  }

  // ───────────────────────── settings ─────────────────────────

  private postConfig(): PostConfig {
    const s = this.settings!, e = this.eff!;
    return { sharpness: e.sharpness, fsr: e.fsr, brightness: s.video.brightness, contrast: s.video.contrast, saturation: s.video.saturation, fit: e.fit, bridge: s.haptics.bridgeMode };
  }

  private applyAudio(live: Live) {
    const a = live.audioEl, s = this.settings!;
    if (!a) return;
    a.volume = Math.min(1, Math.max(0, s.audio.volume));
    const sink = s.audio.outputDeviceId || '';
    const anyA = a as any;
    if (typeof anyA.setSinkId === 'function' && anyA.sinkId !== sink) {
      anyA.setSinkId(sink).then(() => this.debug('audio.sink', sink || 'default'), (e: any) => this.debug('audio.sink.err', String(e?.message || e)));
    }
  }

  private applyJitterTarget(live: Live) {
    const ms = this.eff?.jitterBufferTargetMs ?? null;
    for (const r of live.pc.getReceivers()) {
      const rr = r as any;
      if ('jitterBufferTarget' in rr) { try { rr.jitterBufferTarget = ms; } catch (e) { this.debug('jbt.err', String(e)); } }
      if ('playoutDelayHint' in rr) { try { rr.playoutDelayHint = ms === null ? null : ms / 1000; } catch { /* ignore */ } }
    }
  }

  private sendControl(live: Live, msg: Record<string, unknown>) {
    const ctl = live.player.getChannelProcessor('control');
    if (!ctl) return;
    ctl._sendControlMessage(msg);
    this.debug('control.sent', msg);
  }

  private sendStreamRequests(live: Live, prev: EffectiveSettings | null) {
    const e = this.eff!;
    if (!prev || prev.resolutionAlias !== e.resolutionAlias) this.sendControl(live, { message: 'userRequestedResolutionUpdate', resolutionAlias: e.resolutionAlias });
    if (e.requestKbps && (!prev || prev.requestKbps !== e.requestKbps)) this.sendControl(live, { message: 'rateControlBitrateUpdate', bitratebps: e.requestKbps * 1000 });
  }

  apply(settings: Settings): void {
    const prev = this.eff;
    this.settings = settings;
    this.eff = effectiveSettings(settings, this.opts);
    const live = this.live;
    if (!live) return;
    live.input.apply(settings);
    this.applyAudio(live);
    this.applyJitterTarget(live);
    live.post?.apply(this.postConfig());
    if (live.inputStarted) this.sendStreamRequests(live, prev);
    this.debug('apply', this.eff);
  }

  pressGuide(): void { this.live?.input.pressGuide(); }

  /** Additive: while the Xenith overlay is open the UI owns the pads; the console gets a neutral pad state.
   *  After close, input stays neutral until every pad button is released (max 2 s). */
  setOverlayOpen(open: boolean): void {
    this.overlayOpen = !!open;
    this.live?.input.setPaused(this.overlayOpen);
    this.debug('overlayOpen', this.overlayOpen);
  }

  requestKeyframe(): void { this.live?.player.getChannelProcessor('control')?.requestKeyframeRequest(); }

  /** Test hooks (non-contract): 'pcClose' simulates a dead transport; 'iceRestart' runs the (xHome-unsupported) ICE-restart exchange. */
  async debugAction(action: 'pcClose' | 'iceRestart' | 'keyframe'): Promise<unknown> {
    const live = this.live;
    if (!live) return 'no-live';
    if (action === 'pcClose') { live.pc.close(); return 'closed'; }
    if (action === 'keyframe') { this.requestKeyframe(); return 'sent'; }
    return this.tryIceRestart(live);
  }

  /** Non-contract: the live peer connection for diagnostics. */
  get peerConnection(): RTCPeerConnection | null { return this.live?.pc ?? null; }
}

/** Returns the engine; its static type is the contract, cast to XenithStreamController for additive members. */
export function createStreamController(): StreamController & Pick<XenithStreamController, 'setOverlayOpen' | 'on'> { return new XenithStreamController(); }
export type { StreamController, StreamStats };
