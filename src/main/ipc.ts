// IPC: every XenithApi method is ipcMain.handle('xenith:<name>') (nested window.* → 'xenith:window.<name>');
// fire-and-forget methods use ipcMain.on. Events go out on 'xenith:event' (see main.ts).
// Only the main window's top frame may call in.
import { BrowserWindow, clipboard, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { XenithApi } from '../shared/api';
import type { XenithCoreExtras } from '../shared/core-additions';
import type { XenithCore } from './core';
import { AuthError } from './xbox-auth';
import { GssvError } from './xhome-api';
import { ipcError, SessionFail, toSessionError } from './errors';
import { logWarn } from './log';

type Invokable = Exclude<keyof XenithApi, 'on' | 'window' | 'sessionReport' | 'sessionStage'>;
type WindowMethod = keyof XenithApi['window'];

const ALLOWED_EXTERNAL = [/^https:\/\/www\.microsoft\.com\/link\/?(\?.*)?$/i, /^https:\/\/(www\.)?flydigi\.com\//i];
export const isAllowedExternal = (url: unknown) => typeof url === 'string' && url.length < 2048 && ALLOWED_EXTERNAL.some((r) => r.test(url));

export function registerIpc(core: XenithCore, getWindow: () => BrowserWindow | null, actions: { toggleFullscreen(): boolean; setFullscreen(on: boolean): boolean; quit(): void }) {
  const trusted = (e: IpcMainInvokeEvent | IpcMainEvent) => {
    const w = getWindow();
    return !!w && e.sender === w.webContents && (!e.senderFrame || e.senderFrame === w.webContents.mainFrame);
  };

  const handle = (name: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(`xenith:${name}`, async (e, ...args) => {
      if (!trusted(e)) throw new Error('forbidden');
      try { return await fn(...args); }
      catch (err) {
        if (err instanceof AuthError || err instanceof GssvError || err instanceof SessionFail) {
          const se = toSessionError(err);
          logWarn('ipc.error', { name, ...se });
          throw ipcError(se);
        }
        logWarn('ipc.error', { name, error: err });
        throw err;
      }
    });
  };
  const on = (name: string, fn: (...args: any[]) => void) => {
    ipcMain.on(`xenith:${name}`, (e, ...args) => { if (!trusted(e)) return; try { fn(...args); } catch (err) { logWarn('ipc.error', { name, error: err }); } });
  };

  const methods: Record<Invokable, (...args: any[]) => unknown> = {
    platform: () => core.platformInfo(),
    launchIntent: () => core.launchIntent(),
    settingsGet: () => core.settingsGet(),
    settingsSet: (patch) => core.settingsSet(patch),
    settingsReset: () => core.settingsReset(),
    resetAllData: () => core.resetAllData(),
    account: () => core.account(),
    loginStart: () => core.loginStart(),
    loginCancel: () => core.loginCancel(),
    signOut: () => core.signOut(),
    consoles: (refresh) => core.consoles(!!refresh),
    cloudTitles: (refresh) => core.cloudTitles(!!refresh),
    regions: () => core.regions(),
    history: () => core.historyList(),
    historyClear: () => core.historyClear(),
    sessionStart: (kind, targetId) => core.sessionStart(kind, targetId),
    sessionSdp: (id, offer) => core.sessionSdp(id, offer),
    sessionIce: (id, local) => core.sessionIce(id, local),
    sessionStop: (id, reason) => core.sessionStop(id, reason),
    steamStatus: () => core.steamStatus(),
    steamAddLibraryShortcut: () => core.steamAddLibraryShortcut(),
    steamAddCloudShortcut: (titleId) => core.steamAddCloudShortcut(String(titleId)),
    steamResyncArtwork: () => core.steamResyncArtwork(),
    hapticsDiagnostics: () => core.hapticsDiagnostics(),
    gpuStatus: () => core.gpuStatus(),
    audioOutputs: () => core.audioOutputs(),
    openExternal: async (url) => {
      if (!isAllowedExternal(url)) throw new Error('URL not allowed');
      await shell.openExternal(url);
    },
    copyText: (text) => { clipboard.writeText(String(text ?? '').slice(0, 10_000)); },
    exportLogs: () => core.exportLogs(),
  };
  for (const [name, fn] of Object.entries(methods)) handle(name, fn);

  const win: Record<WindowMethod, (...args: any[]) => unknown> = {
    toggleFullscreen: () => actions.toggleFullscreen(),
    setFullscreen: (on) => actions.setFullscreen(!!on),
    minimize: () => { getWindow()?.minimize(); },
    quit: () => { actions.quit(); },
  };
  for (const [name, fn] of Object.entries(win)) handle(`window.${name}`, fn);

  const fire: Record<'sessionReport' | 'sessionStage' | keyof XenithCoreExtras, (...args: any[]) => void> = {
    sessionReport: (id, stats) => core.sessionReport(String(id), stats),
    sessionStage: (id, ev) => core.sessionStage(String(id), ev),
    reportAudioOutputs: (list) => core.reportAudioOutputs(list),
    reportRumble: (r) => core.reportRumble(r),
  };
  for (const [name, fn] of Object.entries(fire)) on(name, fn);
}
