// Tiny Electron app that exercises the platform layer on the real machine and prints JSON.
//   node tools/platform-test/run-probe.mjs            → info, switches, gpu, haptics, steam status (read-only)
//   XENITH_PROBE_MODE=fake-steam ...                  → shortcuts + artwork against a temp fake Steam root
import { app, BrowserWindow } from 'electron';
import { mkdtempSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, Settings } from '../../src/shared/api';
import { createPlatformLayer } from '../../src/main/platform/impl';

const mode = process.env.XENITH_PROBE_MODE || 'real';
const settings: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
if (process.env.XENITH_GPU_MODE) settings.advanced.gpuMode = process.env.XENITH_GPU_MODE as any;
if (process.env.XENITH_PIPELINE) settings.advanced.renderPipeline = process.env.XENITH_PIPELINE as any;

let fakeRoot = '';
if (mode === 'fake-steam') {
  fakeRoot = mkdtempSync(join(tmpdir(), 'xenith-fake-steam-'));
  mkdirSync(join(fakeRoot, 'userdata', '123456', 'config'), { recursive: true });
  process.env.XENITH_STEAM_ROOT = fakeRoot;
}

const p = createPlatformLayer({ getSettings: () => settings });
p.applyEarlySwitches(settings);

const out = (k: string, v: unknown) => console.log(`@@${k} ${JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))}`);

app.on('child-process-gone', (_e, d) => out('childGone', d));
app.on('gpu-info-update', () => out('gpuInfoUpdate', app.getGPUFeatureStatus().gpu_compositing));
app.whenReady().then(async () => {
  out('featureAtReady', app.getGPUFeatureStatus().gpu_compositing);
  try {
    out('commandLine', process.argv.slice(1).concat(['--enable-features=' + app.commandLine.getSwitchValue('enable-features')]));
    out('plan', p.lastSwitchPlan());
    out('info', p.info());
    out('deck', p.deck());
    if (mode === 'real') {
      // Make sure the GPU process is fully up (video decoder caps are filled after it initialises).
      const w = new BrowserWindow({ show: false, width: 320, height: 240 });
      await w.loadURL('data:text/html,<video></video>');
      const t0 = Date.now();
      out('gpu', await p.gpuStatus());
      out('gpuRawComplete', await app.getGPUInfo('complete'));
      out('haptics', await p.hapticsDiagnostics({ state: 'unknown', lastEventAt: null, last: null }, null));
      out('steamStatus', await p.steam.status());
      out('steamTitleIds', await p.steam.shortcutTitleIds());
      out('timingMs', Date.now() - t0);
      await new Promise((r) => setTimeout(r, 3000));
      out('featureAfter3s', app.getGPUFeatureStatus().gpu_compositing);
      w.destroy();
    } else {
      const title = { titleId: 'TEST_TITLE_ID', productId: '9TEST', name: 'Test Game', publisher: null,
        coverUrl: 'https://avatars.githubusercontent.com/u/9919?s=900', heroUrl: 'https://avatars.githubusercontent.com/u/9919?s=1200',
        supportsMouseKeyboard: false, inSteam: false };
      out('addLibrary', await p.steam.addLibraryShortcut());
      out('addCloud', await p.steam.addCloudShortcut(title));
      out('addCloudAgain', await p.steam.addCloudShortcut(title));
      out('status', await p.steam.status());
      out('titleIds', await p.steam.shortcutTitleIds());
      out('resync', await p.steam.resyncArtwork([title]));
      const grid = join(fakeRoot, 'userdata', '123456', 'config', 'grid');
      out('grid', readdirSync(grid).map((f) => `${f} ${statSync(join(grid, f)).size}`));
      out('fakeRoot', fakeRoot);
    }
  } catch (e: any) {
    out('error', String(e?.stack ?? e));
  }
  app.quit();
});
