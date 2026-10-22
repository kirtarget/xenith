// History store: userData/history.json, newest first, last 50 sessions.
import { app } from 'electron';
import { join } from 'node:path';
import type { HistoryEntry } from '../shared/api';
import { pushHistory } from './history-core';
import { readJson, writeJsonAtomic } from './util';
import { logWarn } from './log';

const MAX = 50;

export class HistoryStore {
  readonly file: string;
  private list: HistoryEntry[] | null = null;

  constructor(file = join(app.getPath('userData'), 'history.json')) { this.file = file; }

  all(): HistoryEntry[] {
    if (!this.list) {
      try {
        const j = readJson<{ v: number; entries: HistoryEntry[] }>(this.file);
        this.list = Array.isArray(j?.entries) ? j!.entries.filter((e) => e && typeof e.id === 'string').slice(0, MAX) : [];
      } catch (e) { logWarn('history.unreadable', e); this.list = []; }
    }
    return this.list.map((e) => ({ ...e }));
  }

  add(entry: HistoryEntry) {
    this.list = pushHistory(this.all(), entry, MAX);
    this.save();
  }

  clear() { this.list = []; this.save(); }

  private save() {
    try { writeJsonAtomic(this.file, { v: 1, entries: this.list }); } catch (e) { logWarn('history.write_failed', e); }
  }
}
