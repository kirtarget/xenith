import type { SessionKind } from '../../shared/api';

export interface ResumeTarget { kind: SessionKind; targetId: string; targetName: string }

interface ResumeDeps {
  stop(): Promise<void>;
  connect(target: ResumeTarget, signal: AbortSignal): Promise<boolean>;
  online(): boolean;
  allowed(): boolean;
  waiting(target: ResumeTarget): void;
  exhausted(target: ResumeTarget): void;
  now(): number;
  wait(ms: number, signal: AbortSignal): Promise<void>;
}

type ResumeState =
  | { kind: 'idle' }
  | { kind: 'sleeping'; target: ResumeTarget | null }
  | { kind: 'restoring'; target: ResumeTarget; abort: AbortController; work: Promise<void> };

export function waitForResume(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export function createResumeController(deps: ResumeDeps) {
  let state: ResumeState = { kind: 'idle' };
  let cleanup = Promise.resolve();

  const cancel = () => {
    if (state.kind === 'restoring') state.abort.abort();
    state = { kind: 'idle' };
  };

  const suspend = (target: ResumeTarget | null) => {
    if (state.kind === 'sleeping') return;
    const saved = target ?? (state.kind === 'restoring' ? state.target : null);
    cancel();
    state = { kind: 'sleeping', target: saved && { ...saved } };
    if (saved) {
      let stopped: Promise<void>;
      try { stopped = deps.stop(); } catch { stopped = Promise.resolve(); }
      cleanup = Promise.all([cleanup, stopped.catch(() => undefined)]).then(() => undefined);
    }
  };

  const resume = (): Promise<void> => {
    if (state.kind === 'restoring') return state.work;
    if (state.kind !== 'sleeping' || !state.target || !deps.allowed()) { cancel(); return Promise.resolve(); }
    const job: Extract<ResumeState, { kind: 'restoring' }> = {
      kind: 'restoring', target: state.target, abort: new AbortController(), work: Promise.resolve(),
    };
    state = job;
    deps.waiting(job.target);
    const active = () => state === job && !job.abort.signal.aborted && deps.allowed();
    job.work = (async () => {
      await cleanup;
      if (!active()) return;
      const deadline = deps.now() + 120_000;
      await deps.wait(1000, job.abort.signal);
      for (let attempt = 0; attempt < 3 && active(); attempt++) {
        while (active() && !deps.online() && deps.now() < deadline) await deps.wait(1000, job.abort.signal);
        if (!active()) return;
        if (deps.now() >= deadline) break;
        try { if (await deps.connect(job.target, job.abort.signal)) return; } catch { /* retry within the budget */ }
        if (attempt < 2 && active()) {
          deps.waiting(job.target);
          await deps.wait(attempt === 0 ? 1500 : 4000, job.abort.signal);
        }
      }
      if (active()) deps.exhausted(job.target);
    })().finally(() => { if (state === job) state = { kind: 'idle' }; });
    return job.work;
  };

  return { suspend, resume, cancel, get state() { return state.kind; } };
}
