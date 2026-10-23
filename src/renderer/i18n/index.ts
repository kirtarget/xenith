import { createContext, useContext } from 'react';
import type { Lang } from '../../shared/api';
import { ru, type Strings } from './ru';
import { en } from './en';
import { num } from './plural';

export type { Strings };
export const dictionaries: Record<Lang, Strings> = { ru, en };

/** Number / unit formatting bound to a language. All numbers in the UI go through here. */
export function makeFormat(lang: Lang) {
  const s = dictionaries[lang];
  const u = s.units;
  const hm = (ts: number) => new Date(ts).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const dayDiff = (ts: number) => {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((t.getTime() - d.getTime()) / 86400000);
  };
  const dayMonth = (ts: number) => new Date(ts).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' });
  return {
    n: (x: number, digits = 0) => num(lang, x, digits),
    /** 16900 kbps → "16,9 Мбит/с" */
    mbps: (kbps: number | null) => kbps == null ? s.common.dash : `${num(lang, kbps / 1000, 1)} ${u.mbps}`,
    mbpsValue: (kbps: number) => num(lang, kbps / 1000, 1),
    res: (w: number | null, h: number | null) => w && h ? `${w}×${h}` : s.common.dash,
    fps: (f: number | null) => f == null ? s.common.dash : `${Math.round(f)} ${u.fps}`,
    /** ms → "12,0 с" */
    sec: (ms: number) => `${num(lang, ms / 1000, 1)} ${u.s}`,
    ms: (x: number | null, digits = 1) => x == null ? s.common.dash : `${num(lang, x, x >= 10 ? 0 : digits)} ${u.ms}`,
    pct: (x: number) => `${Math.round(x)} %`,
    p: (h: number | null) => h ? `${h}p` : s.common.dash,
    /** History table: "45 с", "12 мин", "1 ч 5 мин" */
    durShort: (sec: number) => {
      if (sec < 60) return `${Math.round(sec)} ${u.s}`;
      const m = Math.round(sec / 60);
      if (m < 60) return `${m} ${u.min}`;
      return `${Math.floor(m / 60)} ${u.h} ${m % 60} ${u.min}`;
    },
    /** Sentences: "45 секунд", "12 минут", "2 часа" */
    durLong: (sec: number) => {
      if (sec < 60) return s.time.seconds(Math.round(sec));
      const m = Math.round(sec / 60);
      if (m < 60) return s.time.minutes(m);
      const h = Math.floor(m / 60), r = m % 60;
      return r ? `${s.time.hours(h)} ${s.time.minutes(r)}` : s.time.hours(h);
    },
    /** "Сегодня, 20:07" */
    when: (ts: number) => {
      const d = dayDiff(ts);
      if (d === 0) return `${s.time.today}, ${hm(ts)}`;
      if (d === 1) return `${s.time.yesterday}, ${hm(ts)}`;
      return `${dayMonth(ts)}, ${hm(ts)}`;
    },
    /** "Сегодня в 20:07" */
    whenAt: (ts: number) => {
      const d = dayDiff(ts);
      if (d === 0) return s.time.todayAt(hm(ts));
      if (d === 1) return s.time.yesterdayAt(hm(ts));
      return `${dayMonth(ts)}, ${hm(ts)}`;
    },
  };
}
export type Format = ReturnType<typeof makeFormat>;

export interface I18n { lang: Lang; s: Strings; f: Format; t: (path: string, ...args: unknown[]) => string }

export function makeI18n(lang: Lang): I18n {
  const s = dictionaries[lang] ?? en;
  const f = makeFormat(lang);
  /** Path lookup, e.g. t('home.losses', 3) → "потери". Prefer the typed `s` object in components. */
  const t = (path: string, ...args: unknown[]): string => {
    let v: unknown = s;
    for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
    if (typeof v === 'function') return String((v as (...a: unknown[]) => unknown)(...args));
    return typeof v === 'string' ? v : path;
  };
  return { lang, s, f, t };
}

export const I18nContext = createContext<I18n>(makeI18n('en'));
export const useI18n = () => useContext(I18nContext);
