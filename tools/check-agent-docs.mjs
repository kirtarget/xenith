import { readFileSync } from 'node:fs';

const agents = readFileSync(new URL('../AGENTS.md', import.meta.url));
const claude = readFileSync(new URL('../CLAUDE.md', import.meta.url));
if (!agents.equals(claude)) {
  console.error('AGENTS.md and CLAUDE.md differ. Update both instruction files together.');
  process.exitCode = 1;
} else {
  console.log('AGENTS.md and CLAUDE.md are synchronized.');
}
