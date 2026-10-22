// Renders build/icon.svg → build/icon.png (1024 px), build/icons/<size>x<size>.png (Linux) and a multi-size
// build/icon.ico (16–48 as 32-bit BMP for NSIS/Explorer, 64–256 as PNG). Uses Electron offscreen rendering, no deps.
//   npx electron build/scripts/make-icons.js
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const svg = readFileSync(join(root, 'icon.svg'), 'utf8');
app.disableHardwareAcceleration();

async function render(size) {
  const win = new BrowserWindow({ show: false, width: size, height: size, useContentSize: true, frame: false, transparent: true,
    webPreferences: { offscreen: true, deviceScaleFactor: 1 } });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 200));
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  if (img.getSize().width !== size) img = img.resize({ width: size, height: size, quality: 'best' });
  return img;
}

function bmpEntry(img, size) {
  const bgra = img.toBitmap();                     // BGRA, top-down
  const rowBytes = size * 4, maskRow = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(0, 16);
  header.writeUInt32LE(rowBytes * size + maskRow * size, 20);
  const pixels = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) bgra.copy(pixels, (size - 1 - y) * rowBytes, y * rowBytes, (y + 1) * rowBytes);
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(({ size, data }, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, o); head.writeUInt8(size >= 256 ? 0 : size, o + 1);
    head.writeUInt8(0, o + 2); head.writeUInt8(0, o + 3); head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(data.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

app.whenReady().then(async () => {
  try {
    const big = await render(1024);
    writeFileSync(join(root, 'icon.png'), big.toPNG());
    mkdirSync(join(root, 'icons'), { recursive: true });
    for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) {
      const img = s === 1024 ? big : big.resize({ width: s, height: s, quality: 'best' });
      writeFileSync(join(root, 'icons', `${s}x${s}.png`), img.toPNG());
    }
    const entries = [];
    for (const s of [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
      const img = big.resize({ width: s, height: s, quality: 'best' });
      entries.push({ size: s, data: s <= 48 ? bmpEntry(img, s) : img.toPNG() });
    }
    writeFileSync(join(root, 'icon.ico'), ico(entries));
    console.log('icons written');
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.quit();
});
