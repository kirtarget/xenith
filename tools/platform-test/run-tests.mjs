// node tools/platform-test/run-tests.mjs — bundles tests/*.test.ts with esbuild and runs them with node:test.
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = 'tools/platform-test/tests';
const entries = readdirSync(dir).filter((f) => f.endsWith('.test.ts')).map((f) => `${dir}/${f}`);
await build({ entryPoints: entries, outdir: 'dist/platform-test/tests', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning', external: ['electron'] });
const files = readdirSync('dist/platform-test/tests').filter((f) => f.endsWith('.test.mjs')).map((f) => `dist/platform-test/tests/${f}`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
