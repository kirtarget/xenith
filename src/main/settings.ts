// Settings store: userData/settings.json. Loaded synchronously (usable before app 'ready' so the
// platform layer can apply Chromium switches), validated on every load/patch, written atomically.
import { app } from 'electron';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { DeepPartial, Settings } from '../shared/api';
import { applySettingsPatch, normalizeSettings } from './settings-core';
import { writeJsonAtomic } from './util';
import { log, logWarn } from './log';

export class SettingsStore {
  private cur: Settings;
  readonly file: string;
  private listeners = new Set<(s: Settings) => void>();

  constructor(file = join(app.getPath('userData'), 'settings.json')) {
    this.file = file;
    this.cur = this.load();
  }

  private load(): Settings {
    if (!existsSync(this.file)) return normalizeSettings({});
    try {
      return normalizeSettings(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch (e) {
      const bad = `${this.file}.bad-${Date.now()}`;
      try { renameSync(this.file, bad); } catch { /* ignore */ }
      logWarn('settings.unreadable', { error: e, movedTo: bad });
      return normalizeSettings({});
    }
  }

  onChange(fn: (s: Settings) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get(): Settings { return structuredClone(this.cur); }

  set(patch: DeepPartial<Settings>): Settings {
    return this.replace(applySettingsPatch(this.cur, patch));
  }

  reset(): Settings { return this.replace(normalizeSettings({})); }

  private replace(next: Settings): Settings {
    const changed = JSON.stringify(next) !== JSON.stringify(this.cur);
    this.cur = next;
    if (changed || !existsSync(this.file)) {
      try { writeJsonAtomic(this.file, next); } catch (e) { logWarn('settings.write_failed', e); }
    }
    if (changed) {
      log('settings.changed');
      for (const l of this.listeners) { try { l(this.get()); } catch { /* ignore */ } }
    }
    return this.get();
  }
}
