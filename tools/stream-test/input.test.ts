// Offline test of InputManager (combos, HUD tap, overlay pause/resume gate, rumble parsing) with a fake Gamepad API.
// Run: node tools/stream-test/run-input-test.mjs
import { InputManager, buildMapping, describeGamepad } from '../../src/renderer/stream/input';

let clock = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
const pads: any[] = [{ connected: true, index: 0, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true, writable: true });
(globalThis as any).window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 1 };
(globalThis as any).document = { pointerLockElement: null };

const frame = () => ({ GamepadIndex: 0, A: 0, B: 0, X: 0, Y: 0, View: 0, Menu: 0, Nexus: 0, LeftTrigger: 0, RightTrigger: 0 });
const press = (i: number, on: boolean) => { pads[0].buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
const delivered: any[] = [];
const inputProc = { onMessage: (ev: any) => delivered.push(new Uint8Array(ev.data)) };
const player: any = {
  _config: {}, _inputDriver: { requestStates: () => { const f: any = frame(); f.View = pads[0].buttons[8].value; f.Menu = pads[0].buttons[9].value; f.A = pads[0].buttons[0].value; return [f]; }, getDefaultFamepadFrame: frame },
  getChannelProcessor: () => inputProc,
  setVibration() {}, setGamepadDeadZone() {}, setGamepadMaping() {},
};
const ev: string[] = [];
const rumbles: any[] = [];
const im = new InputManager(player, { overlay: () => ev.push('overlay'), hudToggle: () => ev.push('hud'), controllers: (l) => ev.push('controllers:' + l.length), rumble: (r) => rumbles.push(r) });
im.install();
im.apply({ controllers: { vibration: true, triggerRumble: false, deadZone: 0.1, guideCombo: true, overlayCombo: true, mouseKeyboard: false, remap: {} } } as any);
const ic = player.getChannelProcessor('input');
const tick = (ms = 4) => { clock += ms; return player._inputDriver.requestStates()[0]; };
const flush = () => new Promise((r) => setTimeout(r, 5));
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  // 1. lone View tap -> hudToggle, View forwarded
  press(8, true); let f = tick(); ok(f.View === 1, 'lone View is forwarded'); tick(100); press(8, false); tick(); await flush();
  ok(ev.includes('hud'), 'lone short View -> hudToggle');
  ev.length = 0;
  // 2. View+Menu short -> Nexus pulse, no View/Menu, no hud
  press(8, true); press(9, true); f = tick(); ok(f.View === 0 && f.Menu === 0, 'combo swallows View/Menu');
  tick(200); press(9, false); f = tick(); ok(f.View === 0, 'staggered release does not leak View'); press(8, false); f = tick(); await flush();
  ok(f.Nexus === 1, 'short combo -> Nexus pulse'); clock += 200; f = tick(); ok(f.Nexus === 0, 'Nexus pulse ends');
  ok(!ev.includes('hud') && !ev.includes('overlay'), 'short combo: no hud/overlay');
  // 3. hold 600 ms -> overlay, no Nexus
  press(8, true); press(9, true); tick(); for (let i = 0; i < 170; i++) tick(4); await flush();
  ok(ev.includes('overlay'), 'hold >=600 ms -> overlayRequest'); press(8, false); press(9, false); f = tick(); ok(f.Nexus === 0, 'long hold: no Nexus');
  ev.length = 0;
  // 4. overlay open -> neutral; close with A held -> gated until release
  im.setPaused(true); press(0, true); f = tick(); ok(f.A === 0, 'paused: neutral'); im.setPaused(false); f = tick(); ok(f.A === 0, 'resume: held A gated');
  press(0, false); tick(); press(0, true); f = tick(); ok(f.A === 1, 'after release: A forwarded again'); press(0, false); tick();
  // 5. pressGuide
  im.pressGuide(); f = tick(); ok(f.Nexus === 1, 'pressGuide -> Nexus');
  // 6. rumble: parse + trigger zeroing (triggerRumble=false)
  const buf = new Uint8Array([128, 0, 0, 0, 50, 25, 80, 90, 0x10, 0x00, 0, 0, 0]).buffer;
  ic.onMessage({ data: buf });
  ok(rumbles.length === 1 && rumbles[0].left === 0.5 && rumbles[0].lt === 0.8 && rumbles[0].durationMs === 16, 'rumble parsed');
  ok(delivered.length === 1 && delivered[0][6] === 0 && delivered[0][7] === 0 && delivered[0][4] === 50, 'trigger rumble zeroed for pad');
  // 7. helpers
  const m = buildMapping({ A: 'B' })!; ok(m.B === '0' && m.A === '99', 'remap A->B');
  const d = describeGamepad({ id: '37d7-2401-Flydigi APEX 6', index: 1 } as any); ok(d.isFlydigi && d.name === 'Flydigi APEX 6', 'flydigi linux id');
  const v = describeGamepad({ id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 2 } as any); ok(v.connection === 'unknown' && v.name.startsWith('Xbox 360'), 'xinput id');
  im.dispose();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
