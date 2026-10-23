import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECK_LAYOUT_FILE, DECK_LAYOUT_TITLE, deckLayoutVdf, writeDeckLayout } from '../../../src/main/platform/impl/deck-layout';

interface Entry { key: string; value: string | Entry[] }
function parseVdf(text: string): Entry[] {
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}]/g) ?? [];
  let index = 0;
  const parse = (nested = false): Entry[] => {
    const entries: Entry[] = [];
    while (index < tokens.length) {
      const token = tokens[index++];
      if (token === '}') { assert.ok(nested); return entries; }
      assert.ok(token.startsWith('"'));
      const key = JSON.parse(token) as string;
      const value = tokens[index++];
      assert.ok(value !== undefined);
      entries.push({ key, value: value === '{' ? parse(true) : JSON.parse(value) as string });
    }
    assert.equal(nested, false, 'unclosed KeyValues object');
    return entries;
  };
  return parse();
}
const value = (entries: Entry[], key: string) => entries.find(entry => entry.key === key)?.value;
const object = (entries: Entry[], key: string): Entry[] => {
  const found = value(entries, key);
  assert.ok(Array.isArray(found), `missing object ${key}`);
  return found;
};

test('Deck template links every standard controller group and gyro to its source', () => {
  const root = object(parseVdf(deckLayoutVdf()), 'controller_mappings');
  assert.equal(value(root, 'title'), DECK_LAYOUT_TITLE);
  assert.equal(value(root, 'controller_type'), 'controller_neptune');
  const groups = root.filter(entry => entry.key === 'group').map(entry => entry.value as Entry[]);
  const sources = object(object(root, 'preset'), 'group_source_bindings');
  assert.equal(groups.length, sources.length);
  assert.equal(new Set(groups.map(group => value(group, 'id'))).size, groups.length);
  for (const group of groups) assert.ok(sources.some(source => source.key === value(group, 'id')));
  for (const source of ['button_diamond', 'dpad', 'joystick', 'right_joystick', 'left_trigger', 'right_trigger', 'switch', 'left_trackpad', 'right_trackpad', 'gyro']) {
    assert.ok(sources.some(entry => entry.value === `${source} active`), source);
  }
  const gyroId = sources.find(entry => entry.value === 'gyro active')!.key;
  const gyro = groups.find(group => value(group, 'id') === gyroId)!;
  assert.equal(value(gyro, 'mode'), 'mouse_joystick');
  assert.equal(value(object(gyro, 'settings'), 'output_joystick'), '1');
  assert.equal(value(object(gyro, 'settings'), 'gyro_button'), '12', 'Steam gyro enable selector 12 is left trigger soft pull');
  for (const [source, expected] of [['joystick', '0'], ['right_joystick', '1']] as const) {
    const id = sources.find(entry => entry.value === `${source} active`)!.key;
    const group = groups.find(group => value(group, 'id') === id)!;
    assert.equal(value(object(group, 'settings'), 'output_joystick'), expected, source);
  }
  for (const [source, expected] of [['left_trigger', '1'], ['right_trigger', '2']] as const) {
    const id = sources.find(entry => entry.value === `${source} active`)!.key;
    const group = groups.find(group => value(group, 'id') === id)!;
    assert.equal(value(object(group, 'settings'), 'output_trigger'), expected, source);
  }
});

test('Deck back buttons: L4/R4 stick clicks, L5/R5 X/Y', () => {
  const root = object(parseVdf(deckLayoutVdf()), 'controller_mappings');
  const switches = root.filter(entry => entry.key === 'group').map(entry => entry.value as Entry[]).find(group => value(group, 'mode') === 'switches')!;
  const inputs = object(switches, 'inputs');
  const bindings = {
    button_back_left_upper: 'xinput_button JOYSTICK_LEFT', button_back_right_upper: 'xinput_button JOYSTICK_RIGHT',
    button_back_left: 'xinput_button X', button_back_right: 'xinput_button Y',
    button_escape: 'xinput_button START', button_menu: 'xinput_button SELECT',
    left_bumper: 'xinput_button SHOULDER_LEFT', right_bumper: 'xinput_button SHOULDER_RIGHT',
  };
  for (const [button, binding] of Object.entries(bindings)) {
    assert.equal(value(object(object(object(object(inputs, button), 'activators'), 'Full_Press'), 'bindings'), 'binding'), binding);
  }
});

test('installing the template is repeatable and preserves user changes in a backup', (t) => {
  const testDir = join(process.cwd(), 'dist-test');
  mkdirSync(testDir, { recursive: true });
  const root = mkdtempSync(join(testDir, 'xenith-deck-layout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = writeDeckLayout(root);
  assert.equal(file, join(root, 'controller_base', 'templates', DECK_LAYOUT_FILE));
  assert.equal(readFileSync(file, 'utf8'), deckLayoutVdf());
  writeDeckLayout(root);
  assert.deepEqual(readdirSync(join(root, 'controller_base', 'templates')), [DECK_LAYOUT_FILE]);
  writeFileSync(file, 'user-customized template', 'utf8');
  writeDeckLayout(root);
  assert.equal(readFileSync(`${file}.xenith-backup`, 'utf8'), 'user-customized template');
  assert.equal(readFileSync(file, 'utf8'), deckLayoutVdf());
  writeDeckLayout(root);
  assert.equal(readFileSync(`${file}.xenith-backup`, 'utf8'), 'user-customized template');
});
