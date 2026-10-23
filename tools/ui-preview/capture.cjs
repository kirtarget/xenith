// ⚠ PREVIEW ONLY — Electron main that loads the fixture build and saves PNGs of every scenario.
// node_modules\electron\dist\electron.exe tools/ui-preview/capture.cjs [--only=home,cloud] [--sizes=1440x900,deck] [--dsf=1] [--out=DIR]
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const dsf = Number(arg('dsf', '1'));
const lang = arg('lang', '');
const check = process.argv.includes('--check');
if (lang && !['en', 'ru'].includes(lang)) throw new Error('Expected --lang=en or --lang=ru');
app.commandLine.appendSwitch('force-device-scale-factor', String(dsf));
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const OUT = resolve(arg('out', require('path').join(__dirname, '..', '..', '.ui-shots')));
const PAGE = join(__dirname, 'dist', 'index.html');

// [name, query]
const SCENARIOS = [
  ['home', 's=home'],
  ['home-gamepad', 's=home&input=gamepad'],
  ['home-loading', 's=home-loading'],
  ['home-empty', 's=home-empty'],
  ['home-new', 's=home-new'],
  ['home-two', 's=home-two'],
  ['home-error', 's=home-error'],
  ['home-busy', 's=home-busy'],
  ['connecting', 's=connecting'],
  ['connecting-cloud', 's=connecting-cloud'],
  ['conn-error', 's=conn-error'],
  ['stream', 's=stream&input=gamepad'],
  ['stream-hud', 's=stream-hud'],
  ['stream-lost', 's=stream-lost'],
  ['cloud', 's=cloud'],
  ['cloud-sheet', 's=cloud-sheet&input=gamepad'],
  ['cloud-search', 's=cloud-search'],
  ['cloud-keyboard', 's=cloud-keyboard'],
  ['cloud-none', 's=cloud-none'],
  ['cloud-loading', 's=cloud-loading'],
  ['login', 's=login'],
  ['login-expired', 's=login-expired'],
  ['account', 's=account'],
  ...['streaming', 'video', 'audio', 'controllers', 'haptics', 'network', 'steam', 'ui', 'advanced'].map(sec => [`settings-${sec}`, `s=settings&sec=${sec}`]),
  ['settings-reset', 's=settings-reset&sec=advanced'],
  ['settings-steam-actions', 's=settings-steam-actions&sec=steam'],
  ['stream-resume', 's=stream-resume'],
  ['stream-resume-cancel', 's=stream-resume-cancel'],
  ['stream-aspect-home', 's=stream-aspect-home'],
  ['stream-aspect-cloud', 's=stream-aspect-cloud'],
  ['settings-select', 's=settings-select&sec=audio'],
  ['home-en', 's=home&lang=en'],
  ['home-scale-xl', 's=home&scale=xl'],
];
const SIZES = {
  '1440x900': { w: 1440, h: 900, q: '' },
  '1920x1080': { w: 1920, h: 1080, q: '' },
  '2560x1440': { w: 2560, h: 1440, q: '' },
  deck: { w: 1280, h: 800, q: '&deck=1' },
};

const only = arg('only', '').split(',').filter(Boolean);
const sizes = arg('sizes', Object.keys(SIZES).join(',')).split(',').filter(k => SIZES[k]);

async function shot(name, size, query) {
  const { w, h, q } = SIZES[size];
  // Offscreen rendering: arbitrary sizes regardless of the physical screen, no window on the desktop.
  const win = new BrowserWindow({
    width: w, height: h, useContentSize: true, show: false, frame: false, backgroundColor: '#0B1018',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, zoomFactor: 1 },
  });
  win.webContents.setFrameRate(30);
  win.webContents.on('console-message', (e) => { const m = e.message ?? ''; if (/error/i.test(String(e.level)) || /Error/.test(m)) console.log('[renderer]', name, m); });
  try {
  const params = new URLSearchParams(`${query}${q}`);
  if (lang) params.set('lang', lang);
  await win.loadURL(`file:///${PAGE.replace(/\\/g, '/')}?${params}`);
  win.webContents.focus();
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if (await win.webContents.executeJavaScript('window.__previewReady === true').catch(() => false)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 250));
  if (check) {
    const state = await win.webContents.executeJavaScript(`({
      ready: window.__previewReady === true,
      lang: document.documentElement.lang,
      text: document.body.innerText,
      clipped: [...document.querySelectorAll('button, h1, h2, h3')]
        .filter(el => el.innerText.trim() && !el.closest('.sr-only') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2)
        .map(el => el.innerText)
    })`);
    const expectedLang = params.get('lang') === 'en' ? 'en' : 'ru';
    if (!state.ready || state.lang !== expectedLang || !state.text.trim()) {
      throw new Error(`Invalid rendered page: ready=${state.ready}, lang=${state.lang}, expected=${expectedLang}`);
    }
    if (expectedLang === 'en') {
      // The language selector and actual OS audio device names can contain Cyrillic.
      const uiText = state.text
        .replace(/Русский|Динамики|Наушники/g, '');
      if (/[А-Яа-яЁё]/.test(uiText)) throw new Error(`Russian UI text: ${uiText.match(/[^\n]*[А-Яа-яЁё][^\n]*/g)?.join('; ')}`);
    }
    if (state.clipped.length) throw new Error(`Clipped labels: ${state.clipped.join('; ')}`);
    console.log('[check]', name, size, state.lang, 'PASS');
  }
  if (process.argv.includes('--probe')) console.log('[probe]', name, await win.webContents.executeJavaScript("JSON.stringify({ae:(document.activeElement||{}).outerHTML?.slice(0,140), focus:document.hasFocus(), input:document.documentElement.dataset.input, marked:document.querySelectorAll('[data-focused]').length})").catch(e => String(e)));
  const img = await win.webContents.capturePage();
  const suffix = dsf !== 1 ? `@${dsf}x` : '';
  const file = join(OUT, `${size}${suffix}`, `${name}.png`);
  writeFileSync(file, img.toPNG());
  return file;
  } finally { win.destroy(); }
}

app.on('window-all-closed', () => { /* keep running between shots */ });
app.whenReady().then(async () => {
  const done = [];
  for (const size of sizes) {
    mkdirSync(join(OUT, `${size}${dsf !== 1 ? `@${dsf}x` : ''}`), { recursive: true });
    for (const [name, query] of SCENARIOS) {
      if (only.length && !only.includes(name)) continue;
      try { done.push(await shot(name, size, query)); } catch (e) { console.log('FAIL', size, name, e && e.message); process.exitCode = 1; }
    }
  }
  console.log(`captured ${done.length} → ${OUT}`);
  app.exit(process.exitCode ?? 0);
});
