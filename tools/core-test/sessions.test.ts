// SessionManager against a fake gssv API (no network, no Electron).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type HistoryEntry } from '../../src/shared/api';
import { SessionManager } from '../../src/main/sessions';
import { onEvent } from '../../src/main/events';
import { setConsoleLogging } from '../../src/main/log';
import { GssvError } from '../../src/main/xhome-api';

setConsoleLogging(false);

const FAST = { homeProvisionMs: 300, cloudProvisionMs: 300, queueMs: 2000, keepaliveMs: 50, pollMs: 5, waitPollMs: 0 };

function setup(opts: { states?: any[]; active?: any[]; kind?: 'home' | 'cloud'; noAccount?: boolean; keepaliveFail?: number; waittime?: any } = {}) {
  const calls: string[] = [];
  const states = [...(opts.states ?? [{ state: 'Provisioning' }, { state: 'ReadyToConnect' }, { state: 'Provisioned' }])];
  const history: HistoryEntry[] = [];
  const api: any = {
    base: async (offering: string) => { calls.push('base:' + offering); return { url: 'https://x', offering, region: 'R' }; },
    activeSessions: async () => { calls.push('active'); return opts.active ?? []; },
    play: async (_b: any, kind: string, req: any) => { calls.push(`play:${kind}:${req.osName}:${req.width}x${req.height}`); return `v5/sessions/${kind}/abc`; },
    state: async () => { const s = states.length > 1 ? states.shift() : states[0]; calls.push('state:' + s.state); return s; },
    connect: async (_b: any, _p: string, tok: string) => { calls.push('connect:' + tok); },
    waittime: async () => { calls.push('waittime'); return opts.waittime ?? { estimatedTotalWaitTimeInSeconds: 42 }; },
    keepalive: async () => { calls.push('keepalive'); if (opts.keepaliveFail) throw new GssvError(opts.keepaliveFail, 'POST keepalive', '', null); },
    stop: async () => { calls.push('stop'); },
    sdp: async (_b: any, _p: string, offer: string) => { calls.push('sdp'); return { sdp: 'answer-for-' + offer }; },
    ice: async () => { calls.push('ice'); return [{ candidate: 'a=end-of-candidates', sdpMid: '0', sdpMLineIndex: '0', messageType: 'iceCandidate' }]; },
  };
  const auth: any = {
    hasAccount: () => !opts.noAccount,
    cloudEntitlement: async () => ({ hasCloud: true, offering: 'xgpuweb' }),
    getTransferToken: async () => 'TT',
  };
  const remembered: string[] = [];
  const m = new SessionManager({
    auth, api, history: { add: (e: HistoryEntry) => history.push(e) } as any,
    settings: () => structuredClone(DEFAULT_SETTINGS),
    rememberConsole: (id) => remembered.push(id),
    findConsole: async (id) => (id === 'F400' ? { serverId: 'F400', name: 'Xbox', type: 'XboxSeriesX', power: 'On', remotePlayReady: true } : null),
    findTitle: (id) => (id === 'HALO' ? { name: 'Halo' } : null),
    timing: FAST,
  });
  const events: any[] = [];
  const off = onEvent((e) => events.push(e));
  return { m, calls, events, history, remembered, off };
}

const waitFor = async (pred: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting'); await new Promise((r) => setTimeout(r, 5)); }
};

test('home happy path: stages, connect, sdp/ice, stats → history', async () => {
  const { m, calls, events, history, remembered, off } = setup();
  const { sessionId } = m.start('home', 'F400');
  const answer = await m.sdp(sessionId, 'OFFER');
  assert.equal(answer, 'answer-for-OFFER');
  const remote = await m.ice(sessionId, [{ candidate: 'a=candidate:1 1 UDP 1 1.1.1.1 1 typ host', sdpMid: '0', sdpMLineIndex: 0 }]);
  assert.equal(remote.length, 1);
  assert.deepEqual(calls.filter((c) => c.startsWith('connect')), ['connect:TT']);
  assert.ok(calls.includes('play:home:windows:2560x1440'));
  assert.deepEqual(remembered, ['F400']);
  const now = Date.now();
  m.rendererStage(sessionId, { stage: 'connect', status: 'active', at: now });
  m.rendererStage(sessionId, { stage: 'connect', status: 'done', at: now + 30 });
  m.rendererStage(sessionId, { stage: 'firstFrame', status: 'done', at: now + 50 });
  for (let i = 0; i < 5; i++) m.report(sessionId, { at: now + i * 1000, frameWidth: 1920, frameHeight: 1080, fps: 60, kbps: 17000 + i, rttMs: 1, jitterMs: 1, jitterBufferMs: 2, decodeMsPerFrame: 0.3, packetsLost: i, framesDropped: 0, codec: 'H.264', decoder: null, hardwareDecode: null });
  await m.stop(sessionId, 'user');
  off();
  const stages = events.filter((e) => e.type === 'stage').map((e) => `${e.ev.stage}:${e.ev.status}`);
  assert.deepEqual(stages, ['auth:active', 'auth:done', 'provision:active', 'provision:done', 'negotiate:active', 'negotiate:done']);
  assert.ok(calls.includes('stop'));
  assert.equal(history.length, 1);
  const h = history[0];
  assert.equal(h.targetName, 'Xbox');
  assert.equal(h.maxWidth, 1920);
  assert.equal(h.avgKbps, 17002);
  assert.equal(h.packetsLost, 4);
  assert.equal(h.endReason, 'user');
  assert.ok(typeof h.stages.provision === 'number' && typeof h.stages.connect === 'number');
  assert.ok(h.connectMs !== null && h.connectMs >= 0);
  const ended = events.find((e) => e.type === 'sessionEnded');
  assert.equal(ended.sessionId, sessionId);
  assert.equal(ended.entry.id, sessionId);
  assert.equal(m.activeCount(), 0);
});

