// Session orchestration: the UI side of a stream. The engine (StreamController) does WebRTC and calls
// main for REST; we only reflect its state/stages/stats and route the screens.
import type { SessionError, SessionKind, StageEvent, StageId, XenithEvent } from '../../shared/api';
import { getStreamController } from '../stream-adapter';
import { parseIpcError } from '../lib/api';
import { addHistoryEntry, go, loadHistory, toast, updateSettings } from './actions';
import { emptyStages, getState, setSession, setState, STAGES, type SessionState } from './store';
import { createResumeController, waitForResume, type ResumeTarget } from './resume';

let container: HTMLElement | null = null;
let unsubs: Array<() => void> = [];
let lossWindow: Array<{ at: number; lost: number }> = [];
let connectionGeneration = 0;
let stopping = Promise.resolve();

const resume = createResumeController({
  stop: releaseForSleep,
  connect: async (target, signal) => {
    if (signal.aborted) return false;
    await connectSession(target.kind, target.targetId, target.targetName, signal);
    return !signal.aborted && getState().session?.phase === 'streaming';
  },
  online: () => navigator.onLine,
  allowed: () => getState().account?.signedIn === true,
  waiting: target => { teardown(); prepareConnection(target, 'reconnecting'); },
  now: () => Date.now(),
  wait: waitForResume,
  exhausted: target => {
    if (getState().session?.phase === 'error') return;
    if (!getState().session) prepareConnection(target, 'reconnecting');
    fail({ code: 'network', message: 'Reconnect after sleep timed out' });
  },
});

export function cancelResume(): void {
  const pending = resume.state !== 'idle';
  resume.cancel();
  const s = getState().session;
  if (pending && s?.phase === 'connecting' && s.engineState === 'reconnecting') endSession();
}

export function handlePowerState(state: 'suspend' | 'resume'): void {
  if (state === 'resume') { void resume.resume(); return; }
  const s = getState().session;
  const target: ResumeTarget | null = s && s.phase !== 'error' && s.phase !== 'idle'
    ? { kind: s.kind, targetId: s.targetId, targetName: s.targetName } : null;
  resume.suspend(target);
}

function releaseForSleep(): Promise<void> {
  connectionGeneration++;
  teardown();
  let stopped: Promise<void>;
  try { stopped = getStreamController().stop('user'); }
  catch { stopped = Promise.resolve(); }
  finally { endSession(); }
  stopping = Promise.all([stopping, stopped.catch(() => undefined)]).then(() => undefined);
  return stopping;
}

export function registerStreamContainer(el: HTMLElement | null): void { container = el; }

export function isStreamingVisible(): boolean {
  const p = getState().session?.phase;
  return p === 'streaming' || p === 'reconnecting';
}

function applyStage(ev: StageEvent): void {
  setSession(s => {
    const stages = { ...s.stages };
    const idx = STAGES.indexOf(ev.stage);
    const cur = stages[ev.stage] ?? { status: 'pending', startedAt: null, endedAt: null };
    if (ev.status === 'active') {
      // everything before an active stage is finished
      for (let i = 0; i < idx; i++) {
        const k = STAGES[i];
        if (stages[k].status !== 'done' && stages[k].status !== 'failed') stages[k] = { ...stages[k], status: 'done', endedAt: stages[k].endedAt ?? ev.at };
      }
      stages[ev.stage] = { ...cur, status: 'active', startedAt: cur.startedAt ?? ev.at, detail: ev.detail, queuePosition: ev.queuePosition, etaSeconds: ev.etaSeconds };
    } else {
      const prevEnd = idx > 0 ? stages[STAGES[idx - 1]].endedAt : null;
      stages[ev.stage] = { ...cur, status: ev.status, startedAt: cur.startedAt ?? prevEnd ?? s.startedAt, endedAt: ev.at, detail: ev.detail };
    }
    const patch: Partial<SessionState> = { stages };
    if (ev.stage === 'firstFrame' && ev.status === 'done') patch.firstFrameAt = ev.at;
    if (ev.status === 'failed') patch.failedStage = ev.stage;
    return patch;
  });
}

function fail(error: SessionError): void {
  const s = getState().session;
  if (!s) return;
  setState({
    lastSessionError: { error, kind: s.kind, targetId: s.targetId, targetName: s.targetName, stage: s.failedStage ?? currentStage(s) },
  });
  setSession({ phase: 'error', error });
}

function currentStage(s: SessionState): StageId | null {
  return STAGES.find(k => s.stages[k].status === 'active') ?? null;
}

export async function connect(kind: SessionKind, targetId: string, targetName: string): Promise<void> {
  cancelResume();
  await connectSession(kind, targetId, targetName);
}

function prepareConnection(target: ResumeTarget, engineState: 'idle' | 'reconnecting' = 'idle'): void {
  const st = getState();
  const now = Date.now();
  setState({
    lastSessionError: null,
    sheet: null,
    session: {
      phase: 'connecting', engineState, ...target, startedAt: now, firstFrameAt: null,
      stages: emptyStages(), error: null, failedStage: null, stats: null, lossTrend: 0, overlayOpen: false, lastRumble: null, audioLevel: 0,
    },
    route: { ...st.route, screen: 'connecting', returnTo: target.kind === 'cloud' ? 'cloud' : 'home' },
  });
}

