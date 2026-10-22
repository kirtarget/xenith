// Bundles probe-main.ts and runs it with the repo's Electron. Prints the @@-prefixed JSON lines.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const outfile = 'dist/platform-test/probe-main.js';
await build({ entryPoints: ['tools/platform-test/probe-main.ts'], outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'es2022', logLevel: 'warning' });
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [outfile, ...process.argv.slice(2)], { env, encoding: 'utf8', timeout: 120000 });
for (const line of (r.stdout || '').split(/\r?\n/)) if (line.startsWith('@@')) console.log(line.slice(2));
if (process.env.XENITH_PROBE_STDERR) for (const l of (r.stderr || '').split(/\r?\n/)) if (l.trim()) console.log('stderr ' + l);
if (r.status !== 0) console.error('exit', r.status, (r.stderr || '').slice(-2000));
