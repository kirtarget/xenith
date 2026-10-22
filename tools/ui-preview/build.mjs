// ⚠ PREVIEW ONLY: bundles the renderer with fakes. `node tools/ui-preview/build.mjs`
// The alias swaps src/renderer/stream/index (STREAM agent) for ./fake-stream.ts.
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'dist');
mkdirSync(out, { recursive: true });

const fakeStream = {
  name: 'fake-stream',
  setup(b) {
    b.onResolve({ filter: /^\.\/stream\/index$/ }, args => {
      if (/stream-adapter\.ts$/.test(args.importer)) return { path: resolve(here, 'fake-stream.ts') };
      return undefined;
    });
  },
};

await build({
  entryPoints: { preview: resolve(here, 'preview-entry.tsx') },
  outdir: out,
  bundle: true, sourcemap: true, target: 'es2022', platform: 'browser', format: 'iife', logLevel: 'info',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.woff2': 'file', '.woff': 'file', '.png': 'file', '.svg': 'file' },
  assetNames: 'assets/[name]-[hash]',
  plugins: [fakeStream],
});
cpSync(resolve(here, 'index.html'), resolve(out, 'index.html'));
