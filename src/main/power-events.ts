import { powerMonitor } from 'electron';
import { logWarn } from './log';

interface PowerEvents {
  on(event: 'suspend' | 'resume', listener: () => void): unknown;
  removeListener(event: 'suspend' | 'resume', listener: () => void): unknown;
}

export function registerPowerEvents(emit: (state: 'suspend' | 'resume') => void, stopSessions: () => Promise<void>, monitor: PowerEvents = powerMonitor): () => void {
  let generation = 0;
  let cleanup = Promise.resolve();
  const suspend = () => {
    generation++;
    emit('suspend');
    cleanup = Promise.all([cleanup, stopSessions().catch(error => logWarn('power.suspend_cleanup_failed', error))]).then(() => undefined);
  };
  const resume = () => {
    const current = ++generation;
    void cleanup.then(() => { if (current === generation) emit('resume'); });
  };
  monitor.on('suspend', suspend);
  monitor.on('resume', resume);
  return () => { generation++; monitor.removeListener('suspend', suspend); monitor.removeListener('resume', resume); };
}
