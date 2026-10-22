// Session manager: main does REST + tokens; the renderer's StreamController does WebRTC.
//
// Lifecycle (both kinds):
//   sessionStart → returns { sessionId } immediately; provisioning runs in the background and is reported
//   through 'stage' events (auth, provision[, queue position/ETA for xCloud]) and 'sessionError'.
//   sessionSdp / sessionIce wait for provisioning to finish (and reject with "[code] message" on failure),
//   then exchange SDP/ICE ('negotiate' stage is emitted by main because main does the exchange).
//   Renderer reports 'connect' / 'firstFrame' through sessionStage and ~1 Hz stats through sessionReport.
//   sessionStop (or an error, or app quit) → DELETE session → HistoryEntry → history.json → 'sessionEnded'.
import type { CloudTitle, ConsoleInfo, HistoryEntry, IceCandidateInit, SessionError, SessionKind, Settings, StageEvent, StageId, StreamStats } from '../shared/api';
import type { XboxAuth } from './xbox-auth';
import { GssvError, streamProfileFor, type ApiBase, type GssvApi } from './xhome-api';
import { buildHistoryEntry, StageClock, StatsAccumulator } from './history-core';
import type { HistoryStore } from './history';
import { SessionFail, ipcError, toSessionError } from './errors';
import { emit } from './events';
import { randomId, sleep, withTimeout } from './util';
import { log, logWarn } from './log';

export interface SessionTiming {
  homeProvisionMs: number;   // → console_unreachable
  cloudProvisionMs: number;  // excluding time spent in the WaitingForResources queue
  queueMs: number;
  keepaliveMs: number;
  pollMs: number;
  waitPollMs: number;        // waittime / queue refresh
}
export const DEFAULT_TIMING: SessionTiming = { homeProvisionMs: 60_000, cloudProvisionMs: 120_000, queueMs: 45 * 60_000, keepaliveMs: 30_000, pollMs: 1000, waitPollMs: 10_000 };

interface Session {
  id: string;
  kind: SessionKind;
  targetId: string;
  targetName: string;
  base: ApiBase | null;
  path: string | null;
  startedAt: number;
  playAt: number | null;
  firstFrameAt: number | null;
  clock: StageClock;
  acc: StatsAccumulator;
  ready: Promise<void>;
  abort: AbortController;
  keepalive: NodeJS.Timeout | null;
  keepaliveFailures: number;
  lastHealthyAt: number;          // last renderer stats sample with frames flowing
  ended: boolean;
  error: SessionError | null;
}

export interface SessionDeps {
  auth: XboxAuth;
  api: GssvApi;
  history: HistoryStore;
  settings: () => Settings;
  rememberConsole: (serverId: string) => void;
  findConsole: (serverId: string) => Promise<ConsoleInfo | null>;
  findTitle: (titleId: string) => Pick<CloudTitle, 'name'> | null;
  onActiveChange?: (active: number) => void;
  timing?: Partial<SessionTiming>;
}

const BUSY = /busy|inuse|in_use|alreadystreaming|already|sessionlimit|conflict/i;

export class SessionManager {
  private sessions = new Map<string, Session>();

  private t: SessionTiming;

  constructor(private d: SessionDeps) { this.t = { ...DEFAULT_TIMING, ...d.timing }; }

  activeCount() { return [...this.sessions.values()].filter((s) => !s.ended).length; }

  start(kind: SessionKind, targetId: string): { sessionId: string } {
    if (kind !== 'home' && kind !== 'cloud') throw new Error('invalid kind');
    if (typeof targetId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(targetId)) throw ipcError({ code: kind === 'home' ? 'no_console' : 'unknown', message: 'invalid target id' });
    const others = [...this.sessions.values()].filter((s) => !s.ended);
    const s: Session = {
      id: randomId(), kind, targetId, targetName: targetId, base: null, path: null,
      startedAt: Date.now(), playAt: null, firstFrameAt: null, clock: new StageClock(), acc: new StatsAccumulator(),
      ready: Promise.resolve(), abort: new AbortController(), keepalive: null, keepaliveFailures: 0, lastHealthyAt: 0, ended: false, error: null,
    };
    this.sessions.set(s.id, s);
    this.d.onActiveChange?.(this.activeCount());
    s.ready = (async () => {
      // let the IPC reply carrying the sessionId go out before the first stage event
      await new Promise((r) => setTimeout(r, 0));
      for (const o of others) await this.end(o, 'replaced');
      await this.provision(s);
    })();
    s.ready.catch(() => { /* surfaced via sessionError + sdp/ice rejection */ });
    log('session.start', { id: s.id, kind, targetId });
    return { sessionId: s.id };
  }

