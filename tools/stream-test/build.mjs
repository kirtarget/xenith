// node tools/stream-test/build.mjs  ->  tools/stream-test/dist (run: electron tools/stream-test/dist)
import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
mkdirSync(out, { recursive: true });
const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'es2022' };
await build({ ...common, entryPoints: [join(here, 'main.ts')], outfile: join(out, 'main.js'), platform: 'node', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: [join(here, 'preload.ts')], outfile: join(out, 'preload.js'), platform: 'node', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: [join(here, 'page.ts')], outfile: join(out, 'page.js'), platform: 'browser', format: 'iife' });
cpSync(join(here, 'index.html'), join(out, 'index.html'));
// App name must stay "xenith" so the harness reuses %APPDATA%\xenith (stored sign-in).
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'xenith', main: 'main.js', private: true }, null, 2));
console.log('stream-test built ->', out);
