import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteamKeyboard, STEAM_KEYBOARD_URI } from '../../src/main/steam-keyboard-core';
import type { PlatformInfo } from '../../src/shared/api';

const deck: Pick<PlatformInfo, 'os' | 'isSteamDeck' | 'isGamescope'> = { os: 'linux', isSteamDeck: true, isGamescope: true };

test('Steam keyboard only opens on a real Deck in Gaming Mode', async () => {
  for (const p of [
    { ...deck, os: 'win32' as const },
    { ...deck, os: 'darwin' as const },
    { ...deck, isSteamDeck: false },
    { ...deck, isGamescope: false },
  ]) {
    let checks = 0;
    const show = createSteamKeyboard({
      platform: () => p,
      steamRunning: async () => { checks++; return true; },
      openKeyboard: async () => { assert.fail('unsupported platform launched Steam'); },
    });
    assert.equal(await show(), false);
    assert.equal(checks, 0);
  }
});

test('Steam keyboard does not launch Steam when its client is stopped', async () => {
  const show = createSteamKeyboard({
    platform: () => deck,
    steamRunning: async () => false,
    openKeyboard: async () => { assert.fail('stopped Steam was launched'); },
  });
  assert.equal(await show(), false);
});

test('Steam keyboard sends only the fixed keyboard URI', async () => {
  const opened: string[] = [];
  const show = createSteamKeyboard({
    platform: () => deck,
    steamRunning: async () => true,
    openKeyboard: async uri => { opened.push(uri); },
  });
  assert.equal(await show(), true);
  assert.deepEqual(opened, [STEAM_KEYBOARD_URI]);
});

test('simultaneous focus and click requests share one keyboard launch', async () => {
  let finish!: () => void;
  let opened = 0;
  const show = createSteamKeyboard({
    platform: () => deck,
    steamRunning: async () => true,
    openKeyboard: async () => { opened++; await new Promise<void>(resolve => { finish = resolve; }); },
  });
  const focus = show();
  const click = show();
  assert.equal(focus, click);
  await Promise.resolve();
  assert.equal(opened, 1);
  finish();
  assert.equal(await focus, true);
  assert.equal(await click, true);
});

test('failed keyboard requests return false and can be retried', async () => {
  let attempts = 0;
  const show = createSteamKeyboard({
    platform: () => deck,
    steamRunning: async () => true,
    openKeyboard: async () => { if (++attempts === 1) throw new Error('handler unavailable'); },
  });
  assert.equal(await show(), false);
  assert.equal(await show(), true);
  assert.equal(attempts, 2);
});

test('platform and process-query failures do not escape into the search UI', async () => {
  const platformFailure = createSteamKeyboard({
    platform: () => { throw new Error('platform unavailable'); },
    steamRunning: async () => true,
    openKeyboard: async () => { assert.fail('unexpected launch'); },
  });
  assert.equal(await platformFailure(), false);
  const processFailure = createSteamKeyboard({
    platform: () => deck,
    steamRunning: async () => { throw new Error('process query unavailable'); },
    openKeyboard: async () => { assert.fail('unexpected launch'); },
  });
  assert.equal(await processFailure(), false);
});