  private get(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw ipcError({ code: 'unknown', message: 'unknown session' });
    return s;
  }

  private stage(s: Session, stage: StageId, status: StageEvent['status'], extra: Partial<StageEvent> = {}) {
    if (s.ended && status !== 'failed') return;
    const ev: StageEvent = { stage, status, at: Date.now(), ...extra };
    s.clock.mark(ev);
    emit({ type: 'stage', sessionId: s.id, ev });
  }

  private async provision(s: Session) {
    const { auth, api } = this.d;
    const settings = this.d.settings();
    let current: StageId = 'auth';
    try {
      this.stage(s, 'auth', 'active');
      if (!auth.hasAccount()) throw new SessionFail('not_signed_in', 'Not signed in');
      if (s.kind === 'home') {
        s.base = await api.base('xhome');
        const c = await this.d.findConsole(s.targetId);
        if (c) s.targetName = c.name;
        else throw new SessionFail('no_console', 'Console not found on this account');
        const active = await api.activeSessions(s.base, 'home').catch((e) => { logWarn('session.active_check_failed', e); return []; });
        if (active.length) {
          log('session.active_found', { count: active.length, states: active.map((a: any) => a?.state ?? a?.sessionState ?? null) });
          throw new SessionFail('console_busy', 'The console already has an active Remote Play session');
        }
      } else {
        const ent = await auth.cloudEntitlement();
        if (!ent.offering) throw new SessionFail('no_cloud_entitlement', 'No Xbox Cloud Gaming entitlement');
        s.base = await api.base(ent.offering, settings.network.regionName);
        s.targetName = this.d.findTitle(s.targetId)?.name ?? s.targetId;
      }
      if (s.abort.signal.aborted) return;
      this.stage(s, 'auth', 'done');

      current = 'provision';
      this.stage(s, 'provision', 'active');
      const prof = streamProfileFor(settings.streaming.resolution);
      s.playAt = Date.now();
      s.path = await api.play(s.base, s.kind, { targetId: s.targetId, ...prof, locale: settings.ui.lang === 'ru' ? 'ru-RU' : 'en-US' }, s.abort.signal);
      log('session.play_ok', { id: s.id, kind: s.kind, region: s.base.region, osName: prof.osName, dims: `${prof.width}x${prof.height}` });
      await this.waitProvisioned(s);
      if (s.abort.signal.aborted) return;
      this.stage(s, 'provision', 'done');
      if (s.kind === 'home') this.d.rememberConsole(s.targetId);
      s.keepalive = setInterval(() => void this.keepalive(s), this.t.keepaliveMs);
    } catch (e) {
      if (s.abort.signal.aborted && !(e instanceof SessionFail)) throw ipcError({ code: 'unknown', message: 'session stopped' });
      const err = toSessionError(e, current === 'auth' ? 'unknown' : 'provision_failed');
      this.stage(s, current, 'failed', { detail: err.code });
      this.fail(s, err);
      throw ipcError(err);
    }
  }

