// Preload: exposes the complete typed XenithApi (+ core extras) as window.xenith. Sandboxed; only 'electron' is required.
import { contextBridge, ipcRenderer } from 'electron';
import type { XenithEvent } from '../shared/api';
import type { XenithApiFull } from '../shared/core-additions';

const invoke = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`xenith:${name}`, ...args);
const send = (name: string, ...args: unknown[]) => ipcRenderer.send(`xenith:${name}`, ...args);

const api: XenithApiFull = {
  platform: () => invoke('platform'),
  launchIntent: () => invoke('launchIntent'),

  settingsGet: () => invoke('settingsGet'),
  settingsSet: (patch) => invoke('settingsSet', patch),
  settingsReset: () => invoke('settingsReset'),
  resetAllData: () => invoke('resetAllData'),

  account: () => invoke('account'),
  loginStart: () => invoke('loginStart'),
  loginCancel: () => invoke('loginCancel'),
  signOut: () => invoke('signOut'),

  consoles: (refresh) => invoke('consoles', !!refresh),
  cloudTitles: (refresh) => invoke('cloudTitles', !!refresh),
  regions: () => invoke('regions'),

  history: () => invoke('history'),
  historyClear: () => invoke('historyClear'),

  sessionStart: (kind, targetId) => invoke('sessionStart', kind, targetId),
  sessionSdp: (sessionId, offerSdp) => invoke('sessionSdp', sessionId, offerSdp),
  sessionIce: (sessionId, local) => invoke('sessionIce', sessionId, local),
  sessionStop: (sessionId, reason) => invoke('sessionStop', sessionId, reason),
  sessionReport: (sessionId, stats) => send('sessionReport', sessionId, stats),
  sessionStage: (sessionId, ev) => send('sessionStage', sessionId, ev),

  steamStatus: () => invoke('steamStatus'),
  steamAddLibraryShortcut: () => invoke('steamAddLibraryShortcut'),
  steamAddConsoleShortcut: (serverId) => invoke('steamAddConsoleShortcut', serverId),
  steamInstallDeckLayout: () => invoke('steamInstallDeckLayout'),
  steamAddCloudShortcut: (titleId) => invoke('steamAddCloudShortcut', titleId),
  steamResyncArtwork: () => invoke('steamResyncArtwork'),

  hapticsDiagnostics: () => invoke('hapticsDiagnostics'),
  gpuStatus: () => invoke('gpuStatus'),
  audioOutputs: () => invoke('audioOutputs'),
  showSteamKeyboard: () => invoke('showSteamKeyboard'),

  window: {
    toggleFullscreen: () => invoke('window.toggleFullscreen'),
    setFullscreen: (on) => invoke('window.setFullscreen', !!on),
    minimize: () => invoke('window.minimize'),
    quit: () => invoke('window.quit'),
  },
  openExternal: (url) => invoke('openExternal', url),
  copyText: (text) => invoke('copyText', text),
  exportLogs: () => invoke('exportLogs'),

  reportAudioOutputs: (list) => send('reportAudioOutputs', list),
  reportRumble: (r) => send('reportRumble', r),

  on: (listener) => {
    const h = (_e: Electron.IpcRendererEvent, ev: XenithEvent) => { try { listener(ev); } catch (err) { console.error(err); } };
    ipcRenderer.on('xenith:event', h);
    return () => { ipcRenderer.removeListener('xenith:event', h); };
  },
};

contextBridge.exposeInMainWorld('xenith', api);
