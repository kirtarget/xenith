// xCloud title list: GET {region}/v2/titles (entitled titles) merged with Game Pass catalog metadata
// (POST catalog.gamepass.com/v3/products, hydration RemoteLowJade0, as used by Geocld/XStreaming-desktop (MIT)
// titlemanager.ts). Cached to userData/cloud-titles.json for 12 h.
import type { CloudTitle, Settings } from '../shared/api';
import type { XboxAuth } from './xbox-auth';
import { APP_VERSION, type GssvApi } from './xhome-api';
import { platform } from './platform';
import { readJson, writeJsonAtomic } from './util';
import { log, logWarn } from './log';
import { rmSync } from 'node:fs';

const TTL = 12 * 3600_000;
type StoredTitle = Omit<CloudTitle, 'inSteam'>;
interface CacheFile { v: 1; fetchedAt: number; lang: string; offering: string; titles: StoredTitle[] }

const img = (o: any): string | null => {
  const u = o?.URL ?? o?.Url ?? o?.Uri ?? o?.url;
  if (typeof u !== 'string' || !u) return null;
  return u.startsWith('//') ? 'https:' + u : u;
};

/** Pure merge of /v2/titles results with catalog Products (unit-testable). */
export function mergeCatalog(titles: readonly any[], products: Record<string, any>): StoredTitle[] {
  const out: StoredTitle[] = [];
  const seen = new Set<string>();
  for (const t of titles) {
    const titleId = t?.titleId, pid = t?.details?.productId;
    if (typeof titleId !== 'string' || typeof pid !== 'string' || seen.has(titleId)) continue;
    if (t.details.hasEntitlement === false) continue;
    const p = products[pid] ?? products[pid.toUpperCase()];
    if (!p?.ProductTitle) continue;
    seen.add(titleId);
    out.push({
      titleId,
      productId: pid,
      name: String(p.ProductTitle),
      publisher: p.PublisherName ? String(p.PublisherName) : null,
      coverUrl: img(p.Image_Poster) ?? img(p.Image_BoxArt) ?? img(p.Image_Tile),
      heroUrl: img(p.Image_Hero) ?? img(p.Image_SuperHeroArt) ?? img(p.Image_TitledHeroArt) ?? img(p.Image_Tile),
      supportsMouseKeyboard: (t.details.supportedInputTypes || []).some((x: unknown) => typeof x === 'string' && /mkb|mouse/i.test(x)),
    });
  }
  return out;
}

export class CloudCatalog {
  private mem: CacheFile | null = null;

  constructor(private auth: XboxAuth, private api: GssvApi, private settings: () => Settings, private file: string) {}

  private langOf(s: Settings) { return s.ui.lang === 'ru' ? 'ru-RU' : 'en-US'; }

  private readFile(): CacheFile | null {
    try { const j = readJson<CacheFile>(this.file); return j?.v === 1 && Array.isArray(j.titles) ? j : null; } catch { return null; }
  }

  async list(refresh = false): Promise<CloudTitle[]> {
    const lang = this.langOf(this.settings());
    let c = this.mem ?? this.readFile();
    if (refresh || !c || Date.now() - c.fetchedAt > TTL || c.lang !== lang) {
      try {
        c = await this.fetch(lang);
        this.mem = c;
        try { writeJsonAtomic(this.file, c); } catch (e) { logWarn('titles.cache_write_failed', e); }
      } catch (e) {
        if (!c) throw e;
        logWarn('titles.refresh_failed_using_cache', e);
      }
    }
    this.mem = c;
    let steam = new Set<string>();
    try { steam = new Set(await platform.steam.shortcutTitleIds()); } catch { /* platform not ready */ }
    return c.titles.map((t) => ({ ...t, inSteam: steam.has(t.titleId) }));
  }

  find(titleId: string): StoredTitle | null {
    const c = this.mem ?? this.readFile();
    return c?.titles.find((t) => t.titleId === titleId) ?? null;
  }

  clear() { this.mem = null; try { rmSync(this.file, { force: true }); } catch { /* ignore */ } }

  private async fetch(lang: string): Promise<CacheFile> {
    const ent = await this.auth.cloudEntitlement();
    if (!ent.offering) return { v: 1, fetchedAt: Date.now(), lang, offering: 'none', titles: [] };
    const b = await this.api.base(ent.offering, this.settings().network.regionName);
    const titles = await this.api.titles(b);
    const pids = [...new Set(titles.filter((t) => t?.details?.hasEntitlement !== false).map((t) => t?.details?.productId).filter((x): x is string => typeof x === 'string'))];
    const products: Record<string, any> = {};
    for (let i = 0; i < pids.length; i += 100) {
      const r = await fetch(`https://catalog.gamepass.com/v3/products?market=US&language=${lang}&hydration=RemoteLowJade0`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'ms-cv': '0', 'calling-app-name': 'Xbox Cloud Gaming Web', 'calling-app-version': APP_VERSION },
        body: JSON.stringify({ Products: pids.slice(i, i + 100) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`catalog.gamepass.com ${r.status}`);
      const j: any = await r.json();
      Object.assign(products, j?.Products || {});
    }
    const merged = mergeCatalog(titles, products).sort((a, b) => a.name.localeCompare(b.name, lang));
    log('titles.fetched', { offering: ent.offering, region: b.region, titles: titles.length, withCatalog: merged.length });
    return { v: 1, fetchedAt: Date.now(), lang, offering: ent.offering, titles: merged };
  }
}
