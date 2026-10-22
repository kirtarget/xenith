// Core unit tests: bundles tools/core-test/*.test.ts with esbuild, runs them with node:test.
// Usage: node tools/core-test/run.mjs
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = 'tools/core-test';
const out = 'dist-test/core';
rmSync(out, { recursive: true, force: true });
const entries = readdirSync(dir).filter((f) => f.endsWith('.test.ts')).map((f) => join(dir, f));
await build({ entryPoints: entries, outdir: out, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning', sourcemap: 'inline' });
const files = readdirSync(out).filter((f) => f.endsWith('.test.js')).map((f) => join(out, f));
const r = spawnSync(process.execPath, ['--enable-source-maps', '--test', '--test-reporter=spec', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