  private async waitProvisioned(s: Session) {
    const { api, auth } = this.d;
    const b = s.base!, p = s.path!;
    let connected = false, lastState = '', provisionStart = Date.now(), queueStart = 0, lastWaitPoll = 0;
    while (!s.abort.signal.aborted) {
      const st = await api.state(b, p, s.abort.signal);
      const state = String(st?.state ?? '');
      if (state !== lastState) { log('session.state', { id: s.id, state, error: st?.errorDetails?.code }); lastState = state; }
      if (state === 'Provisioned') return;
      if (state === 'Failed') {
        const code = String(st?.errorDetails?.code ?? 'Failed'), msg = String(st?.errorDetails?.message ?? '');
        // WNSError 'WaitingForServerToRegister': the console is not registered with Xbox services (off, energy saving, offline, booting).
        const offline = s.kind === 'home' && /WaitingForServerToRegister|ErrorCallingWNS/i.test(code + ' ' + msg);
        throw new SessionFail(BUSY.test(code) || BUSY.test(msg) ? 'console_busy' : offline ? 'console_unreachable' : 'provision_failed', `${code}${msg ? ': ' + msg : ''}`);
      }
      if (state === 'ReadyToConnect' && !connected) {
        await api.connect(b, p, await auth.getTransferToken(), s.abort.signal);
        connected = true;
        log('session.connect_ok', { id: s.id });
      }
      if (state === 'WaitingForResources') {
        if (!queueStart) queueStart = Date.now();
        if (Date.now() - lastWaitPoll > this.t.waitPollMs) {
          lastWaitPoll = Date.now();
          const extra: Partial<StageEvent> = { detail: 'queue' };
          const qp = st?.queuePosition ?? st?.positionInQueue ?? st?.waitingTimes?.queuePosition;
          if (typeof qp === 'number') extra.queuePosition = qp;
          if (s.kind === 'cloud') {
            try {
              const w = await api.waittime(b, s.targetId, s.abort.signal);
              const eta = w?.estimatedTotalWaitTimeInSeconds ?? w?.estimatedAllocationTimeInSeconds;
              if (typeof eta === 'number') extra.etaSeconds = eta;
              const wq = w?.queuePosition ?? w?.positionInQueue;
              if (typeof wq === 'number') extra.queuePosition = wq;
            } catch (e) { logWarn('session.waittime_failed', e); }
          }
          this.stage(s, 'provision', 'active', extra);
        }
        if (Date.now() - queueStart > this.t.queueMs) throw new SessionFail('provision_failed', 'Queue wait timeout');
      } else if (queueStart) {
        provisionStart += Date.now() - queueStart; // queue time does not count against provisioning
        queueStart = 0;
      }
      const limit = s.kind === 'home' ? this.t.homeProvisionMs : this.t.cloudProvisionMs;
      if (!queueStart && Date.now() - provisionStart > limit) {
        throw new SessionFail(s.kind === 'home' ? 'console_unreachable' : 'provision_failed', `Provisioning timeout (${lastState || 'no state'})`);
      }
      await sleep(this.t.pollMs, s.abort.signal);
    }
  }

  private async keepalive(s: Session) {
    if (s.ended || !s.base || !s.path) return;
    try {
      await this.d.api.keepalive(s.base, s.path);
      s.keepaliveFailures = 0;
    } catch (e) {
      s.keepaliveFailures++;
      logWarn('session.keepalive_failed', { id: s.id, n: s.keepaliveFailures, error: e });
      const gone = e instanceof GssvError && (e.status === 404 || e.status === 410);
      // Hardware finding (TESTLOG S17): after ~9 min the console answers keepalive with
      // 400 SessionInUnexpectedState while video keeps flowing. Never kill a stream the
      // renderer reports as healthy; otherwise confirm via /state before failing.
      if (!gone) {
        if (Date.now() - s.lastHealthyAt < 10_000) { s.keepaliveFailures = 0; return; }
        try {
          const st: any = await this.d.api.state(s.base, s.path);
          if (st && st.state && st.state !== 'Failed') { s.keepaliveFailures = 0; return; }
        } catch { /* fall through to counting */ }
      }
      if (gone || s.keepaliveFailures >= 3) {
        this.fail(s, { code: 'stream_lost', message: gone ? 'Session ended by the server' : 'Keepalive failed' }, gone ? 'console' : 'error');
      }
    }
  }

