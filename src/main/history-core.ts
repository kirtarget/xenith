// Session history aggregation (pure, unit-tested): StreamStats samples + stage events → HistoryEntry.
import type { HistoryEntry, SessionKind, StageEvent, StageId, StreamStats } from '../shared/api';

/** Bucket-average a series down to at most `max` points (rounded). */
export function downsample(values: readonly number[], max = 60): number[] {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length <= max) return v.map((x) => Math.round(x));
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const a = Math.floor((i * v.length) / max), b = Math.floor(((i + 1) * v.length) / max);
    let s = 0;
    for (let j = a; j < b; j++) s += v[j];
    out.push(Math.round(s / Math.max(1, b - a)));
  }
  return out;
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Incremental aggregation of ~1 Hz StreamStats (memory: one number per sample). */
export class StatsAccumulator {
  samples = 0;
  readonly kbps: number[] = [];
  private fpsSum = 0;
  private fpsN = 0;
  maxWidth: number | null = null;
  maxHeight: number | null = null;
  packetsLost = 0;
  firstAt: number | null = null;
  lastAt: number | null = null;

  add(s: Partial<StreamStats> | null | undefined) {
    if (!s || typeof s !== 'object') return;
    this.samples++;
    if (num(s.at)) { this.firstAt ??= s.at; this.lastAt = s.at; }
    if (num(s.kbps) && s.kbps >= 0) this.kbps.push(s.kbps);
    if (num(s.fps) && s.fps > 0) { this.fpsSum += s.fps; this.fpsN++; }
    if (num(s.frameWidth) && num(s.frameHeight) && s.frameWidth * s.frameHeight > (this.maxWidth ?? 0) * (this.maxHeight ?? 0)) {
      this.maxWidth = s.frameWidth; this.maxHeight = s.frameHeight;
    }
    // packetsLost from getStats is cumulative for the inbound RTP stream.
    if (num(s.packetsLost) && s.packetsLost > this.packetsLost) this.packetsLost = s.packetsLost;
  }

  get avgFps(): number | null { return this.fpsN ? Math.round(this.fpsSum / this.fpsN) : null; }
  get avgKbps(): number | null { return this.kbps.length ? Math.round(this.kbps.reduce((a, b) => a + b, 0) / this.kbps.length) : null; }
}

/** Per-stage durations: first 'active' → first 'done'/'failed'. */
export class StageClock {
  private started: Partial<Record<StageId, number>> = {};
  private finished: Partial<Record<StageId, number>> = {};

  mark(ev: StageEvent) {
    if (!ev || !num(ev.at)) return;
    if (ev.status === 'active') { this.started[ev.stage] ??= ev.at; return; }
    if (this.finished[ev.stage] !== undefined) return;
    this.finished[ev.stage] = Math.max(0, ev.at - (this.started[ev.stage] ?? ev.at));
  }

  durations(): Partial<Record<StageId, number>> { return { ...this.finished }; }
  doneAt(stage: StageId): number | null {
    const d = this.finished[stage], s = this.started[stage];
    return d !== undefined ? (s ?? 0) + d : null;
  }
}

export interface HistoryMeta {
  id: string;
  kind: SessionKind;
  targetId: string;
  targetName: string;
  startedAt: number;
  endedAt: number;
  playAt: number | null;        // POST /play sent
  firstFrameAt: number | null;  // renderer firstFrame done
  endReason: HistoryEntry['endReason'];
}

export function buildHistoryEntry(m: HistoryMeta, acc: StatsAccumulator, clock: StageClock): HistoryEntry {
  const from = m.firstFrameAt ?? acc.firstAt ?? m.startedAt;
  return {
    id: m.id,
    kind: m.kind,
    targetId: m.targetId,
    targetName: m.targetName,
    startedAt: m.startedAt,
    durationSec: Math.max(0, Math.round((m.endedAt - from) / 1000)),
    connectMs: m.firstFrameAt !== null && m.playAt !== null ? Math.max(0, m.firstFrameAt - m.playAt) : null,
    stages: clock.durations(),
    maxWidth: acc.maxWidth,
    maxHeight: acc.maxHeight,
    fps: acc.avgFps,
    avgKbps: acc.avgKbps,
    packetsLost: acc.packetsLost,
    bitrateTrace: downsample(acc.kbps, 60),
    endReason: m.endReason,
  };
}

/** Newest first, capped. */
export function pushHistory(list: readonly HistoryEntry[], entry: HistoryEntry, max = 50): HistoryEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, max);
}
