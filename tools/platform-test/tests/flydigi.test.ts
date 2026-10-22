import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionFromLinuxBus, connectionFromWindows, isSpaceStationApp, matchFlydigi, parseLinuxHidDir, parseWindowsIds } from '../../../src/main/platform/impl/flydigi';

test('matches Flydigi ids', () => {
  assert.equal(matchFlydigi(0x37d7, 0x2502)?.model, 'Flydigi Apex 6');
  assert.equal(matchFlydigi(0x37d7, 0x2501)?.model, 'Flydigi Apex 5');
  assert.equal(matchFlydigi(0x37d7, 0x9999)?.by, 'vendor');
  assert.equal(matchFlydigi(0x04b4, 0x2412)?.by, 'id');
  assert.equal(matchFlydigi(0x04b4, 0x0001), null);                // other Cypress devices are not Flydigi
  assert.equal(matchFlydigi(0x045e, 0x028e), null);                // generic Xbox 360 (XInput mode) without a name
  assert.equal(matchFlydigi(0x045e, 0x028e, 'Flydigi Apex 4')?.by, 'name');
  assert.equal(matchFlydigi(0x045e, 0x0b13, 'Xbox Wireless Controller'), null);
});

test('parses Windows PnP instance ids', () => {
  assert.deepEqual(parseWindowsIds('USB\\VID_37D7&PID_2502\\5&2B1C&0&3'), { vid: 0x37d7, pid: 0x2502 });
  assert.deepEqual(parseWindowsIds('HID\\VID_37D7&PID_2502&MI_00\\7&1A&0&0000'), { vid: 0x37d7, pid: 0x2502 });
  assert.deepEqual(parseWindowsIds('BTHENUM\\{00001124-0000-1000-8000-00805F9B34FB}_VID&0002045E_PID&0B13\\8&ABC'), { vid: 0x045e, pid: 0x0b13 });
  assert.deepEqual(parseWindowsIds('BTHLEDEVICE\\{00001812-0000-1000-8000-00805F9B34FB}_DEV_VID&02045E_PID&0B13_REV&0517_ABCD'), { vid: 0x045e, pid: 0x0b13 });
  assert.deepEqual(parseWindowsIds('ROOT\\SYSTEM\\0001'), { vid: null, pid: null });
});

test('connection type', () => {
  assert.equal(connectionFromWindows('USB\\VID_37D7&PID_2502\\x'), 'usb');
  assert.equal(connectionFromWindows('HID\\VID_37D7&PID_2502\\x', 'Flydigi 2.4G Receiver'), 'dongle');
  assert.equal(connectionFromWindows('BTHLEDEVICE\\{00001812-0000-1000-8000-00805F9B34FB}_Dev_VID&0237d7_PID&2502'), 'bluetooth');
  assert.equal(connectionFromWindows('ROOT\\VIGEMBUS\\0000'), 'virtual');
  assert.deepEqual(parseLinuxHidDir('0003:37D7:2502.0004'), { bus: 3, vid: 0x37d7, pid: 0x2502 });
  assert.equal(parseLinuxHidDir('not-a-hid'), null);
  assert.equal(connectionFromLinuxBus(5), 'bluetooth');
  assert.equal(connectionFromLinuxBus(3), 'usb');
});

test('Space Station app match', () => {
  assert.ok(isSpaceStationApp('FlydigiSpaceStation', null, null));
  assert.ok(isSpaceStationApp(null, 'Flydigi, Inc.', null));
  assert.ok(isSpaceStationApp(null, null, '{7BCA93D4-0551-4DC8-8F96-D0FF8D259C99}_is1'));
  assert.ok(!isSpaceStationApp('Space Station 14', 'Space Wizards', 'Steam App 1255460'));
});
