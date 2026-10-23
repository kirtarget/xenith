import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshMatcher, parseRefresh } from '../../../src/main/platform/impl/refresh';

function fakeX(initial: number | null, focusedOn = ':0') {
  let value = initial; const calls: string[][] = [];
  const run = async (_cmd: string, args: string[]) => {
    calls.push(args);
    const d = args[1], rest = args.slice(3);
    if (rest[0] === 'GAMESCOPE_FOCUSED_APP') return { ok: true, stdout: d === focusedOn ? 'GAMESCOPE_FOCUSED_APP(CARDINAL) = 769' : 'GAMESCOPE_FOCUSED_APP:  not found.', stderr: '' };
    if (rest[0] === '-f') { value = Number(rest[5]); return { ok: true, stdout: '', stderr: '' }; }
    if (rest[0] === '-remove') { value = null; return { ok: true, stdout: '', stderr: '' }; }
    return { ok: true, stdout: value === null ? 'GAMESCOPE_DYNAMIC_REFRESH:  not found.' : 'GAMESCOPE_DYNAMIC_REFRESH(CARDINAL) = ' + value, stderr: '' };
  };
  return { run, calls, get value() { return value; } };
}

test('parseRefresh reads xprop output', () => {
  assert.equal(parseRefresh('GAMESCOPE_DYNAMIC_REFRESH(CARDINAL) = 90'), 90);
  assert.equal(parseRefresh('GAMESCOPE_DYNAMIC_REFRESH:  not found.'), null);
});

test('60 Hz while streaming, previous rate restored after', async () => {
  const x = fakeX(90);
  const m = createRefreshMatcher({ run: x.run, enabled: () => true, displays: [':0', ':1'] });
  await m.update(1); assert.equal(x.value, 60);
  await m.update(1); assert.equal(x.value, 60);
  await m.update(0); assert.equal(x.value, 90);
});

test('unset property is removed again; Steam display found on :1', async () => {
  const x = fakeX(null, ':1');
  const m = createRefreshMatcher({ run: x.run, enabled: () => true, displays: [':0', ':1'] });
  await m.update(1); assert.equal(x.value, 60);
  await m.restore(); assert.equal(x.value, null);
});

test('disabled setting or already 60 Hz changes nothing', async () => {
  const off = fakeX(90);
  await createRefreshMatcher({ run: off.run, enabled: () => false }).update(1);
  assert.equal(off.value, 90);
  const same = fakeX(60);
  const m = createRefreshMatcher({ run: same.run, enabled: () => true, displays: [':0'] });
  await m.update(1); await m.update(0);
  assert.equal(same.value, 60);
  assert.ok(!same.calls.some(a => a.includes('-remove')));
});