async function connectSession(kind: SessionKind, targetId: string, targetName: string, signal?: AbortSignal): Promise<void> {
  await stopping;
  if (signal?.aborted) return;
  const st = getState();
  const waiting = signal && st.session?.phase === 'connecting' && st.session.engineState === 'reconnecting';
  if (st.session && st.session.phase !== 'error' && !waiting) return;
  teardown();
  const generation = ++connectionGeneration;
  prepareConnection({ kind, targetId, targetName });
  if (kind === 'home') updateSettings({ streaming: { lastServerId: targetId } });
  lossWindow = [];

  let ctrl;
  try { ctrl = getStreamController(); } catch (e) { fail({ code: 'unknown', message: String(e) }); return; }
  unsubs = [
    ctrl.on('state', s => {
      if (generation !== connectionGeneration) return;
      setSession({ engineState: s });
      if (s === 'streaming') setSession(x => ({ phase: 'streaming', firstFrameAt: x.firstFrameAt ?? Date.now() }));
      else if (s === 'reconnecting') setSession({ phase: 'reconnecting' });
      else if (s === 'ended') endSession();
      else if (s === 'error') { const cur = getState().session; if (cur && !cur.error) fail({ code: 'unknown', message: 'engine error' }); }
    }),
    ctrl.on('stage', applyStage),
    ctrl.on('stats', stats => {
      lossWindow.push({ at: stats.at, lost: stats.packetsLost });
      lossWindow = lossWindow.filter(w => stats.at - w.at <= 10000);
      const trend = lossWindow.length > 1 ? lossWindow[lossWindow.length - 1].lost - lossWindow[0].lost : 0;
      setSession({ stats, lossTrend: trend });
    }),
    ctrl.on('error', fail),
    ctrl.on('rumble', r => setSession({ lastRumble: r })), // the engine itself reports rumble to main
    ctrl.on('controllers', list => setState({ controllers: list })),
    ctrl.on('overlayRequest', () => toggleOverlay()),
    ctrl.on('audioLevel', rms => setSession({ audioLevel: rms })),
  ];
  if (!container) { fail({ code: 'unknown', message: 'stream container not mounted' }); return; }
  const abort = () => { if (generation === connectionGeneration) void releaseForSleep(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) { abort(); return; }
    // Steam Deck: the Xenith controller template makes the right trackpad a mouse; forward it in cloud games that support one.
    const title = kind === 'cloud' ? getState().cloud?.find(t => t.titleId === targetId) : undefined;
    const autoMouseKeyboard = !!(getState().deck && title?.supportsMouseKeyboard);
    await ctrl.start({ kind, targetId, targetName, container, settings: getState().settings, autoMouseKeyboard });
  } catch (e) {
    if (generation !== connectionGeneration) return;
    const cur = getState().session;
    if (cur && cur.phase !== 'error') fail(parseIpcError(e));
  } finally { signal?.removeEventListener('abort', abort); }
}

/** User cancels while connecting, or disconnects from the side panel. */
export async function disconnect(): Promise<void> {
  cancelResume();
  const s = getState().session;
  if (!s) { await stopping; return; }
  try { await getStreamController().stop('user'); } catch { /* engine already gone */ }
  endSession();
}

function endSession(): void {
  const s = getState().session;
  if (!s) return;
  connectionGeneration++;
  teardown();
  const back = s.kind === 'cloud' ? 'cloud' : 'home';
  setState(st => ({ session: null, route: { ...st.route, screen: back } }));
  document.documentElement.dataset.streaming = 'false';
  void loadHistory();
}

/** Dismiss an error card and return to where the session started. */
export function dismissError(): void {
  cancelResume();
  const s = getState().session;
  teardown();
  setState(st => ({ session: null, route: { ...st.route, screen: s?.kind === 'cloud' ? 'cloud' : 'home' } }));
}

export function retry(): void {
  const e = getState().lastSessionError;
  const s = getState().session;
  const kind = s?.kind ?? e?.kind, id = s?.targetId ?? e?.targetId, name = s?.targetName ?? e?.targetName;
  if (!kind || !id) return;
  setState({ session: null });
  void connect(kind, id, name ?? id);
}

let lastToggle = 0;
export function toggleOverlay(force?: boolean): void {
  const s = getState().session;
  if (!s || !isStreamingVisible()) return;
  const now = performance.now();
  if (force === undefined && now - lastToggle < 180) return; // global shortcut + keydown can both arrive
  lastToggle = now;
  const open = force ?? !s.overlayOpen;
  setSession({ overlayOpen: open });
  try { getStreamController().setOverlayOpen?.(open); } catch { /* ignore */ }
}

function teardown(): void {
  unsubs.forEach(u => { try { u(); } catch { /* ignore */ } });
  unsubs = [];
}

export function handleMainEvent(ev: XenithEvent): void {
  const s = getState().session;
  switch (ev.type) {
    case 'power': handlePowerState(ev.state); break;
    case 'stage': if (s && s.phase === 'connecting') applyStage(ev.ev); break;
    case 'sessionError': if (s) fail(ev.error); break;
    case 'sessionEnded':
      if (ev.entry) addHistoryEntry(ev.entry);
      if (s && s.phase !== 'error') endSession();
      break;
    case 'menu':
      // Main already toggles fullscreen on F10/F11 — informational only.
      if (ev.action === 'toggle-overlay') toggleOverlay();
      else if (ev.action === 'press-guide') pressGuide();
      break;
  }
}

export function applyLiveSettings(): void {
  if (!getState().session) return;
  try { getStreamController().apply(getState().settings); } catch { /* engine not ready */ }
}

export function pressGuide(): void {
  // Close the Xenith menu first so the pad can drive the console guide right away.
  toggleOverlay(false);
  setTimeout(() => { try { getStreamController().pressGuide(); } catch { toast('Xbox', 'bad'); } }, 60);
}
