// Pure view-model helpers shared by screens.
import { useEffect, useState } from 'react';
import type { ConsoleInfo, HistoryEntry, StageId } from '../../shared/api';
import type { I18n } from '../i18n';
import type { RailItem } from '../components/data';
import type { SessionState, StageState } from '../state/store';
import type { Tone } from '../components/feedback';

export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

export function powerTone(c: ConsoleInfo | null | undefined): Tone {
  if (!c) return 'idle';
  if (c.power === 'On') return 'ok';
  if (c.power === 'ConnectedStandby') return 'warn';
  if (c.power === 'Off') return 'bad';
  return 'idle';
}

export function powerText(i18n: I18n, c: ConsoleInfo): string {
  return i18n.s.power[c.power] ?? i18n.s.power.Unknown;
}

export function consoleTypeText(i18n: I18n, type: string): string {
  return i18n.s.consoleType[type] ?? type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Rail of a past connection (Main / DeckHome mockups). */
export function historyRail(i18n: I18n, h: HistoryEntry | null, deck: boolean): RailItem[] {
  const { s, f } = i18n;
  const st = h?.stages ?? {};
  const v = (ms: number | undefined | null) => (h && ms != null ? f.sec(ms) : s.common.dash);
  const sum = (...k: StageId[]) => k.every(x => st[x] == null) ? null : k.reduce((a, x) => a + (st[x] ?? 0), 0);
  const total = h ? (h.connectMs ?? sum('auth', 'provision', 'negotiate', 'connect', 'firstFrame')) : null;
  if (deck) {
    return [
      { key: 'wake', label: s.home.deckRailWake, sub: v(sum('auth', 'provision')), status: 'past' },
      { key: 'conn', label: s.home.deckRailConnect, sub: v(sum('negotiate', 'connect')), status: 'past' },
      { key: 'total', label: s.home.deckRailTotal, sub: v(total), status: 'past' },
    ];
  }
  return [
    { key: 'wake', label: s.home.railWakePrep, sub: v(sum('auth', 'provision')), status: 'past' },
    { key: 'neg', label: s.home.railNegotiate, sub: v(st.negotiate), status: 'past' },
    { key: 'conn', label: s.home.railConnect, sub: v(st.connect), status: 'past' },
    { key: 'ff', label: s.home.railFirstFrame, sub: total != null ? s.home.railTotal(f.sec(total)) : s.common.dash, status: 'past' },
  ];
}

function mergeStages(a: StageState, b: StageState): StageState {
  const status = a.status === 'failed' || b.status === 'failed' ? 'failed'
    : a.status === 'active' || b.status === 'active' ? 'active'
      : b.status === 'done' ? 'done'
        : a.status === 'done' ? 'active' : 'pending';
  return { status, startedAt: a.startedAt ?? b.startedAt, endedAt: b.endedAt ?? (status === 'failed' ? a.endedAt : null), queuePosition: a.queuePosition ?? b.queuePosition };
}

/** Live rail for the Connecting screen (4 segments). */
export function liveRail(i18n: I18n, sess: SessionState, now: number): RailItem[] {
  const { s, f } = i18n;
  const c = s.connecting;
  const cloud = sess.kind === 'cloud';
  const segs: Array<{ key: string; label: string; pending: string; st: StageState }> = [
    { key: 'auth', label: c.auth, pending: c.authPending, st: sess.stages.auth },
    { key: 'provision', label: cloud ? c.provisionCloud : c.provisionHome, pending: cloud ? c.provisionPendingCloud : c.provisionPendingHome, st: sess.stages.provision },
    { key: 'connect', label: c.connect, pending: c.connectPending, st: mergeStages(sess.stages.negotiate, sess.stages.connect) },
    { key: 'firstFrame', label: c.firstFrame, pending: c.firstFramePending, st: sess.stages.firstFrame },
  ];
  let prevEnd: number | null = sess.startedAt;
  return segs.map(g => {
    const start = g.st.startedAt ?? prevEnd ?? sess.startedAt;
    let sub = g.pending;
    if (g.st.status === 'done' && g.st.endedAt) sub = f.sec(g.st.endedAt - start);
    else if (g.st.status === 'active') {
      sub = g.st.queuePosition != null
        ? c.queue(g.st.queuePosition, g.st.etaSeconds != null ? Math.max(1, Math.round(g.st.etaSeconds / 60)) : null)
        : c.waiting(f.sec(Math.max(0, now - start)));
    } else if (g.st.status === 'failed') sub = c.failed;
    prevEnd = g.st.endedAt ?? prevEnd;
    return { key: g.key, label: g.label, sub, status: g.st.status };
  });
}

export function resolutionCap(history: HistoryEntry[] | null, kind: 'home' | 'cloud' = 'home', targetId?: string | null): number | null {
  const list = (history ?? []).filter(h => h.kind === kind && (!targetId || h.targetId === targetId));
  const hs = list.map(h => h.maxHeight ?? 0).filter(Boolean);
  return hs.length ? Math.max(...hs) : null;
}
