import type { ControllerInfo } from '../../shared/api';

/** Friendly controller info from the Gamepad API when the engine is not running. Connection type is not exposed by Chromium. */
export function controllerFromGamepad(g: Gamepad): ControllerInfo {
  const id = g.id;
  const low = id.toLowerCase();
  const isDeck = /28de.*1205|steam deck|valve.*neptune/.test(low);
  const isFlydigi = /flydigi|apex|04b4|2563|37d7/.test(low);
  let name = id.replace(/\s*\((standard gamepad|vendor:.*|stand.*)\)\s*/gi, '').trim();
  if (isDeck) name = 'Steam Deck';
  else if (isFlydigi) name = /apex\s*\d/i.test(id) ? (id.match(/apex\s*\d[^()]*/i)?.[0].trim() ?? 'Flydigi') : 'Flydigi';
  else if (/xbox|045e|xinput/.test(low)) name = 'Xbox Wireless Controller';
  else if (/dualsense|054c.*0ce6/.test(low)) name = 'DualSense';
  else if (/dualshock|054c/.test(low)) name = 'DualShock 4';
  if (!name) name = 'Gamepad';
  return { index: g.index, id, name, connection: 'unknown', isFlydigi, isDeck };
}

export function readGamepads(): ControllerInfo[] {
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  const out: ControllerInfo[] = [];
  for (const g of pads) if (g && g.connected) out.push(controllerFromGamepad(g));
  return out;
}

export function sameControllers(a: ControllerInfo[], b: ControllerInfo[]): boolean {
  return a.length === b.length && a.every((c, i) => c.id === b[i].id && c.index === b[i].index && c.connection === b[i].connection);
}
