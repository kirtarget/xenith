// Xenith main process bootstrap.
import { app, BrowserWindow, Menu, powerSaveBlocker } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platform, setPlatformLayer } from './platform';
import { createPlatformLayer } from './platform/impl';
import { SettingsStore } from './settings';
import { parseLaunchArgs } from './args';
import { XenithCore } from './core';
import { registerIpc } from './ipc';
import { onEvent, emit } from './events';
import { log, logWarn } from './log';
import { withTimeout } from './util';
import { tagSteamGameWindow } from './steam-window';
import { registerPowerEvents } from './power-events';

// Fixed userData (<appData>/xenith) regardless of productName / dev vs packaged: the secure token
// store lives in <userData>/secure and must stay where existing sign-ins put it.
app.setPath('userData', join(app.getPath('appData'), 'xenith'));

// Low-latency renderer: never throttle the streaming window.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Launched by the Steam client on Linux (Steam Deck): the Chromium sandbox/zygote fails under Steam's launcher
// (GPU process launch failed: error_code=1002). Shortcuts pass --no-sandbox; this covers hand-made shortcuts.
if (process.platform === 'linux' && (process.env.SteamAppId || process.env.SteamGameId) && !process.argv.includes('--no-sandbox')) {
  app.commandLine.appendSwitch('no-sandbox');
}

const settings = new SettingsStore(); // synchronous read, before 'ready'
setPlatformLayer(createPlatformLayer({ getSettings: () => settings.get() }) as any);
try { platform.applyEarlySwitches(settings.get()); } catch (e) { logWarn('platform.early_switches_failed', e); }

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap() {
  let win: BrowserWindow | null = null;
  let blocker: number | null = null;
  let quitting = false;
  let stopPowerEvents: (() => void) | null = null;

  const core = new XenithCore(settings, parseLaunchArgs(process.argv), (active) => {
    // keep the display awake only while streaming
    if (active > 0 && blocker === null) blocker = powerSaveBlocker.start('prevent-display-sleep');
    if (active === 0 && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
  });
  log('app.start', { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, os: process.platform, intent: core.intent });

  onEvent((ev) => {
    if (win && !win.isDestroyed()) win.webContents.send('xenith:event', ev);
  });

  const toggleFullscreen = () => { if (!win) return false; win.setFullScreen(!win.isFullScreen()); return win.isFullScreen(); };
  const setFullscreen = (on: boolean) => { if (!win) return false; win.setFullScreen(on); return on; };

  const quit = async () => {
    if (quitting) return;
    quitting = true;
    stopPowerEvents?.();
    await withTimeout(core.sessions.stopAll('user'), 6000);
    app.quit();
  };

  registerIpc(core, () => win, { toggleFullscreen, setFullscreen, quit: () => void quit() });

  app.on('second-instance', (_e, argv) => {
    const intent = parseLaunchArgs(argv);
    log('app.second_instance', { intent });
    if (intent.kind) core.setIntent(intent);
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });

  function createWindow() {
    const s = settings.get();
    win = new BrowserWindow({
      width: 1440, height: 900, minWidth: 1024, minHeight: 640,
      backgroundColor: '#0B1018', show: false, autoHideMenuBar: true,
      fullscreen: s.ui.startFullscreen,
      title: 'Xenith',
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, spellcheck: false,
        devTools: !app.isPackaged || process.env.XENITH_DEVTOOLS === '1',
      },
    });
    const w = win;
    w.once('ready-to-show', () => { w.show(); tagSteamGameWindow(w); });

    // Window-level shortcuts (only while Xenith is focused).
    w.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return;
      if (input.key === 'F11' || input.key === 'F10') {
        event.preventDefault();
        toggleFullscreen(); // applied here; the event is informational for the UI
        emit({ type: 'menu', action: 'toggle-fullscreen' });
      } else if (input.key === 'F1') {
        event.preventDefault();
        emit({ type: 'menu', action: 'toggle-overlay' });
      } else if (input.key === 'F2') {
        event.preventDefault();
        emit({ type: 'menu', action: 'press-guide' });
      } else if (input.key === 'Escape') {
        emit({ type: 'menu', action: 'toggle-overlay' }); // not prevented: dialogs may still use Esc
      } else if (input.key === 'I' && input.control && input.shift && (!app.isPackaged || process.env.XENITH_DEVTOOLS === '1')) {
        w.webContents.toggleDevTools();
      }
    });

    // No navigation away from the app, no popups.
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });

    w.on('close', (e) => {
      if (quitting || core.sessions.activeCount() === 0) return;
      e.preventDefault();
      void quit();
    });
    w.on('closed', () => { win = null; });

    const html = process.env.XENITH_RENDERER_HTML ? resolve(process.env.XENITH_RENDERER_HTML) : join(__dirname, 'renderer', 'index.html');
    const selftest = process.env.XENITH_CORE_SELFTEST === '1';
    if (selftest) w.webContents.on('console-message', (e: any) => log('renderer.console', String(e?.message ?? '').slice(0, 1000)));
    if (existsSync(html)) void w.loadFile(html, selftest ? { query: { selftest: '1' } } : undefined);
    else {
      logWarn('renderer.missing', { html });
      void w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#0B1018;color:#9fb0c8;font:16px system-ui;padding:32px">Xenith: renderer bundle not found (dist/renderer/index.html). Run <code>node build.mjs</code>.</body>'));
    }
  }

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    stopPowerEvents = registerPowerEvents(state => emit({ type: 'power', state }), () => core.sessions.stopAll('replaced'));
    createWindow();
  });

  app.on('before-quit', (e) => {
    if (quitting || core.sessions.activeCount() === 0) return;
    e.preventDefault();
    void quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') void quit(); });
  app.on('activate', () => { if (!win && app.isReady()) createWindow(); });
}
