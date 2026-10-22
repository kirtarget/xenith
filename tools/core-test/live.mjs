// Builds and runs tools/core-test/live-check.ts in Electron (read-only endpoints only, no /play).
// Usage: node tools/core-test/live.mjs [--device-code]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

await build({ entryPoints: ['tools/core-test/live-check.ts'], outfile: 'dist-test/live-check.js', bundle: true, platform: 'node', format: 'cjs', target: 'es2022', external: ['electron'], logLevel: 'warning' });
const electron = createRequire(import.meta.url)('electron'); // path to the Electron binary
const r = spawnSync(electron, ['dist-test/live-check.js', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } });
process.exit(r.status ?? 1);
