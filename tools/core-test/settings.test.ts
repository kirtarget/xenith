import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../src/shared/api';
import { applySettingsPatch, normalizeSettings } from '../../src/main/settings-core';

test('empty / garbage input yields defaults', () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings('nope'), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings([1, 2]), DEFAULT_SETTINGS);
});

test('result is a copy, not the defaults object', () => {
  const s = normalizeSettings({});
  s.streaming.customKbps = 1;
  s.controllers.remap.A = 'B';
  assert.equal(DEFAULT_SETTINGS.streaming.customKbps, 20000);
  assert.deepEqual(DEFAULT_SETTINGS.controllers.remap, {});
});

test('forward compatible: partial old file gets new keys, unknown keys dropped', () => {
  const s = normalizeSettings({ streaming: { resolution: '1080' }, video: { hud: 'full' }, future: { x: 1 }, ui: { lang: 'en', newKey: true } });
  assert.equal(s.streaming.resolution, '1080');
  assert.equal(s.streaming.profile, 'low-latency');
  assert.equal(s.video.hud, 'full');
  assert.equal(s.ui.lang, 'en');
  assert.equal((s as any).future, undefined);
  assert.equal((s.ui as any).newKey, undefined);
  assert.deepEqual(s.advanced, DEFAULT_SETTINGS.advanced);
});

test('numbers are clamped, coerced and rounded', () => {
  const s = normalizeSettings({
    streaming: { customKbps: 99999.6 }, video: { sharpness: -3, brightness: 7, contrast: '1.2', saturation: NaN },
    audio: { volume: 1.5 }, controllers: { deadZone: 0.9 },
  });
  assert.equal(s.streaming.customKbps, 40000);
  assert.equal(s.video.sharpness, 0);
  assert.equal(s.video.brightness, 1.5);
  assert.equal(s.video.contrast, 1.2);
  assert.equal(s.video.saturation, 1);
  assert.equal(s.audio.volume, 1);
  assert.equal(s.controllers.deadZone, 0.3);
  assert.equal(normalizeSettings({ streaming: { customKbps: 12345.4 } }).streaming.customKbps, 12345);
  assert.equal(normalizeSettings({ streaming: { customKbps: 10 } }).streaming.customKbps, 5000);
});

test('enums, booleans and nullable strings are validated', () => {
  const s = normalizeSettings({
    streaming: { resolution: '4k', codec: 'hevc', lastServerId: 42, autoConnectOnLaunch: 'yes' },
    network: { regionName: null }, ui: { scale: 'xxl', layout: 'deck' }, advanced: { gpuMode: 'low-power', renderPipeline: 'metal' },
  });
  assert.equal(s.streaming.resolution, 'auto');
  assert.equal(s.streaming.codec, 'main');
  assert.equal(s.streaming.lastServerId, null);
  assert.equal(s.streaming.autoConnectOnLaunch, false);
  assert.equal(s.network.regionName, null);
  assert.equal(s.ui.scale, 'm');
  assert.equal(s.ui.layout, 'deck');
  assert.equal(s.advanced.gpuMode, 'low-power');
  assert.equal(s.advanced.renderPipeline, 'auto');
  assert.equal(normalizeSettings({ network: { regionName: 'WestEurope' } }).network.regionName, 'WestEurope');
});

test('patch deep-merges and keeps untouched groups', () => {
  const base = normalizeSettings({ video: { sharpness: 4 }, ui: { lang: 'en' } });
  const next = applySettingsPatch(base, { video: { hud: 'compact' }, streaming: { lastServerId: 'F000000000000001' } });
  assert.equal(next.video.sharpness, 4);
  assert.equal(next.video.hud, 'compact');
  assert.equal(next.ui.lang, 'en');
  assert.equal(next.streaming.lastServerId, 'F000000000000001');
  assert.equal(applySettingsPatch(next, { streaming: { lastServerId: null } }).streaming.lastServerId, null);
});

test('remap is replaced as a whole and sanitised', () => {
  const a = applySettingsPatch(DEFAULT_SETTINGS, { controllers: { remap: { A: 'B', X: 'Y' } } });
  assert.deepEqual(a.controllers.remap, { A: 'B', X: 'Y' });
  const b = applySettingsPatch(a, { controllers: { remap: { B: 'A' } } });
  assert.deepEqual(b.controllers.remap, { B: 'A' });
  const c = applySettingsPatch(b, { controllers: { remap: { A: 5 } as any } });
  assert.deepEqual(c.controllers.remap, {});
});

test('invalid patch values keep the current value', () => {
  const cur = applySettingsPatch(DEFAULT_SETTINGS, { video: { fit: 'cover', brightness: 1.2 } });
  const next = applySettingsPatch(cur, { video: { fit: 'stretch' as any, brightness: 'x' as any } });
  assert.equal(next.video.fit, 'cover');
  assert.equal(next.video.brightness, 1.2);
  assert.equal(applySettingsPatch(cur, { video: { brightness: 9 } }).video.brightness, 1.5);
});