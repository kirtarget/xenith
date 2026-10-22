import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bytesEqual, KV, KVDocument, parseBinaryVdf, serializeBinaryVdf } from '../../../src/main/platform/impl/vdf';
import { emptyShortcutsDoc, listShortcuts, parseShortcuts, removeShortcut, serializeShortcuts, upsertShortcut, xcloudTitleIdOf } from '../../../src/main/platform/impl/shortcuts';

const synthetic: KVDocument = {
  root: { entries: [{ key: 'root', type: KV.MAP, value: { entries: [
    { key: 's', type: KV.STRING, value: 'привет "quoted" C:\\path' },
    { key: 'i', type: KV.INT32, value: -123456 },
    { key: 'f', type: KV.FLOAT32, value: Uint8Array.from([0x00, 0x00, 0xc0, 0x3f]) },
    { key: 'p', type: KV.POINTER, value: Uint8Array.from([1, 2, 3, 4]) },
    { key: 'w', type: KV.WSTRING, value: Uint8Array.from([0x41, 0, 0x42, 0]) },
    { key: 'c', type: KV.COLOR, value: Uint8Array.from([255, 0, 128, 255]) },
    { key: 'u', type: KV.UINT64, value: 0xfedcba9876543210n },
    { key: 'l', type: KV.INT64, value: -2n },
    { key: 'empty', type: KV.MAP, value: { entries: [] } },
    { key: 'alt', type: KV.MAP, value: { entries: [{ key: 'x', type: KV.STRING, value: '' }], end: KV.END_ALT } },
  ] } }] },
  trailing: new Uint8Array(0),
};

test('synthetic: serialize → parse → serialize is byte-identical and value-preserving', () => {
  const a = serializeBinaryVdf(synthetic);
  const doc = parseBinaryVdf(a);
  assert.deepEqual(doc, synthetic);
  assert.ok(bytesEqual(serializeBinaryVdf(doc), a));
});

test('rejects truncated input', () => {
  const a = serializeBinaryVdf(synthetic);
  assert.throws(() => parseBinaryVdf(a.subarray(0, a.length - 3)));
});

test('shortcuts: add, update, list, remove — add+remove of the last entry round-trips byte-for-byte', () => {
  const doc = emptyShortcutsDoc();
  upsertShortcut(doc, { appName: 'Other', exe: '"C:\\other.exe"', startDir: '"C:\\"', tags: ['A'] });
  const before = serializeShortcuts(doc);
  const reparsed = parseShortcuts(before);
  const { appid, created } = upsertShortcut(reparsed, { appName: 'Xenith: Halo', exe: '"C:\\X\\Xenith.exe"', startDir: '"C:\\X"', launchOptions: '--xcloud=HALO', tags: ['Xenith'] });
  assert.equal(created, true);
  const again = upsertShortcut(reparsed, { appName: 'Xenith: Halo', exe: '"C:\\X\\Xenith.exe"', startDir: '"C:\\X"', launchOptions: '--xcloud=HALO', tags: ['Xenith'] });
  assert.equal(again.created, false);
  const list = listShortcuts(reparsed);
  assert.equal(list.length, 2);
  assert.equal(list[1].appid, appid);
  assert.equal(xcloudTitleIdOf(list[1]), 'HALO');
  assert.ok(removeShortcut(reparsed, appid));
  assert.ok(bytesEqual(serializeShortcuts(reparsed), before));
});

test('removing a middle entry renumbers keys', () => {
  const doc = emptyShortcutsDoc();
  const a = upsertShortcut(doc, { appName: 'A', exe: '"a"', startDir: '""' }).appid;
  upsertShortcut(doc, { appName: 'B', exe: '"b"', startDir: '""' });
  removeShortcut(doc, a);
  assert.deepEqual(listShortcuts(doc).map((s) => [s.index, s.appName]), [['0', 'B']]);
});

// Real Steam files on this machine (read-only). Skipped when Steam is absent.
const steamRoot = process.env.XENITH_STEAM_ROOT_REAL ?? (process.platform === 'win32' ? 'C:\\Steam' : '');
const realFiles = steamRoot && existsSync(join(steamRoot, 'userdata'))
  ? readdirSync(join(steamRoot, 'userdata')).map((u) => join(steamRoot, 'userdata', u, 'config', 'shortcuts.vdf')).filter((f) => existsSync(f))
  : [];
test(`real shortcuts.vdf files round-trip byte-for-byte (${realFiles.length} found, read-only)`, { skip: realFiles.length === 0 }, () => {
  for (const f of realFiles) {
    const bytes = new Uint8Array(readFileSync(f));
    const doc = parseShortcuts(bytes);
    assert.ok(bytesEqual(serializeShortcuts(doc), bytes), f);
    assert.ok(listShortcuts(doc).length >= 0);
  }
});
