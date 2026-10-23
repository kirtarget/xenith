// Gamepad-side features layered over the vendored input driver:
// View+Menu combos (overlay / Nexus), virtual Guide press, remap, controller list, rumble events.
import type { ControllerInfo, Settings } from '../../shared/api';
import type { RumbleEvent } from '../../shared/stream-controller';

export const OVERLAY_HOLD_MS = 600;
export const GUIDE_PULSE_MS = 150;
const VIEW = 8, MENU = 9;

/** Standard-gamepad button index per console button (W3C standard mapping; same as the vendored driver). */
export const BUTTON_INDEX: Record<string, number> = {
  A: 0, B: 1, X: 2, Y: 3, LeftShoulder: 4, RightShoulder: 5, LeftTrigger: 6, RightTrigger: 7,
  View: 8, Menu: 9, LeftThumb: 10, RightThumb: 11, DPadUp: 12, DPadDown: 13, DPadLeft: 14, DPadRight: 15, Nexus: 16,
};

/**
 * remap = { physical: consoleButton }, e.g. { A: 'B' } = the physical A button sends B.
 * A console button no physical button maps to any more is unbound. Returns null for the default layout.
 */
export function buildMapping(remap: Record<string, string>): Record<string, string> | null {
  const entries = Object.entries(remap || {}).filter(([from, to]) => from in BUTTON_INDEX && to in BUTTON_INDEX && from !== to);
  if (!entries.length) return null;
  const physToConsole: Record<string, string> = {};
  for (const b of Object.keys(BUTTON_INDEX)) physToConsole[b] = b;
  for (const [from, to] of entries) physToConsole[from] = to;
  const mapping: Record<string, string> = {};
  for (const target of Object.keys(BUTTON_INDEX)) {
    const src = Object.keys(physToConsole).find((p) => physToConsole[p] === target);
    mapping[target] = String(src !== undefined ? BUTTON_INDEX[src] : 99); // 99 = no such button -> 0
  }
  return mapping;
}

export function describeGamepad(gp: Gamepad): ControllerInfo {
  const id = gp.id || '';
  const win = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(id);
  const lin = /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(id);
  const vid = (win?.[1] || lin?.[1] || '').toLowerCase();
  const pid = (win?.[2] || lin?.[2] || '').toLowerCase();
  const name = (lin ? id.slice(10) : id.replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:.*\)\s*$/i, '').replace(/\s*\(STANDARD GAMEPAD\)\s*$/i, '')).trim() || 'Gamepad';
  const isFlydigi = /flydigi/i.test(id) || vid === '04b4' || vid === '37d7';
  const isDeck = /steam deck|valve/i.test(id) || vid === '28de';
  // Only "virtual" is derivable from the Gamepad API (ViGEm/Steam Input virtual pads); USB vs Bluetooth is not exposed.
  const virtual = /virtual|vigem/i.test(id) || (vid === '28de' && pid === '11ff');
  return { index: gp.index, id, name, connection: virtual ? 'virtual' : 'unknown', isFlydigi, isDeck };
}

export const HUD_TAP_MS = 600;
export const RESUME_GATE_MS = 2000;

export interface InputCallbacks {
  overlay(): void;
  hudToggle(): void;
  controllers(list: ControllerInfo[]): void;
  rumble(r: RumbleEvent): void;
}

export class InputManager {
  private comboActive = false;
  private comboStart = 0;
  private comboFired = false;
  private nexusUntil = 0;
  private guideCombo = true;
  private overlayCombo = true;
  private triggerRumble = true;
  private lastControllers = '';
  private paused = false;            // Xenith overlay open: UI owns the pads
  private resumeGateUntil = 0;       // after resume: neutral until every button is released (max RESUME_GATE_MS)
  private viewDownAt = 0;            // lone View tap -> hudToggle
  private viewSpoiled = false;
  private timer: number | null = null;
  private onPad = () => this.scan();

  constructor(private player: any, private cb: InputCallbacks) {}

