import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { probeDeck } from '../../../src/main/platform/impl/deck';
import { planSwitches, mergeFeatureList } from '../../../src/main/platform/impl/switches';
import { DEFAULT_SETTINGS } from '../../../src/shared/api';

const fx = (name: string) => join(process.cwd(), 'tools', 'platform-test', 'fixtures', name);

test('Steam Deck LCD (Jupiter) in gaming mode', () => {
  const d = probeDeck(fx('deck-lcd'), { GAMESCOPE_WAYLAND_DISPLAY: 'gamescope-0', XDG_CURRENT_DESKTOP: 'gamescope', SteamDeck: '1' }, 'linux');
  assert.equal(d.isSteamDeck, true);
  assert.equal(d.model, 'lcd');
  assert.equal(d.isGamescope, true);
  assert.equal(d.isSteamOS, true);
});

test('Steam Deck OLED (Galileo) in desktop mode (KDE Wayland)', () => {
  const d = probeDeck(fx('deck-oled'), { WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'KDE' }, 'linux');
  assert.equal(d.isSteamDeck, true);
  assert.equal(d.model, 'oled');
  assert.equal(d.isGamescope, false);
  assert.equal(d.isWayland, true);
});

test('generic PC is not a Deck; DMI is ignored on Windows', () => {
  assert.equal(probeDeck(fx('generic-pc'), {}, 'linux').isSteamDeck, false);
  assert.equal(probeDeck(fx('deck-lcd'), {}, 'win32').isSteamDeck, false);
});

test('switch plan: Windows', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  const deck = probeDeck(fx('generic-pc'), {}, 'win32');
  assert.deepEqual(planSwitches(s, 'win32', deck).switches, [['force_high_performance_gpu'], ['enable-gpu-rasterization']]);
  s.advanced.renderPipeline = 'vulkan'; s.advanced.gpuMode = 'low-power';
  assert.deepEqual(planSwitches(s, 'win32', deck).switches, [['force_low_power_gpu'], ['enable-gpu-rasterization'], ['use-angle', 'vulkan']]);
});

test('switch plan: Deck gaming mode uses X11 + VA-API (GL)', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  const deck = probeDeck(fx('deck-lcd'), { GAMESCOPE_WAYLAND_DISPLAY: 'gamescope-0' }, 'linux');
  const p = planSwitches(s, 'linux', deck);
  assert.ok(p.switches.some(([k, v]) => k === 'ozone-platform' && v === 'x11'));
  assert.ok(p.switches.some(([k, v]) => k === 'use-angle' && v === 'gl'));
  assert.deepEqual(p.enableFeatures, ['AcceleratedVideoDecodeLinuxGL', 'AcceleratedVideoDecodeLinuxZeroCopyGL']);
  s.advanced.renderPipeline = 'vulkan';
  assert.deepEqual(planSwitches(s, 'linux', deck).enableFeatures, ['VaapiIgnoreDriverChecks', 'Vulkan', 'DefaultANGLEVulkan', 'VulkanFromANGLE']);
  assert.ok(planSwitches(s, 'linux', deck, { XENITH_NO_VAAPI: '1' }).enableFeatures.length === 0);
});

test('feature lists merge with existing values', () => {
  assert.equal(mergeFeatureList('A,B', ['B', 'C']), 'A,B,C');
  assert.equal(mergeFeatureList('', ['X']), 'X');
});
