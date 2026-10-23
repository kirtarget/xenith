import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerPowerEvents } from '../../src/main/power-events';
import { createResumeController, waitForResume, type ResumeTarget } from '../../src/renderer/state/resume';

const target: ResumeTarget = { kind: 'home', targetId: 'console-1', targetName: 'My Xbox' };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};

function harness() {
  let clock = 0;
  let online = true;
  let allowed = true;
  let stopped = 0;
  let attempts = 0;
  const seen: ResumeTarget[] = [];
  const exhausted: ResumeTarget[] = [];
  const waiting: ResumeTarget[] = [];
  const waits: Array<{ ms: number; signal: AbortSignal; done(): void }> = [];
  let cleanup = Promise.resolve();
  let connect = async (_signal: AbortSignal) => true;
  const controller = createResumeController({
    stop: () => { stopped++; return cleanup; },
    connect: (saved, signal) => { attempts++; seen.push(saved); return connect(signal); },
    online: () => online,
    allowed: () => allowed,
    waiting: saved => { waiting.push(saved); },
    exhausted: saved => { exhausted.push(saved); },
    now: () => clock,
    wait: (ms, signal) => new Promise<void>(resolve => {
      const finish = () => { signal.removeEventListener('abort', finish); resolve(); };
      waits.push({ ms, signal, done: finish });
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    }),
  });
  const advance = async () => {
    const next = waits.shift();
    assert.ok(next, 'a scheduled wait must exist');
    clock += next.ms;
    next.done();
    await flush();
  };
  return {
    controller, advance, seen, exhausted, waiting, waits,
    get stopped() { return stopped; }, get attempts() { return attempts; },
    setOnline(value: boolean) { online = value; }, setAllowed(value: boolean) { allowed = value; },
    setCleanup(value: Promise<void>) { cleanup = value; },
    setConnect(value: (signal: AbortSignal) => Promise<boolean>) { connect = value; },
    setClock(value: number) { clock = value; },
  };
}

test('resume without an active suspended session never starts a stream', async () => {
  const h = harness();
  await h.controller.resume();
  h.controller.suspend(null);
  await h.controller.resume();
  assert.equal(h.attempts, 0);
  assert.equal(h.stopped, 0);
  assert.equal(h.controller.state, 'idle');
});

test('duplicate sleep and wake events stop and reconnect once to the saved target', async () => {
  const h = harness();
  h.controller.suspend(target);
  h.controller.suspend(target);
  const first = h.controller.resume();
  assert.equal(h.controller.resume(), first);
  await flush();
  await h.advance();
  await first;
  assert.equal(h.stopped, 1);
  assert.equal(h.attempts, 1);
  assert.deepEqual(h.seen, [target]);
  assert.equal(h.controller.state, 'idle');
});

test('cloud target identity survives sleep without substituting another game', async () => {
  const h = harness();
  const cloud: ResumeTarget = { kind: 'cloud', targetId: 'title-7', targetName: 'Demo game' };
  h.controller.suspend(cloud);
  cloud.targetId = 'changed-after-snapshot';
  const work = h.controller.resume();
  await flush(); await h.advance(); await work;
  assert.equal(h.seen[0].targetId, 'title-7');
  assert.equal(h.seen[0].kind, 'cloud');
});

test('restoration waits for the previous engine cleanup', async () => {
  const h = harness();
  const cleanup = deferred<void>();
  h.setCleanup(cleanup.promise);
  h.controller.suspend(target);
  const work = h.controller.resume();
  await flush();
  assert.equal(h.waits.length, 0);
  assert.equal(h.attempts, 0);
  cleanup.resolve();
  await flush(); await h.advance(); await work;
  assert.equal(h.attempts, 1);
});

test('wake waits for the network before connecting', async () => {
  const h = harness();
  h.setOnline(false);
  h.controller.suspend(target);
  const work = h.controller.resume();
  await flush(); await h.advance(); await h.advance();
  assert.equal(h.attempts, 0);
  assert.deepEqual(h.waiting, [target]);
  h.setOnline(true);
  await h.advance(); await work;
  assert.equal(h.attempts, 1);
});

test('manual cancellation while offline prevents later automatic connection', async () => {
  const h = harness();
  h.setOnline(false);
  h.controller.suspend(target);
  const work = h.controller.resume();
  await flush(); await h.advance();
  h.controller.cancel();
  h.setOnline(true);
  await work;
  assert.equal(h.attempts, 0);
  assert.equal(h.controller.state, 'idle');
});

