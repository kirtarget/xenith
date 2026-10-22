import type { Lang } from '../../shared/api';

/** Russian plural: [одна, две–четыре, пять+] → минута / минуты / минут. */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(Math.trunc(n));
  const m10 = a % 10, m100 = a % 100;
  if (!Number.isInteger(n)) return forms[1];
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export function pluralEn(n: number, one: string, other: string): string {
  return Math.abs(n) === 1 ? one : other;
}

const nf = new Map<string, Intl.NumberFormat>();
/** Locale number: 16,9 (ru) / 16.9 (en). Fixed fraction digits, never grouping for numbers < 10 000. */
export function num(lang: Lang, n: number, digits = 0): string {
  const key = lang + digits;
  let f = nf.get(key);
  if (!f) {
    f = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    nf.set(key, f);
  }
  return f.format(n);
}
