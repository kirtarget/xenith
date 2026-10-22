// Real preload (full window.xenith) + test-only extras on window.xenithTest. Sandbox-safe: only 'electron' is required.
import { contextBridge, ipcRenderer } from 'electron';
import '../../src/preload/preload';

contextBridge.exposeInMainWorld('xenithTest', {
  config: () => ipcRenderer.invoke('xenithTest:config'),
  log: (event: string, data?: unknown) => ipcRenderer.send('xenithTest:log', event, data),
  done: () => ipcRenderer.send('xenithTest:done'),
});
