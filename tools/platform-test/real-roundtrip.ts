// Reversible test on a REAL shortcuts.vdf:  backup (timestamped copy) → add a test shortcut → verify → remove →
// verify the file is byte-identical to the original. Aborts (and restores the backup) on any mismatch.
//   node tools/platform-test/run-roundtrip.mjs <path-to-shortcuts.vdf>
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { bytesEqual } from '../../src/main/platform/impl/vdf';
import { listShortcuts, parseShortcuts, removeShortcut, serializeShortcuts, upsertShortcut } from '../../src/main/platform/impl/shortcuts';

const file = process.argv[2];
if (!file) throw new Error('usage: run-roundtrip <shortcuts.vdf>');
const original = new Uint8Array(readFileSync(file));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${file}.backup-${stamp}`;
copyFileSync(file, backup);
const log = (m: string) => console.log(m);
log(`backup: ${backup} (${original.length} bytes)`);
try {
  const doc = parseShortcuts(original);
  const before = listShortcuts(doc).length;
  const { appid, created } = upsertShortcut(doc, { appName: 'Xenith Roundtrip Test', exe: '"C:\\Xenith\\Xenith.exe"', startDir: '"C:\\Xenith"', launchOptions: '--xcloud=ROUNDTRIP', tags: ['Xenith'] });
  if (!created) throw new Error('test shortcut unexpectedly existed');
  writeFileSync(file, serializeShortcuts(doc));
  const withTest = listShortcuts(parseShortcuts(new Uint8Array(readFileSync(file))));
  log(`added appid ${appid}; shortcuts ${before} → ${withTest.length}; present=${withTest.some((s) => s.appid === appid)}`);
  const doc2 = parseShortcuts(new Uint8Array(readFileSync(file)));
  if (!removeShortcut(doc2, appid)) throw new Error('remove failed');
  writeFileSync(file, serializeShortcuts(doc2));
  const after = new Uint8Array(readFileSync(file));
  const same = bytesEqual(after, original) && bytesEqual(after, new Uint8Array(readFileSync(backup)));
  log(`removed; byte-identical to original: ${same}`);
  if (!same) throw new Error('mismatch');
} catch (e) {
  copyFileSync(backup, file);
  log(`ERROR ${(e as Error).message} — original restored from backup`);
  process.exitCode = 1;
}
