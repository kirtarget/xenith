import { app } from 'electron';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../../src/shared/api';
import { createSteam } from '../../src/main/platform/impl/steam';
import { DECK_LAYOUT_FILE } from '../../src/main/platform/impl/deck-layout';
import { listShortcuts, parseShortcuts } from '../../src/main/platform/impl/shortcuts';

app.whenReady().then(async () => {
  const testDir = join(process.cwd(), 'dist-test');
  mkdirSync(testDir, { recursive: true });
  const root = mkdtempSync(join(testDir, 'steam-smoke-'));
  process.env.XENITH_STEAM_ROOT = root;
  mkdirSync(join(root, 'userdata', '123', 'config'), { recursive: true });
  copyFileSync(join(process.cwd(), 'build', 'icon.png'), join(__dirname, 'icon.png'));
  try {
    const steam = createSteam({ getSettings: () => DEFAULT_SETTINGS });
    const console = { serverId: 'test-console', name: 'Test Xbox', type: 'XboxSeriesX', power: 'On', remotePlayReady: true };
    const result = await steam.addConsoleShortcut(console);
    assert.equal(result.ok, true, result.message);
    const file = join(root, 'userdata', '123', 'config', 'shortcuts.vdf');
    const first = listShortcuts(parseShortcuts(readFileSync(file)));
    assert.equal(first.length, 1);
    assert.match(first[0].launchOptions, /--xhome=test-console$/);
    for (const suffix of ['p', '_hero', '']) assert.ok(readFileSync(join(root, 'userdata', '123', 'config', 'grid', `${first[0].appid}${suffix}.jpg`)).length > 1000);
    await steam.addConsoleShortcut({ ...console, name: 'Renamed Xbox' });
    const next = listShortcuts(parseShortcuts(readFileSync(file)));
    assert.equal(next.length, 1);
    assert.equal(next[0].appid, first[0].appid);
    assert.match(next[0].appName, /Renamed Xbox$/);
    const installed = await steam.installDeckLayout();
    assert.equal(installed.ok, true, installed.message);
    assert.ok(existsSync(join(root, 'controller_base', 'templates', DECK_LAYOUT_FILE)));
    globalThis.console.log('PASS console tile, offline artwork, rename and template installation in isolated Steam root');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