  async sdp(id: string, offer: string): Promise<string> {
    const s = this.get(id);
    if (typeof offer !== 'string' || !offer) throw new Error('invalid offer');
    await s.ready;
    if (s.ended) throw ipcError(s.error ?? { code: 'unknown', message: 'session ended' });
    this.stage(s, 'negotiate', 'active');
    try {
      const ans = await this.d.api.sdp(s.base!, s.path!, offer, s.abort.signal);
      if (typeof ans?.sdp !== 'string') throw new SessionFail('ice_failed', `SDP answer status ${String((ans as any)?.status ?? 'unknown')}`);
      log('session.sdp_ok', { id: s.id, offerBytes: offer.length, answerBytes: ans.sdp.length });
      return ans.sdp;
    } catch (e) {
      throw this.negotiationFailed(s, e);
    }
  }

  async ice(id: string, local: IceCandidateInit[]): Promise<IceCandidateInit[]> {
    const s = this.get(id);
    await s.ready;
    if (s.ended) throw ipcError(s.error ?? { code: 'unknown', message: 'session ended' });
    try {
      const remote = await this.d.api.ice(s.base!, s.path!, Array.isArray(local) ? local : [], this.d.settings().network.preferIPv6, s.abort.signal);
      log('session.ice_ok', { id: s.id, local: Array.isArray(local) ? local.length : 0, remote: remote.length });
      this.stage(s, 'negotiate', 'done');
      return remote;
    } catch (e) {
      throw this.negotiationFailed(s, e);
    }
  }

  private negotiationFailed(s: Session, e: unknown): Error {
    if (s.ended) return ipcError(s.error ?? { code: 'unknown', message: 'session ended' });
    const err = toSessionError(e, 'ice_failed');
    this.stage(s, 'negotiate', 'failed', { detail: err.code });
    this.fail(s, err);
    return ipcError(err);
  }

  report(id: string, stats: StreamStats) {
    const s = this.sessions.get(id);
    if (s && !s.ended) {
      s.acc.add(stats);
      if ((stats.fps ?? 0) > 0) s.lastHealthyAt = Date.now();
    }
  }

  rendererStage(id: string, ev: StageEvent) {
    const s = this.sessions.get(id);
    if (!s || s.ended || !ev || typeof ev.stage !== 'string') return;
    const at = typeof ev.at === 'number' ? ev.at : Date.now();
    s.clock.mark({ ...ev, at });
    if (ev.stage === 'firstFrame' && ev.status === 'done' && s.firstFrameAt === null) {
      s.firstFrameAt = at;
      log('session.first_frame', { id, connectMs: s.playAt ? at - s.playAt : null });
    }
  }

  async stop(id: string, reason: HistoryEntry['endReason']) {
    const s = this.sessions.get(id);
    if (s) await this.end(s, reason);
  }

  async stopAll(reason: HistoryEntry['endReason'] = 'user') {
    await Promise.all([...this.sessions.values()].map((s) => this.end(s, reason)));
  }

  private fail(s: Session, err: SessionError, reason: HistoryEntry['endReason'] = 'error') {
    if (s.ended) return;
    s.error = err;
    logWarn('session.error', { id: s.id, ...err });
    emit({ type: 'sessionError', sessionId: s.id, error: err });
    void this.end(s, reason);
  }

  private async end(s: Session, reason: HistoryEntry['endReason']) {
    if (s.ended) return;
    s.ended = true;
    s.abort.abort();
    if (s.keepalive) clearInterval(s.keepalive);
    s.keepalive = null;
    if (s.base && s.path) {
      const r = await withTimeout(this.d.api.stop(s.base, s.path).then(() => 'ok', (e) => { logWarn('session.stop_failed', e); return 'err'; }), 5000);
      log('session.stopped', { id: s.id, reason, delete: r ?? 'timeout' });
    }
    let entry: HistoryEntry | null = null;
    if (s.acc.samples > 0 || s.firstFrameAt !== null) {
      entry = buildHistoryEntry({ id: s.id, kind: s.kind, targetId: s.targetId, targetName: s.targetName, startedAt: s.startedAt, endedAt: Date.now(), playAt: s.playAt, firstFrameAt: s.firstFrameAt, endReason: reason }, s.acc, s.clock);
      this.d.history.add(entry);
    }
    this.sessions.delete(s.id);
    this.d.onActiveChange?.(this.activeCount());
    emit({ type: 'sessionEnded', sessionId: s.id, entry });
  }
}
