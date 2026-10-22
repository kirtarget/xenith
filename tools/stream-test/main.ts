// Stream-engine test harness (main process). Runs the REAL core (XenithCore + registerIpc from src/main, read-only)
// so sessions go through the production session manager, token cache and refresh mutex; adds only test plumbing
// (config / log / done on 'xenithTest:*') and process/GPU metrics. Never run two Xenith processes at once.
//
// Env:
//   XENITH_TEST_NAME      label for the log file
//   XENITH_TEST_SECONDS   auto-stop after N s of streaming (default 60, hard cap 660)
//   XENITH_TEST_SETTINGS  JSON DeepPartial<Settings> merged over DEFAULT_SETTINGS (also written to the harness's own
//                         settings file so core's play() uses the matching device dims; the user's settings.json is untouched)
//   XENITH_TEST_ACTIONS   JSON [{ "at": 30, "do": "apply", "settings": {...} } | { "at": 40, "do": "pcClose" | "iceRestart" | "keyframe" | "guide" }]
import { app, BrowserWindow, ipcMain, powerSaveBlocker } from 'electron';
import { join } from 'node:path';
import { mkdirSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { SettingsStore } from '../../src/main/settings';
import { XenithCore } from '../../src/main/core';
import { registerIpc } from '../../src/main/ipc';
import { onEvent } from '../../src/main/events';

app.setName('xenith');
app.setPath('userData', join(app.getPath('appData'), 'xenith')); // same store as the app (sign-in, token cache)
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const env = process.env;
const NAME = (env.XENITH_TEST_NAME || 'run').replace(/[^\w.-]/g, '_');
const SECONDS = Math.min(660, Number(env.XENITH_TEST_SECONDS || 60));
const SETTINGS = JSON.parse(env.XENITH_TEST_SETTINGS || '{}') || {};
const ACTIONS = JSON.parse(env.XENITH_TEST_ACTIONS || '[]') || [];

const logs = join(app.getPath('userData'), 'logs');
mkdirSync(logs, { recursive: true });
const logFile = join(logs, `stream-test-${NAME}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const log = (event: string, data?: unknown) => appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), event, data }) + '\n');

const settingsFile = join(logs, 'stream-test-settings.json');
rmSync(settingsFile, { force: true });
const settings = new SettingsStore(settingsFile);
settings.set(SETTINGS);
const core = new XenithCore(settings, { kind: null, targetId: null });

let win: BrowserWindow | null = null;
let finished = false;
const summary: any = { name: NAME, seconds: SECONDS, settings: SETTINGS, actions: ACTIONS, stages: [] };

registerIpc(core, () => win, { toggleFullscreen: () => false, setFullscreen: () => false, quit: () => void finish('renderer-quit') });
onEvent((ev: any) => {
  if (win && !win.isDestroyed()) win.webContents.send('xenith:event', ev);
  if (ev.type === 'stage' || ev.type === 'sessionError' || ev.type === 'sessionEnded') log('core.' + ev.type, ev);
});

ipcMain.handle('xenithTest:config', async () => {
  const consoles = await core.consoles(true);
  log('consoles', consoles);
  const c = consoles.find((x) => x.remotePlayReady) || consoles[0];
  return { name: NAME, seconds: SECONDS, settings: SETTINGS, actions: ACTIONS, serverId: c?.serverId ?? '', consoleName: c?.name ?? '', cloudTitle: env.XENITH_TEST_CLOUD || '' };
});
ipcMain.on('xenithTest:log', (_e, event: string, data: unknown) => {
  log(event, data);
  if (event === 'stage') summary.stages.push(data);
  if (event === 'result') summary.result = data;
});
ipcMain.on('xenithTest:done', () => void finish('renderer-done'));

let gpuSampling = false;
function sampleMetrics() {
  const m = app.getAppMetrics();
  log('metrics', m.map((p) => ({ type: p.type, pid: p.pid, cpu: Math.round(p.cpu.percentCPUUsage * 10) / 10, wsMB: Math.round((p.memory.workingSetSize || 0) / 1024), privMB: Math.round((p.memory.privateBytes || 0) / 1024) })));
  const gpu = m.find((p) => p.type === 'GPU');
  if (!gpu || gpuSampling || process.platform !== 'win32') return;
  gpuSampling = true;
  const ps = `$s=(Get-Counter '\\GPU Engine(pid_${gpu.pid}_*)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples; ` +
    `$g=@{}; foreach($x in $s){ $k=($x.InstanceName -replace '.*engtype_',''); $g[$k]=[math]::Round(($g[$k]+$x.CookedValue),2) }; $g | ConvertTo-Json -Compress`;
  execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000 }, (err, out) => {
    gpuSampling = false;
    if (!err) { try { log('gpu', { pid: gpu.pid, engines: JSON.parse(out.trim() || '{}') }); } catch { /* ignore */ } }
  });
}

async function finish(reason: string) {
  if (finished) return;
  finished = true;
  await Promise.race([core.sessions.stopAll('user'), new Promise((r) => setTimeout(r, 6000))]);
  summary.finishedAt = new Date().toISOString();
  summary.finishReason = reason;
  writeFileSync(logFile.replace(/\.jsonl$/, '.summary.json'), JSON.stringify(summary, null, 2));
  log('harness.exit', reason);
  app.quit();
}

app.whenReady().then(() => {
  powerSaveBlocker.start('prevent-display-sleep');
  log('app.ready', { electron: process.versions.electron, chrome: process.versions.chrome, name: NAME, seconds: SECONDS, settings: SETTINGS, actions: ACTIONS });
  win = new BrowserWindow({
    width: 1600, height: 900, backgroundColor: '#000000', show: false,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win?.showInactive()); // do not steal focus from whatever the user is doing
  win.webContents.on('render-process-gone', (_e, d) => { log('renderer.gone', d); void finish('renderer-gone'); });
  win.webContents.on('console-message', (e: any) => { const msg = String(e.message ?? ''); if (/error|uncaught/i.test(msg) && !/xStreamingPlayer/.test(msg)) log('renderer.console', msg.slice(0, 400)); });
  win.loadFile(join(__dirname, 'index.html'));
  setInterval(sampleMetrics, 5000);
  setTimeout(() => void finish('hard-timeout'), (SECONDS + 150) * 1000).unref?.();
});
app.on('window-all-closed', () => void finish('window-closed'));
