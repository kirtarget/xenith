// Steam Deck gaming mode: run the panel at the stream's 60 Hz while streaming. The Deck OLED panel runs at 90 Hz;
// 60 fps video on a 90 Hz panel judders (frames alternate between 1 and 2 refreshes) and costs battery.
// Gamescope reads the refresh rate for the focused app from the GAMESCOPE_DYNAMIC_REFRESH property on the root
// window of Steam's X display (the same property Steam's own refresh-rate slider sets). We set it while a stream
// is active and restore the previous value afterwards.

export const STREAM_REFRESH_HZ = 60;
const ATOM = 'GAMESCOPE_DYNAMIC_REFRESH';

export type Run = (cmd: string, args: string[], timeoutMs?: number) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

/** Parses `xprop -root GAMESCOPE_DYNAMIC_REFRESH` output; null when the property is not set. */
export function parseRefresh(stdout: string): number | null {
  const m = /=\s*(\d+)/.exec(stdout);
  return m ? Number(m[1]) : null;
}

type Log = (event: string, data?: unknown) => void;

export function createRefreshMatcher(deps: { run: Run; enabled: () => boolean; displays?: string[]; log?: Log; warn?: Log }) {
  const log: Log = deps.log ?? (() => {}), logWarn: Log = deps.warn ?? (() => {});
  let display: string | null = null;
  let previous: number | null | undefined;     // undefined = we did not change anything
  let queue = Promise.resolve();

  const xprop = (d: string, args: string[]) => deps.run('xprop', ['-display', d, '-root', ...args], 4000);

  async function findDisplay(): Promise<string | null> {
    if (display) return display;
    // Steam's X display is the one carrying gamescope's root properties (usually :0; Xenith itself is on :1).
    for (const d of deps.displays ?? [':0', process.env.DISPLAY ?? ':1']) {
      const r = await xprop(d, ['GAMESCOPE_FOCUSED_APP']).catch(() => null);
      if (r?.ok && /=/.test(r.stdout)) { display = d; return d; }
    }
    return null;
  }

  async function apply() {
    if (previous !== undefined || !deps.enabled()) return;
    const d = await findDisplay();
    if (!d) return;
    const cur = parseRefresh((await xprop(d, [ATOM])).stdout);
    if (cur === STREAM_REFRESH_HZ) return;
    const r = await xprop(d, ['-f', ATOM, '32c', '-set', ATOM, String(STREAM_REFRESH_HZ)]);
    if (!r.ok) { logWarn('deck.refresh_set_failed', { stderr: r.stderr.slice(0, 200) }); return; }
    previous = cur;
    log('deck.refresh_set', { hz: STREAM_REFRESH_HZ, previous: cur });
  }

  async function restore() {
    if (previous === undefined) return;
    const d = await findDisplay();
    const prev = previous;
    previous = undefined;
    if (!d) return;
    const r = prev === null ? await xprop(d, ['-remove', ATOM]) : await xprop(d, ['-f', ATOM, '32c', '-set', ATOM, String(prev)]);
    if (!r.ok) logWarn('deck.refresh_restore_failed', { stderr: r.stderr.slice(0, 200) });
    else log('deck.refresh_restored', { hz: prev });
  }

  const enqueue = (fn: () => Promise<void>) => (queue = queue.then(fn).catch((e) => logWarn('deck.refresh_error', e)));
  return {
    /** Call with the number of active streams. */
    update(active: number) { return enqueue(active > 0 ? apply : restore); },
    restore() { return enqueue(restore); },
  };
}