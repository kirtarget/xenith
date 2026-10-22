import test from 'node:test';
import assert from 'node:assert/strict';
import type { StreamStats } from '../../src/shared/api';
import { buildHistoryEntry, downsample, pushHistory, StageClock, StatsAccumulator } from '../../src/main/history-core';

const stat = (at: number, o: Partial<StreamStats> = {}): StreamStats => ({
  at, frameWidth: 1920, frameHeight: 1080, fps: 60, kbps: 17000, rttMs: 1, jitterMs: 2, jitterBufferMs: 3, decodeMsPerFrame: 0.3,
  packetsLost: 0, framesDropped: 0, codec: 'H.264 Main 4.2', decoder: null, hardwareDecode: null, ...o,
});

test('downsample: short series unchanged (rounded), long series bucket-averaged to ≤ 60', () => {
  assert.deepEqual(downsample([1.4, 2.6, 3]), [1, 3, 3]);
  const long = Array.from({ length: 600 }, (_, i) => i);
  const d = downsample(long, 60);
  assert.equal(d.length, 60);
  assert.equal(d[0], Math.round((0 + 9) / 2));          // mean of 0..9
  assert.equal(d[59], Math.round((590 + 599) / 2));     // mean of 590..599
  assert.equal(downsample(Array.from({ length: 61 }, () => 5), 60).length, 60);
  assert.deepEqual(downsample([NaN, 4, Infinity, 6]), [4, 6]);
  assert.deepEqual(downsample([]), []);
});

test('downsample with uneven buckets covers every sample', () => {
  const v = Array.from({ length: 125 }, () => 10);
  const d = downsample(v, 60);
  assert.equal(d.length, 60);
  assert.ok(d.every((x) => x === 10));
});

test('accumulator: max frame size, averages, cumulative packets lost', () => {
  const a = new StatsAccumulator();
  a.add(stat(1000, { frameWidth: 1280, frameHeight: 720, kbps: 8000, fps: 30, packetsLost: 2 }));
  a.add(stat(2000, { frameWidth: 1920, frameHeight: 1080, kbps: 18000, fps: 60, packetsLost: 5 }));
  a.add(stat(3000, { frameWidth: null, frameHeight: null, kbps: null, fps: null, packetsLost: 5 }));
  a.add(null);
  assert.equal(a.samples, 3);
  assert.equal(a.maxWidth, 1920);
  assert.equal(a.maxHeight, 1080);
  assert.equal(a.avgKbps, 13000);
  assert.equal(a.avgFps, 45);
  assert.equal(a.packetsLost, 5);
  assert.equal(a.firstAt, 1000);
  assert.equal(a.lastAt, 3000);
});

test('stage clock: first active → first done', () => {
  const c = new StageClock();
  c.mark({ stage: 'auth', status: 'active', at: 100 });
  c.mark({ stage: 'auth', status: 'done', at: 350 });
  c.mark({ stage: 'provision', status: 'active', at: 400 });
  c.mark({ stage: 'provision', status: 'active', at: 5000, etaSeconds: 30 }); // queue update keeps first start
  c.mark({ stage: 'provision', status: 'done', at: 12400 });
  c.mark({ stage: 'provision', status: 'done', at: 99999 });                  // duplicate ignored
  c.mark({ stage: 'firstFrame', status: 'done', at: 20000 });                 // done without active → 0
  assert.deepEqual(c.durations(), { auth: 250, provision: 12000, firstFrame: 0 });
  assert.equal(c.doneAt('provision'), 12400);
  assert.equal(c.doneAt('negotiate'), null);
});

test('buildHistoryEntry aggregates a 10-minute session', () => {
  const acc = new StatsAccumulator();
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 600; i++) acc.add(stat(t0 + 20_000 + i * 1000, { kbps: i < 300 ? 10000 : 20000, packetsLost: Math.floor(i / 100) }));
  const clock = new StageClock();
  clock.mark({ stage: 'auth', status: 'active', at: t0 });
  clock.mark({ stage: 'auth', status: 'done', at: t0 + 500 });
  const e = buildHistoryEntry({
    id: 's1', kind: 'home', targetId: 'F400', targetName: 'Xbox', startedAt: t0, endedAt: t0 + 20_000 + 600_000,
    playAt: t0 + 600, firstFrameAt: t0 + 19_700, endReason: 'user',
  }, acc, clock);
  assert.equal(e.durationSec, 600);
  assert.equal(e.connectMs, 19_100);
  assert.equal(e.maxWidth, 1920);
  assert.equal(e.fps, 60);
  assert.equal(e.avgKbps, 15000);
  assert.equal(e.packetsLost, 5);
  assert.equal(e.bitrateTrace.length, 60);
  assert.equal(e.bitrateTrace[0], 10000);
  assert.equal(e.bitrateTrace[59], 20000);
  assert.deepEqual(e.stages, { auth: 500 });
  assert.equal(e.endReason, 'user');
});

test('buildHistoryEntry without first frame / stats', () => {
  const e = buildHistoryEntry({ id: 's2', kind: 'cloud', targetId: 'T', targetName: 'T', startedAt: 0, endedAt: 4000, playAt: null, firstFrameAt: null, endReason: 'error' }, new StatsAccumulator(), new StageClock());
  assert.equal(e.connectMs, null);
  assert.equal(e.durationSec, 4);
  assert.equal(e.avgKbps, null);
  assert.equal(e.fps, null);
  assert.deepEqual(e.bitrateTrace, []);
});

test('pushHistory keeps newest first, last 50, no duplicate ids', () => {
  let list: any[] = [];
  for (let i = 0; i < 60; i++) list = pushHistory(list, { id: String(i) } as any, 50);
  assert.equal(list.length, 50);
  assert.equal(list[0].id, '59');
  assert.equal(list[49].id, '10');
  list = pushHistory(list, { id: '55', v: 2 } as any, 50);
  assert.equal(list.filter((e) => e.id === '55').length, 1);
  assert.equal(list[0].v, 2);
});
