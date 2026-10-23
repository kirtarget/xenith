import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DECK_LAYOUT_FILE = 'controller_neptune_xenith.vdf';
export const DECK_LAYOUT_TITLE = 'Xenith - Gyro and back buttons';
const RIGHT_STICK_OUTPUT = '1';
// Steam's gyro enable selector (order of the Gyro Enable Button list): 12 = Left Trigger Soft Pull,
// the value Steam's own PS5 'Gamepad with Mouse and Gyro' template uses. 1 would be right-pad touch.
const GYRO_LEFT_TRIGGER_SOFT = '12';

interface Group {
  source: string;
  mode: string;
  inputs?: Record<string, string>;
  settings?: Record<string, string>;
}

const groups: Group[] = [
  { source: 'button_diamond', mode: 'four_buttons', inputs: { button_a: 'xinput_button A', button_b: 'xinput_button B', button_x: 'xinput_button X', button_y: 'xinput_button Y' } },
  { source: 'dpad', mode: 'dpad', inputs: { dpad_north: 'xinput_button DPAD_UP', dpad_south: 'xinput_button DPAD_DOWN', dpad_east: 'xinput_button DPAD_RIGHT', dpad_west: 'xinput_button DPAD_LEFT' } },
  { source: 'joystick', mode: 'joystick_move', inputs: { click: 'xinput_button JOYSTICK_LEFT' }, settings: { output_joystick: '0' } },
  { source: 'right_joystick', mode: 'joystick_move', inputs: { click: 'xinput_button JOYSTICK_RIGHT' }, settings: { output_joystick: RIGHT_STICK_OUTPUT } },
  { source: 'left_trigger', mode: 'trigger', settings: { output_trigger: '1' } },
  { source: 'right_trigger', mode: 'trigger', settings: { output_trigger: '2' } },
  { source: 'switch', mode: 'switches', inputs: {
    button_escape: 'xinput_button START', button_menu: 'xinput_button SELECT',
    left_bumper: 'xinput_button SHOULDER_LEFT', right_bumper: 'xinput_button SHOULDER_RIGHT',
    // Upper back buttons are L4/R4 (the *_upper names); the lower ones keep the Steam Controller grip names (L5/R5).
    button_back_left_upper: 'xinput_button JOYSTICK_LEFT', button_back_right_upper: 'xinput_button JOYSTICK_RIGHT',
    button_back_left: 'xinput_button X', button_back_right: 'xinput_button Y',
  } },
  // Trackpads as a mouse for cloud games with mouse and keyboard support (and Xenith's own UI):
  // right pad moves the cursor and clicks left, left pad click is the right mouse button.
  { source: 'left_trackpad', mode: 'single_button', inputs: { click: 'mouse_button RIGHT' } },
  { source: 'right_trackpad', mode: 'absolute_mouse', inputs: { click: 'mouse_button LEFT' } },
  { source: 'gyro', mode: 'mouse_joystick', settings: { output_joystick: RIGHT_STICK_OUTPUT, gyro_button: GYRO_LEFT_TRIGGER_SOFT, sensitivity: '100' } },
];

const pair = (key: string, value: string) => `"${key}" "${value}"`;
const block = (key: string, lines: string[]) => `${JSON.stringify(key)}\n{\n${lines.map(line => line.split('\n').map(part => `\t${part}`).join('\n')).join('\n')}\n}`;

export function deckLayoutVdf(): string {
  return block('controller_mappings', [
    pair('version', '3'), pair('title', DECK_LAYOUT_TITLE),
    pair('description', 'Xbox gamepad. Gyro aims while the left trigger is pulled. L4/R4 = left/right stick click, L5 = X, R5 = Y. Right trackpad = mouse with left click, left trackpad click = right click. Adjust gyro sensitivity in Steam Input.'),
    pair('controller_type', 'controller_neptune'),
    ...groups.map((group, i) => block('group', [
      pair('id', String(i)), pair('mode', group.mode),
      block('inputs', Object.entries(group.inputs ?? {}).map(([input, binding]) => block(input, [
        block('activators', [block('Full_Press', [block('bindings', [pair('binding', binding)])])]),
      ]))),
      ...(group.settings ? [block('settings', Object.entries(group.settings).map(([key, value]) => pair(key, value)))] : []),
    ])),
    block('preset', [pair('id', '0'), pair('name', 'Default'), block('group_source_bindings', groups.map((group, i) => pair(String(i), `${group.source} active`)))]),
    block('settings', [pair('left_trackpad_mode', '0'), pair('right_trackpad_mode', '0')]),
  ]) + '\n';
}

export function writeDeckLayout(steamRoot: string): string {
  const dir = join(steamRoot, 'controller_base', 'templates');
  const file = join(dir, DECK_LAYOUT_FILE);
  const body = deckLayoutVdf();
  if (existsSync(file) && readFileSync(file, 'utf8') === body) return file;
  mkdirSync(dir, { recursive: true });
  if (existsSync(file) && !existsSync(`${file}.xenith-backup`)) copyFileSync(file, `${file}.xenith-backup`);
  const tmp = `${file}.xenith-tmp`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, file);
  return file;
}