test('sign-out permission check cancels pending recovery', async () => {
  const h = harness();
  h.controller.suspend(target);
  const work = h.controller.resume();
  await flush();
  h.setAllowed(false);
  await h.advance(); await work;
  assert.equal(h.attempts, 0);
  assert.deepEqual(h.exhausted, []);
});

test('failed reconnect attempts are bounded and use backoff', async () => {
  const h = harness();
  h.setConnect(async () => false);
  h.controller.suspend(target);
  const work = h.controller.resume();
  await flush();
  await h.advance();
  assert.equal(h.waits[0].ms, 1500);
  await h.advance();
  assert.equal(h.waits[0].ms, 4000);
  await h.advance(); await work;
  assert.equal(h.attempts, 3);
  assert.deepEqual(h.waiting, [target, target, target]);
  assert.deepEqual(h.exhausted, [target]);
});

test('network recovery has a deadline and reports exhaustion', async () => {
  const h = harness();
  h.setOnline(false);
  h.controller.suspend(target);
  const work = h.controller.resume();
  await flush();
  h.setClock(120_000);
  await h.advance(); await work;
  assert.equal(h.attempts, 0);
  assert.deepEqual(h.exhausted, [target]);
});

test('a second sleep aborts the old attempt and preserves its target', async () => {
  const h = harness();
  const attempt = deferred<boolean>();
  let signal: AbortSignal | undefined;
  h.setConnect(async s => { signal = s; return attempt.promise; });
  h.controller.suspend(target);
  const old = h.controller.resume();
  await flush(); await h.advance();
  h.controller.suspend(null);
  assert.equal(signal?.aborted, true);
  assert.equal(h.stopped, 2);
  attempt.resolve(true);
  await old;
  assert.equal(h.controller.state, 'sleeping');
  h.setConnect(async () => true);
  const current = h.controller.resume();
  await flush(); await h.advance(); await current;
  assert.deepEqual(h.seen, [target, target]);
});

test('cancellation during an in-flight attempt prevents retries and exhaustion', async () => {
  const h = harness();
  const attempt = deferred<boolean>();
  h.setConnect(() => attempt.promise);
  h.controller.suspend(target);
  const work = h.controller.resume();
  await flush(); await h.advance();
  h.controller.cancel();
  attempt.resolve(false);
  await work;
  assert.equal(h.attempts, 1);
  assert.deepEqual(h.exhausted, []);
});

test('real wait resolves promptly when aborted', async () => {
  const abort = new AbortController();
  const work = waitForResume(60_000, abort.signal);
  abort.abort();
  await work;
});

test('main emits suspend before cleanup and holds wake until old sessions end', async () => {
  const monitor = new EventEmitter();
  const cleanup = deferred<void>();
  const seen: string[] = [];
  const dispose = registerPowerEvents(state => seen.push(state), () => { seen.push('cleanup'); return cleanup.promise; }, monitor);
  monitor.emit('suspend');
  monitor.emit('resume');
  monitor.emit('resume');
  await flush();
  assert.deepEqual(seen, ['suspend', 'cleanup']);
  cleanup.resolve();
  await flush();
  assert.deepEqual(seen, ['suspend', 'cleanup', 'resume']);
  dispose();
});

test('a second suspend invalidates a pending wake event', async () => {
  const monitor = new EventEmitter();
  const cleanup = deferred<void>();
  const seen: string[] = [];
  const dispose = registerPowerEvents(state => seen.push(state), () => cleanup.promise, monitor);
  monitor.emit('suspend');
  monitor.emit('resume');
  monitor.emit('suspend');
  cleanup.resolve();
  await flush();
  assert.deepEqual(seen, ['suspend', 'suspend']);
  monitor.emit('resume');
  await flush();
  assert.deepEqual(seen, ['suspend', 'suspend', 'resume']);
  dispose();
});

test('disposing main listeners prevents late wake delivery', async () => {
  const monitor = new EventEmitter();
  const cleanup = deferred<void>();
  const seen: string[] = [];
  const dispose = registerPowerEvents(state => seen.push(state), () => cleanup.promise, monitor);
  monitor.emit('suspend');
  monitor.emit('resume');
  dispose();
  cleanup.resolve();
  await flush();
  monitor.emit('suspend');
  monitor.emit('resume');
  assert.deepEqual(seen, ['suspend']);
});
