import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist', 'input.test.cjs');
await build({ entryPoints: [join(here, 'input.test.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' });
execFileSync(process.execPath, [out], { stdio: 'inherit' });
