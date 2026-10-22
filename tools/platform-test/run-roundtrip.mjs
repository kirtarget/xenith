import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tools/platform-test/real-roundtrip.ts'], outfile: 'dist/platform-test/real-roundtrip.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning' });
const r = spawnSync(process.execPath, ['dist/platform-test/real-roundtrip.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);