  install() {
    const drv = this.player._inputDriver;
    const orig = drv.requestStates.bind(drv);
    // The vendored input tick only forwards requestStates()[0]; with several pads (BT pads, ViGEm/Virtual
    // Desktop virtual pads) that is often an idle device. Route the most recently used pad instead.
    drv.requestStates = () => { this.selectActivePad(); return this.filter(orig()); };
    const ic = this.player.getChannelProcessor('input');
    const origMsg = ic.onMessage.bind(ic);
    ic.onMessage = (ev: MessageEvent) => this.onInputMessage(ev, origMsg);
    window.addEventListener('gamepadconnected', this.onPad);
    window.addEventListener('gamepaddisconnected', this.onPad);
    this.timer = window.setInterval(() => this.scan(), 1000);
    this.scan();
  }

  /** Steam Deck: mouse/keyboard forwarded for this session regardless of the setting (trackpad mouse in cloud games). */
  autoMouseKeyboard = false;

  apply(s: Settings) {
    const c = s.controllers;
    const mkb = c.mouseKeyboard || this.autoMouseKeyboard;
    this.guideCombo = c.guideCombo;
    this.overlayCombo = c.overlayCombo;
    this.triggerRumble = c.triggerRumble;
    this.player._xenith_nexus_combo = false;      // vendored built-in View+Menu->Nexus is replaced by filter()
    this.player.setVibration(c.vibration);
    this.player.setGamepadDeadZone(Math.min(0.3, Math.max(0, c.deadZone)));
    this.player.setGamepadMaping(buildMapping(c.remap));
    this.player._config.input_mousekeyboard = mkb;
    if (!mkb && document.pointerLockElement) document.exitPointerLock();
  }

  /** Virtual Xbox button. Sent straight into the input channel queue, so it works without a physical
   *  pad and regardless of the overlay pause gate (which only filters polled pad states). */
  pressGuide() {
    const ch = this.player.getChannelProcessor?.('input');
    if (!ch?.pressButtonStart) { this.nexusUntil = performance.now() + GUIDE_PULSE_MS; return; }
    ch.pressButtonStart('Nexus');
    setTimeout(() => { try { ch.pressButtonEnd('Nexus'); } catch { /* channel closed */ } }, GUIDE_PULSE_MS);
  }

  /** Overlay open: forward only a neutral pad state. On close, stay neutral until all buttons are released
   *  (the button that closed the overlay must not reach the console). */
  setPaused(p: boolean) {
    if (p === this.paused) return;
    this.paused = p;
    this.comboActive = false; this.comboFired = false; this.viewDownAt = 0; this.nexusUntil = 0;
    if (!p) this.resumeGateUntil = performance.now() + RESUME_GATE_MS;
  }

