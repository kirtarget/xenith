import test from 'node:test';
import assert from 'node:assert/strict';
import { applySettingsPatch, normalizeSettings } from '../../src/main/settings-core';
import { fitForTarget, fitPatch } from '../../src/shared/video-fit';
import { effectiveSettings } from '../../src/renderer/stream/settings-map';

test('old settings gain an empty cloud fit map while preserving the global choice', () => {
  const settings = normalizeSettings({ video: { fit: 'cover' } });
  assert.deepEqual(settings.video.cloudFits, {});
  assert.equal(fitForTarget(settings, null), 'cover');
  assert.equal(fitForTarget(settings, { kind: 'cloud', targetId: 'new-game' }), 'cover');
});

test('cloud fit choices persist by title without changing home or global defaults', () => {
  const initial = normalizeSettings({});
  const first = applySettingsPatch(initial, fitPatch(initial, { kind: 'cloud', targetId: 'game-A' }, 'cover'));
  const second = applySettingsPatch(first, fitPatch(first, { kind: 'cloud', targetId: 'game-B' }, 'fill'));
  const reloaded = normalizeSettings(JSON.parse(JSON.stringify(second)));
  assert.equal(fitForTarget(reloaded, { kind: 'cloud', targetId: 'game-A' }), 'cover');
  assert.equal(fitForTarget(reloaded, { kind: 'cloud', targetId: 'game-B' }), 'fill');
  assert.equal(fitForTarget(reloaded, { kind: 'cloud', targetId: 'game-C' }), 'contain');
  assert.equal(fitForTarget(reloaded, { kind: 'home', targetId: 'game-A' }), 'contain');
  assert.equal(reloaded.video.fit, 'contain');
  assert.deepEqual(initial.video.cloudFits, {});
});

test('changing one remembered title keeps other choices and supports returning to Fit', () => {
  const initial = normalizeSettings({ video: { cloudFits: { A: 'cover', B: 'fill' } } });
  const changed = applySettingsPatch(initial, fitPatch(initial, { kind: 'cloud', targetId: 'A' }, 'contain'));
  assert.deepEqual(changed.video.cloudFits, { A: 'contain', B: 'fill' });
  assert.equal(fitForTarget(changed, { kind: 'cloud', targetId: 'A' }), 'contain');
});

test('home and global fit patches keep cloud preferences intact', () => {
  const initial = normalizeSettings({ video: { cloudFits: { A: 'cover' } } });
  const home = applySettingsPatch(initial, fitPatch(initial, { kind: 'home', targetId: 'xbox' }, 'fill'));
  const global = applySettingsPatch(home, fitPatch(home, null, 'cover'));
  assert.equal(home.video.fit, 'fill');
  assert.equal(global.video.fit, 'cover');
  assert.deepEqual(global.video.cloudFits, { A: 'cover' });
});

test('cloud fit normalization rejects unsafe IDs and values while accepting valid IDs', () => {
  const fits = JSON.parse('{"valid.Title_1-2":"cover","__proto__":"fill","constructor":"cover","prototype":"fill",".":"cover","..":"fill","../bad":"cover","empty":"","wrong":"zoom","number":2}');
  fits['x'.repeat(64)] = 'fill';
  fits['x'.repeat(65)] = 'cover';
  const settings = normalizeSettings({ video: { cloudFits: fits } });
  assert.deepEqual(settings.video.cloudFits, { 'valid.Title_1-2': 'cover', ['x'.repeat(64)]: 'fill' });
  assert.equal(fitForTarget(settings, { kind: 'cloud', targetId: 'constructor' }), 'contain');
  assert.equal(Object.getPrototypeOf(settings.video.cloudFits), Object.prototype);
});

test('cloud fit map is bounded and non-object input falls back to an independent map', () => {
  const fits = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`title-${i}`, 'cover']));
  const settings = normalizeSettings({ video: { cloudFits: fits } });
  assert.equal(Object.keys(settings.video.cloudFits).length, 1000);
  const invalid = applySettingsPatch(settings, { video: { cloudFits: [] } });
  assert.deepEqual(invalid.video.cloudFits, settings.video.cloudFits);
  assert.notEqual(invalid.video.cloudFits, settings.video.cloudFits);
});

test('cloud fit records replace as a unit when patched directly', () => {
  const initial = normalizeSettings({ video: { cloudFits: { A: 'cover' } } });
  const changed = applySettingsPatch(initial, { video: { cloudFits: { B: 'fill' } } });
  assert.deepEqual(changed.video.cloudFits, { B: 'fill' });
});

test('new selections persist even when the remembered title map is full', () => {
  const fits = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`title-${i}`, 'cover']));
  const initial = normalizeSettings({ video: { cloudFits: fits } });
  const changed = applySettingsPatch(initial, fitPatch(initial, { kind: 'cloud', targetId: 'new-title' }, 'fill'));
  assert.equal(Object.keys(changed.video.cloudFits).length, 1000);
  assert.equal(changed.video.cloudFits['new-title'], 'fill');
});

test('engine settings resolve saved fit for the current cloud title only', () => {
  const settings = normalizeSettings({ video: { fit: 'contain', cloudFits: { A: 'cover' } } });
  assert.equal(effectiveSettings(settings, { kind: 'cloud', targetId: 'A' }).fit, 'cover');
  assert.equal(effectiveSettings(settings, { kind: 'cloud', targetId: 'B' }).fit, 'contain');
  assert.equal(effectiveSettings(settings, { kind: 'home', targetId: 'A' }).fit, 'contain');
  assert.equal(effectiveSettings(settings).fit, 'contain');
});
