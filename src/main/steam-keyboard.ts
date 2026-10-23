import { shell } from 'electron';
import { platform } from './platform';
import { processNames } from './platform/impl/sys';
import { createSteamKeyboard } from './steam-keyboard-core';

export const showSteamKeyboard = createSteamKeyboard({
  platform: () => platform.info(),
  steamRunning: async () => (await processNames()).some(name => name === 'steam' || name === 'steamwebhelper'),
  openKeyboard: uri => shell.openExternal(uri),
});
