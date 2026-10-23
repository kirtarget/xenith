import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleShortcutSpec } from '../../../src/main/platform/impl/console-shortcut';
import { emptyShortcutsDoc, listShortcuts, parseShortcuts, serializeShortcuts, upsertShortcut } from '../../../src/main/platform/impl/shortcuts';

const target = { exe: '/home/deck/My Apps/steam-launch.sh', startDir: '/home/deck/My Apps', argsPrefix: '' };

test('console tile launches its selected Xbox and keeps identity after a rename', () => {
  const first = consoleShortcutSpec({ serverId: 'console-123', name: 'Living room' }, target);
  const renamed = consoleShortcutSpec({ serverId: 'console-123', name: 'Bedroom' }, target);
  assert.equal(first.launchOptions, '--xhome=console-123');
  assert.equal(first.exe, '"/home/deck/My Apps/steam-launch.sh"');
  assert.equal(first.startDir, '"/home/deck/My Apps"');
  assert.equal(first.appid, renamed.appid);
  assert.notEqual(first.appid, consoleShortcutSpec({ serverId: 'console-456', name: 'Living room' }, target).appid);
  const doc = emptyShortcutsDoc();
  upsertShortcut(doc, first);
  upsertShortcut(doc, renamed);
  const shortcuts = listShortcuts(parseShortcuts(serializeShortcuts(doc)));
  assert.equal(shortcuts.length, 1);
  assert.equal(shortcuts[0].appName, 'Xenith: My Xbox - Bedroom');
  assert.equal(shortcuts[0].launchOptions, '--xhome=console-123');
});

test('console tile preserves development launch arguments and rejects unsafe IDs', () => {
  const dev = consoleShortcutSpec({ serverId: 'console.1', name: 'Xbox' }, { ...target, argsPrefix: '"/home/deck/Xenith source" ' });
  assert.equal(dev.launchOptions, '"/home/deck/Xenith source" --xhome=console.1');
  for (const serverId of ['', '.', '..', 'a b', 'a;whoami', 'a\n--xcloud=other', 'a'.repeat(65)]) {
    assert.throws(() => consoleShortcutSpec({ serverId, name: 'Xbox' }, target), /Invalid console ID/);
  }
});
