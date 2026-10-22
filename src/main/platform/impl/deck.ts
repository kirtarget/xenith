// Steam Deck / SteamOS gaming-mode (gamescope) detection. Pure: takes env + a file reader so tests can use fixtures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DeckProbeInput {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** Reads a file below the filesystem root; returns null when missing. */
  readFile: (absPath: string) => string | null;
}

export interface DeckDetection {
  isSteamDeck: boolean;
  model: 'lcd' | 'oled' | null;       // Jupiter = LCD (2022), Galileo = OLED (2023)
  isGamescope: boolean;               // running inside gamescope (SteamOS gaming mode / gamescope session)
  isSteamOS: boolean;
  isWayland: boolean;                 // a regular Wayland desktop session (not gamescope)
  reasons: string[];
}

const DMI = '/sys/devices/virtual/dmi/id';

export function detectDeck(input: DeckProbeInput): DeckDetection {
  const { env, platform } = input;
  const reasons: string[] = [];
  let isSteamDeck = false;
  let model: DeckDetection['model'] = null;
  if (platform === 'linux') {
    const vendor = (input.readFile(`${DMI}/board_vendor`) ?? input.readFile(`${DMI}/sys_vendor`) ?? '').trim();
    const product = (input.readFile(`${DMI}/product_name`) ?? input.readFile(`${DMI}/board_name`) ?? '').trim();
    if (/^valve$/i.test(vendor) && /^(jupiter|galileo)$/i.test(product)) {
      isSteamDeck = true;
      model = /galileo/i.test(product) ? 'oled' : 'lcd';
      reasons.push(`dmi:${vendor}/${product}`);
    } else if (env.SteamDeck === '1') {
      isSteamDeck = true;              // set by Steam on Deck hardware for launched apps
      reasons.push('env:SteamDeck=1');
    }
  }
  const isGamescope = platform === 'linux' && (
    !!env.GAMESCOPE_WAYLAND_DISPLAY || /gamescope/i.test(env.XDG_CURRENT_DESKTOP ?? '') ||
    /gamescope/i.test(env.XDG_SESSION_DESKTOP ?? '') || env.SteamGamepadUI === '1' && !!env.GAMESCOPE_DISPLAY_ID
  );
  if (isGamescope) reasons.push('env:gamescope');
  const osRelease = platform === 'linux' ? input.readFile('/etc/os-release') ?? '' : '';
  const isSteamOS = /^ID=steamos$/m.test(osRelease) || env.SteamOS === '1';
  if (isSteamOS) reasons.push('steamos');
  const isWayland = platform === 'linux' && !isGamescope && (!!env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland');
  return { isSteamDeck, model, isGamescope, isSteamOS, isWayland, reasons };
}

/** Real-system probe; `root` lets tests point at a fixture tree. */
export function probeDeck(root = '/', env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): DeckDetection {
  return detectDeck({
    platform, env,
    readFile: (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return null; } },
  });
}
