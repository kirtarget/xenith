import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from '../../../src/main/platform/impl/crc32';
import { accountIdFromSteamId64, shortcutAppId, shortcutGameId64, toSigned32 } from '../../../src/main/platform/impl/steam-ids';

test('crc32 standard check values', () => {
  assert.equal(crc32('123456789'), 0xcbf43926);       // CRC-32/ISO-HDLC check value
  assert.equal(crc32(''), 0);
  assert.equal(crc32('The quick brown fox jumps over the lazy dog'), 0x414fa339);
});

test('shortcut appid = crc32(exe + name) | 0x80000000', () => {
  // exe+name concatenates to the CRC check string → high bit already set
  assert.equal(shortcutAppId('12345', '6789'), 0xcbf43926);
  // CRC with high bit clear gets it set: crc32("a") = 0xE8B7BE43 (set), crc32("abc") = 0x352441C2 (clear)
  assert.equal(shortcutAppId('ab', 'c'), (0x352441c2 | 0x80000000) >>> 0);
  assert.equal(shortcutAppId('ab', 'c'), 3039052226);
  assert.equal(toSigned32(3039052226), 3039052226 - 2 ** 32);
  // UTF-8 bytes are hashed (Cyrillic name)
  assert.equal(shortcutAppId('"C:\\x.exe"', 'Игра'), (crc32(new TextEncoder().encode('"C:\\x.exe"Игра')) | 0x80000000) >>> 0);
});

test('64-bit game id for steam://rungameid', () => {
  assert.equal(shortcutGameId64(0xcbf43926), (0xcbf43926n << 32n) | 0x02000000n);
});

test('SteamID64 → userdata account id', () => {
  assert.equal(accountIdFromSteamId64('76561198067201345'), String(76561198067201345n - 76561197960265728n));
  assert.equal(accountIdFromSteamId64('76561197960265729'), '1');
});
