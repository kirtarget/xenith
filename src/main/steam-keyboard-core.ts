import type { PlatformInfo } from '../shared/api';

export const STEAM_KEYBOARD_URI = 'steam://open/keyboard';

interface KeyboardDeps {
  platform(): Pick<PlatformInfo, 'os' | 'isSteamDeck' | 'isGamescope'>;
  steamRunning(): Promise<boolean>;
  openKeyboard(uri: string): Promise<void>;
}

export function createSteamKeyboard(deps: KeyboardDeps): () => Promise<boolean> {
  let pending: Promise<boolean> | null = null;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      try {
        const p = deps.platform();
        if (p.os !== 'linux' || !p.isSteamDeck || !p.isGamescope || !await deps.steamRunning()) return false;
        await deps.openKeyboard(STEAM_KEYBOARD_URI);
        return true;
      } catch {
        return false;
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}
