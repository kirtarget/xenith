import { build } from 'esbuild';
import { cpSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../dist-test/fsr-fit');
const baseline = process.argv.includes('--baseline');

if (!process.versions.electron) {
  const plugins = baseline ? [{
    name: 'old-fsr-fit-behavior',
    setup(builder) {
      builder.onLoad({ filter: /postprocess\.ts$/ }, args => ({
        contents: readFileSync(args.path, 'utf8')
          .replace("    if (this.mode === 'fsr' && this.cfg?.fit !== cfg.fit) this.teardownMode();", '')
          .replace("m !== this.mode || (resized && m === 'fsr')", 'm !== this.mode'),
        loader: 'ts',
      }));
      builder.onLoad({ filter: /Component[\\/]Video\.ts$/ }, args => {
        const text = readFileSync(args.path, 'utf8');
        const start = text.indexOf('    startFSR(');
        return {
          contents: text.slice(0, start) + text.slice(start).replaceAll("if (video_format === 'Stretch')", "if (video_format === 'Stretch' || video_format === 'Zoom')"),
          loader: 'ts',
        };
      });
    },
  }] : [];
  await build({ entryPoints: [join(here, 'fsr-fit-entry.ts')], outfile: join(out, 'fsr-fit-entry.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'warning', plugins });
  cpSync(join(here, 'fsr-fit.html'), join(out, 'index.html'));
  const electron = (await import('electron')).default;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [fileURLToPath(import.meta.url)], { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} else {
  const { app, BrowserWindow } = await import('electron');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  void app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 1100, height: 700, show: false, webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.webContents.on('console-message', event => {
      if (/error/i.test(String(event.level)) || /Error|shader error/i.test(event.message)) console.error('[FSR renderer]', event.message);
    });
    try {
      await Promise.race([window.loadFile(join(out, 'index.html')), new Promise((_, reject) => setTimeout(() => reject(new Error('FSR page load timed out')), 10000))]);
      const deadline = Date.now() + 20000;
      let result;
      while (Date.now() < deadline) {
        result = await window.webContents.executeJavaScript('window.__fsrResult');
        if (result) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!result || result.status !== 'passed') throw new Error(result?.error ?? 'FSR check timed out');
      for (const check of result.checks) console.log('PASS', check);
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  }).catch(error => { console.error(error); app.exit(1); });
}
