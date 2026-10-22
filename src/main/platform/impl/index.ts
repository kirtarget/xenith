// Platform layer implementation. Usage (core, before app 'ready'):
//   import { createPlatformLayer } from './platform/impl';
//   import { setPlatformLayer, platform } from './platform';
//   setPlatformLayer(createPlatformLayer({ getSettings: () => settingsStore.get() }));
//   platform.applyEarlySwitches(settingsStore.get());   // synchronously, before app.whenReady()
import { app } from 'electron';
import type { PlatformInfo, Settings } from '../../../shared/api';
import type { PlatformLayer } from '../index';
import { DeckDetection, probeDeck } from './deck';
import { gpuStatus } from './gpu';
import { hapticsDiagnostics } from './haptics';
import { createSteam, SteamDeps } from './steam';
import { applySwitchPlan, planSwitches, SwitchPlan } from './switches';

export interface PlatformOptions extends SteamDeps {}

export type PlatformLayerExt = PlatformLayer & {
  deck(): DeckDetection;
  lastSwitchPlan(): SwitchPlan | null;
};

let cachedDeck: DeckDetection | null = null;
const deck = () => (cachedDeck ??= probeDeck());

export function applyEarlySwitches(settings: Settings): SwitchPlan {
  const plan = planSwitches(settings, process.platform, deck(), process.env);
  applySwitchPlan(app.commandLine, plan);
  return plan;
}

export function createPlatformLayer(opts: PlatformOptions = {}): PlatformLayerExt {
  let plan: SwitchPlan | null = null;
  const steam = createSteam(opts);
  return {
    applyEarlySwitches(settings) { plan = applyEarlySwitches(settings); },
    info(): PlatformInfo {
      const d = deck();
      return {
        os: process.platform as PlatformInfo['os'],
        isSteamDeck: d.isSteamDeck,
        isGamescope: d.isGamescope,
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
      };
    },
    gpuStatus,
    hapticsDiagnostics,
    steam,
    deck,
    lastSwitchPlan: () => plan,
  };
}

export { planSwitches } from './switches';
export { probeDeck } from './deck';