  dispose() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('gamepadconnected', this.onPad);
    window.removeEventListener('gamepaddisconnected', this.onPad);
  }

  private activePad = -1;

  /** Picks the pad the player is actually using: the last one that showed input (button or stick past
   *  0.35). Sticky until another pad shows input. Before any input: the first non-virtual pad. */
  private selectActivePad() {
    const pads = navigator.getGamepads();
    let firstReal = -1;
    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (!gp || !gp.connected) continue;
      const virtualPad = /virtual/i.test(gp.id) && gp.axes.length !== 4;
      if (!virtualPad && firstReal < 0) firstReal = i;
      if (i === this.activePad) continue;
      const busy = gp.buttons.some((b) => b.pressed || b.value > 0.2) || gp.axes.some((a) => Math.abs(a) > 0.35);
      if (busy) { this.activePad = i; break; }
    }
    const cur = this.activePad >= 0 ? pads[this.activePad] : null;
    if (!cur || !cur.connected) this.activePad = firstReal;
    this.player._gamepad_index = this.activePad;
  }

  private raw() {
    let both = false, any = false, view = false, menu = false, anyButton = false;
    for (const gp of navigator.getGamepads()) {
      if (!gp || !gp.connected) continue;
      const v = !!gp.buttons[VIEW]?.pressed, m = !!gp.buttons[MENU]?.pressed;
      if (v && m) both = true;
      if (v || m) any = true;
      if (v) view = true;
      if (m) menu = true;
      if (gp.buttons.some((b) => b.pressed || b.value > 0.1)) anyButton = true;
    }
    return { both, any, view, menu, anyButton };
  }

  private neutral(states: any[]): any[] {
    const frame = this.player._inputDriver.getDefaultFamepadFrame();
    frame.GamepadIndex = 0;
    return states.length ? states.map(() => ({ ...frame })) : [frame];
  }

  /** Lone short View press (no Menu at any point, released < HUD_TAP_MS) -> hudToggle. View still reaches the console. */
  private trackViewTap(r: { view: boolean; menu: boolean }, now: number) {
    if (r.view && !this.viewDownAt) { this.viewDownAt = now; this.viewSpoiled = r.menu; }
    else if (this.viewDownAt) {
      if (r.menu) this.viewSpoiled = true;
      if (!r.view) {
        if (!this.viewSpoiled && now - this.viewDownAt < HUD_TAP_MS) setTimeout(() => this.cb.hudToggle(), 0);
        this.viewDownAt = 0;
      }
    }
  }

  /** Runs on every vendored input tick (250 Hz). Mutates the frames that go to the console. */
  private filter(states: any[]): any[] {
    const now = performance.now();
    const r = this.raw();
    if (this.paused) return this.neutral(states);
    if (this.resumeGateUntil) {
      if (r.anyButton && now < this.resumeGateUntil) return this.neutral(states);
      this.resumeGateUntil = 0;
    }
    this.trackViewTap(r, now);
    let nexus = now < this.nexusUntil;
    if (this.guideCombo || this.overlayCombo) {
      if (!this.comboActive && r.both) { this.comboActive = true; this.comboStart = now; this.comboFired = false; }
      if (this.comboActive) {
        const held = now - this.comboStart;
        if (r.any) {
          // Swallow View and Menu until both are released, so a staggered release never leaks a lone press.
          for (const st of states) { st.View = 0; st.Menu = 0; }
          if (this.overlayCombo && !this.comboFired && r.both && held >= OVERLAY_HOLD_MS) {
            this.comboFired = true;
            setTimeout(() => this.cb.overlay(), 0);
          }
          if (this.guideCombo && !this.overlayCombo) nexus = true; // guide-only: Nexus while held
        } else {
          this.comboActive = false;
          if (this.guideCombo && this.overlayCombo && !this.comboFired && held < OVERLAY_HOLD_MS) {
            this.nexusUntil = now + GUIDE_PULSE_MS;
            nexus = true;
          }
        }
      }
    }
    if (nexus) {
      if (!states.length) states.push(this.player._inputDriver.getDefaultFamepadFrame());
      for (const st of states) st.Nexus = 1;
    }
    return states;
  }

  private onInputMessage(ev: MessageEvent, orig: (e: any) => void) {
    try {
      const data = ev.data as ArrayBuffer;
      const dv = new DataView(data);
      if (dv.byteLength >= 13 && dv.getUint8(0) === 128) {
        // Vibration report: [0]=128 [1]=? [2]=rumbleType [3]=gamepadIndex [4..7]=L,R,LT,RT % [8..9]=duration u16le [10..11]=delay [12]=repeat
        const lt = dv.getUint8(6) / 100, rt = dv.getUint8(7) / 100;
        this.cb.rumble({ at: Date.now(), left: dv.getUint8(4) / 100, right: dv.getUint8(5) / 100, lt, rt, durationMs: dv.getUint16(8, true) });
        if (!this.triggerRumble && (lt > 0 || rt > 0)) {
          const copy = data.slice(0);
          const u = new Uint8Array(copy); u[6] = 0; u[7] = 0;
          return orig({ data: copy });
        }
      }
    } catch { /* fall through to vendored handler */ }
    return orig(ev);
  }

  private scan() {
    const list = Array.from(navigator.getGamepads()).filter((g): g is Gamepad => !!g && g.connected).map(describeGamepad);
    const key = JSON.stringify(list);
    if (key !== this.lastControllers) { this.lastControllers = key; this.cb.controllers(list); }
  }
}
