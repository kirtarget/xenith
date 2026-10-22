// Flydigi controller identification. Pure functions, unit-tested.
//
// USB ids (source: SDL src/joystick/usb_ids.h, main, 2026; Linux xpad patch "add ID for Flydigi Apex 5", 2025):
//   USB_VENDOR_FLYDIGI_V1 0x04b4 (Cypress VID, so only together with PID 0x2412)
//     0x2412  Vader 2 / Vader 2 Pro / Apex 2 / Apex 3 (all share VID/PID/name)
//   USB_VENDOR_FLYDIGI_V2 0x37d7
//     0x2401  Vader (3/4/5 series, V2)        0x2501  Apex (Apex 5, also its XInput mode per xpad)
//     0x2502  Apex 6 (SDL USB_PRODUCT_FLYDIGI_V2_APEX6)
// UNVERIFIED on hardware here: the exact PID the Apex 6 Pro reports over its 2.4 GHz dongle. SDL's hidapi driver
// reads "wired/wireless" from a vendor info report (byte 6), i.e. cable and dongle share VID/PID, so PnP alone
// cannot tell them apart. In XInput mode some Flydigi pads enumerate as a generic 045E:028E Xbox 360 pad and are
// only recognisable by name. Bluetooth (Switch/BT mode) uses other ids; we match those by name.

export interface FlydigiId { vid: number; pid: number | null; model: string; source: string; verified: boolean }

export const FLYDIGI_IDS: FlydigiId[] = [
  { vid: 0x04b4, pid: 0x2412, model: 'Flydigi Vader 2 / Apex 2 / Apex 3', source: 'SDL usb_ids.h', verified: false },
  { vid: 0x37d7, pid: 0x2502, model: 'Flydigi Apex 6', source: 'SDL usb_ids.h', verified: false },
  { vid: 0x37d7, pid: 0x2501, model: 'Flydigi Apex 5', source: 'SDL usb_ids.h, Linux xpad', verified: false },
  { vid: 0x37d7, pid: 0x2401, model: 'Flydigi Vader', source: 'SDL usb_ids.h', verified: false },
  { vid: 0x37d7, pid: null, model: 'Flydigi controller', source: 'SDL usb_ids.h (vendor)', verified: false },
];

export const FLYDIGI_NAME = /flydigi|\bapex ?[2-9]\b|\bvader ?[2-9]\b/i;

export type Connection = 'usb' | 'bluetooth' | 'dongle' | 'virtual' | 'unknown';

export interface FlydigiMatch { model: string; by: 'id' | 'vendor' | 'name' }

export function matchFlydigi(vid: number | null, pid: number | null, name?: string | null): FlydigiMatch | null {
  if (vid !== null) {
    const exact = FLYDIGI_IDS.find((d) => d.vid === vid && d.pid !== null && d.pid === pid);
    if (exact) return { model: exact.model, by: 'id' };
    const vendor = FLYDIGI_IDS.find((d) => d.vid === vid && d.pid === null);
    if (vendor) return { model: vendor.model, by: 'vendor' };
  }
  if (name && /flydigi/i.test(name)) return { model: name.trim(), by: 'name' };
  return null;
}

/** Extracts VID/PID from a Windows PnP instance id: USB\VID_37D7&PID_2502\..., HID\VID_37D7&PID_2502&MI_00\...,
 *  BTHENUM\{...}_VID&0002045E_PID&0B13\..., BTHLEDEVICE\{...}_Dev_VID&02045e_PID&0b13_REV&... */
export function parseWindowsIds(instanceId: string): { vid: number | null; pid: number | null } {
  const m = /VID[_&]([0-9A-F]{4,8})[&_]PID[_&]?([0-9A-F]{4})/i.exec(instanceId);
  if (!m) return { vid: null, pid: null };
  return { vid: parseInt(m[1].slice(-4), 16), pid: parseInt(m[2], 16) };
}

export function connectionFromWindows(instanceId: string, name = ''): Connection {
  const id = instanceId.toUpperCase();
  if (/^(BTHENUM|BTHLE|BTHLEDEVICE)\\/.test(id) || id.includes('{00001124-0000-1000-8000-00805F9B34FB}') || id.includes('{00001812-0000-1000-8000-00805F9B34FB}')) return 'bluetooth';
  if (/receiver|dongle|2\.4 ?g/i.test(name)) return 'dongle';
  if (/^(USB|HID)\\VID_/.test(id)) return 'usb';
  if (/^(ROOT|SWD)\\/.test(id) || /VIGEM|VIRTUAL/.test(id)) return 'virtual';
  return 'unknown';
}

/** Linux /sys/bus/hid/devices/<BUS>:<VID>:<PID>.<N>  (bus 0003 = USB, 0005 = Bluetooth, 0006 = virtual/uhid). */
export function parseLinuxHidDir(dirName: string): { bus: number; vid: number; pid: number } | null {
  const m = /^([0-9A-F]{4}):([0-9A-F]{4}):([0-9A-F]{4})\.[0-9A-F]+$/i.exec(dirName);
  return m ? { bus: parseInt(m[1], 16), vid: parseInt(m[2], 16), pid: parseInt(m[3], 16) } : null;
}
export function connectionFromLinuxBus(bus: number, name = ''): Connection {
  if (bus === 0x05) return 'bluetooth';
  if (bus === 0x03) return /receiver|dongle|2\.4 ?g/i.test(name) ? 'dongle' : 'usb';
  if (bus === 0x06) return 'virtual';
  return 'unknown';
}

/** Space Station identification (Windows). Inno Setup uninstall key from silentinstallhq / winget
 *  (package Flydigi.FlydigiSpaceStation, publisher "Flydigi, Inc."). Process names are not documented
 *  publicly — matched heuristically (UNVERIFIED). */
export const SPACE_STATION_UNINSTALL_KEY = '{7BCA93D4-0551-4DC8-8F96-D0FF8D259C99}_is1';
export const SPACE_STATION_NAME = /flydigi|space ?station/i;
export const SPACE_STATION_PROCESS = /^(flydigi.*|.*spacestation.*|fdspace.*)$/i;
export function isSpaceStationApp(displayName: string | null | undefined, publisher: string | null | undefined, keyName: string | null | undefined): boolean {
  if (keyName && keyName.toUpperCase() === SPACE_STATION_UNINSTALL_KEY.toUpperCase()) return true;
  if (publisher && /flydigi/i.test(publisher)) return true;
  return !!displayName && /flydigi/i.test(displayName);
}
