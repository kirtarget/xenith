import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import electron from 'electron';

const outfile = 'dist-test/steam-smoke.cjs';
await build({ entryPoints: ['tools/platform-test/steam-smoke.ts'], outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'warning' });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, [outfile], { env, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