test('console busy when the account already has an active home session', async () => {
  const { m, calls, events, off } = setup({ active: [{ state: 'Provisioned' }] });
  const { sessionId } = m.start('home', 'F400');
  await assert.rejects(m.sdp(sessionId, 'O'), /\[console_busy\]/);
  await waitFor(() => events.some((e) => e.type === 'sessionEnded'));
  off();
  assert.ok(!calls.some((c) => c.startsWith('play')));
  assert.equal(events.find((e) => e.type === 'sessionError').error.code, 'console_busy');
  assert.equal(events.find((e) => e.type === 'sessionEnded').entry, null);
  assert.ok(events.some((e) => e.type === 'stage' && e.ev.stage === 'auth' && e.ev.status === 'failed'));
});

test('unknown console → no_console; not signed in → not_signed_in', async () => {
  let s = setup();
  let id = s.m.start('home', 'NOPE').sessionId;
  await assert.rejects(s.m.sdp(id, 'O'), /\[no_console\]/);
  s.off();
  s = setup({ noAccount: true });
  id = s.m.start('home', 'F400').sessionId;
  await assert.rejects(s.m.sdp(id, 'O'), /\[not_signed_in\]/);
  s.off();
});

test('Failed state → provision_failed with server code; DELETE still sent', async () => {
  const { m, calls, events, off } = setup({ states: [{ state: 'Provisioning' }, { state: 'Failed', errorDetails: { code: 'WNSError', message: 'boom' } }] });
  const { sessionId } = m.start('home', 'F400');
  await assert.rejects(m.sdp(sessionId, 'O'), /\[provision_failed\] WNSError: boom/);
  await waitFor(() => events.some((e) => e.type === 'sessionEnded'));
  off();
  assert.ok(calls.includes('stop'));
  assert.ok(events.some((e) => e.type === 'stage' && e.ev.stage === 'provision' && e.ev.status === 'failed' && e.ev.detail === 'provision_failed'));
});

test('home provisioning timeout → console_unreachable', async () => {
  const { m, events, off } = setup({ states: [{ state: 'Provisioning' }] });
  const { sessionId } = m.start('home', 'F400');
  await assert.rejects(m.sdp(sessionId, 'O'), /\[console_unreachable\]/);
  off();
  assert.equal(events.find((e) => e.type === 'sessionError').error.code, 'console_unreachable');
});

test('cloud queue reports ETA, queue time does not count as provisioning', async () => {
  const states = [{ state: 'WaitingForResources' }, ...Array(80).fill({ state: 'WaitingForResources', queuePosition: 3 }), { state: 'Provisioning' }, { state: 'Provisioned' }];
  const { m, calls, events, off } = setup({ states });
  // 81 polls * 5 ms > cloudProvisionMs would fail if queue time counted; it must not
  const { sessionId } = m.start('cloud', 'HALO');
  await m.sdp(sessionId, 'O');
  await m.stop(sessionId, 'user');
  off();
  const queued = events.filter((e) => e.type === 'stage' && e.ev.stage === 'provision' && e.ev.status === 'active' && e.ev.etaSeconds === 42);
  assert.ok(queued.length >= 1);
  assert.ok(queued.some((e) => e.ev.queuePosition === 3));
  assert.ok(calls.includes('base:xgpuweb'));
  assert.ok(calls.includes('play:cloud:windows:2560x1440'));
});

test('keepalive 404 → stream_lost, endReason console; starting a new session replaces the old one', async () => {
  const s = setup({ keepaliveFail: 404 });
  const { sessionId } = s.m.start('home', 'F400');
  await s.m.sdp(sessionId, 'O');
  s.m.report(sessionId, { at: Date.now(), frameWidth: 1920, frameHeight: 1080, fps: 60, kbps: 1, rttMs: 1, jitterMs: 1, jitterBufferMs: 1, decodeMsPerFrame: 1, packetsLost: 0, framesDropped: 0, codec: null, decoder: null, hardwareDecode: null });
  await waitFor(() => s.events.some((e) => e.type === 'sessionEnded'));
  assert.equal(s.events.find((e) => e.type === 'sessionError').error.code, 'stream_lost');
  assert.equal(s.history[0].endReason, 'console');
  s.off();

  const r = setup();
  const a = r.m.start('home', 'F400').sessionId;
  await r.m.sdp(a, 'O');
  const b = r.m.start('home', 'F400').sessionId;
  await r.m.sdp(b, 'O');
  const endedA = r.events.find((e) => e.type === 'sessionEnded' && e.sessionId === a);
  assert.ok(endedA, 'first session ended');
  assert.equal(r.m.activeCount(), 1);
  await r.m.stopAll('user');
  assert.equal(r.m.activeCount(), 0);
  r.off();
});

test('invalid target ids are rejected synchronously', () => {
  const { m, off } = setup();
  assert.throws(() => m.start('home', '../x'), /\[no_console\]/);
  assert.throws(() => m.start('nope' as any, 'F400'));
  off();
});
