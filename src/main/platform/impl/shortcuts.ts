// shortcuts.vdf model on top of the binary KeyValues codec. Pure (no fs, no electron) so it is unit-testable.
import { KV, KVDocument, KVEntry, KVMap, findEntry, getInt, getMap, getString, int, map, parseBinaryVdf, serializeBinaryVdf, setEntry, str } from './vdf';
import { shortcutAppId, toSigned32, toUnsigned32 } from './steam-ids';

export interface ShortcutSpec {
  appName: string;
  exe: string;            // stored as given — pass it already quoted ("C:\...\Xenith.exe")
  startDir: string;       // quoted as well
  icon?: string;
  launchOptions?: string;
  tags?: string[];
  appid?: number;         // unsigned; computed from exe+appName when omitted
}

export interface ShortcutView {
  index: string;          // key inside "shortcuts" ("0", "1", ...)
  appid: number;          // unsigned
  appName: string;
  exe: string;
  startDir: string;
  launchOptions: string;
  tags: string[];
}

export function emptyShortcutsDoc(): KVDocument {
  return { root: { entries: [map('shortcuts', [])] }, trailing: new Uint8Array(0) };
}

export function parseShortcuts(bytes: Uint8Array | null): KVDocument {
  if (!bytes || bytes.length === 0) return emptyShortcutsDoc();
  const doc = parseBinaryVdf(bytes);
  if (!getMap(doc.root, 'shortcuts')) throw new Error('shortcuts.vdf: no "shortcuts" map');
  return doc;
}

export const serializeShortcuts = (doc: KVDocument) => serializeBinaryVdf(doc);

function list(doc: KVDocument): KVMap {
  const m = getMap(doc.root, 'shortcuts');
  if (!m) throw new Error('shortcuts.vdf: no "shortcuts" map');
  return m;
}

export function listShortcuts(doc: KVDocument): ShortcutView[] {
  return list(doc).entries.filter((e) => e.type === KV.MAP).map((e) => {
    const m = e.value as KVMap;
    const tags = getMap(m, 'tags');
    const appName = getString(m, 'AppName') ?? getString(m, 'appname') ?? '';
    const exe = getString(m, 'Exe') ?? '';
    const stored = getInt(m, 'appid');
    return {
      index: e.key,
      appid: stored !== undefined ? toUnsigned32(stored) : shortcutAppId(exe, appName),
      appName, exe,
      startDir: getString(m, 'StartDir') ?? '',
      launchOptions: getString(m, 'LaunchOptions') ?? '',
      tags: tags ? tags.entries.filter((t) => t.type === KV.STRING).map((t) => t.value as string) : [],
    };
  });
}

/** Field set and order written by the current Steam client when a non-Steam game is added. */
function newShortcutEntries(spec: ShortcutSpec, appid: number): KVEntry[] {
  return [
    int('appid', toSigned32(appid)),
    str('AppName', spec.appName),
    str('Exe', spec.exe),
    str('StartDir', spec.startDir),
    str('icon', spec.icon ?? ''),
    str('ShortcutPath', ''),
    str('LaunchOptions', spec.launchOptions ?? ''),
    int('IsHidden', 0),
    int('AllowDesktopConfig', 1),
    int('AllowOverlay', 1),
    int('OpenVR', 0),
    int('Devkit', 0),
    str('DevkitGameID', ''),
    int('DevkitOverrideAppID', 0),
    int('LastPlayTime', 0),
    str('FlatpakAppID', ''),
    tagsEntry(spec.tags ?? []),
  ];
}
const tagsEntry = (tags: string[]): KVEntry => map('tags', tags.map((t, i) => str(String(i), t)));

/**
 * Adds or updates a shortcut. A shortcut is "the same" when its appid matches, or when AppName matches and
 * `match` says so (lets callers recognise their own older entries). Existing unknown fields are kept.
 * Returns the unsigned appid and whether a new entry was created.
 */
export function upsertShortcut(doc: KVDocument, spec: ShortcutSpec, match?: (s: ShortcutView) => boolean): { appid: number; created: boolean } {
  const appid = spec.appid ?? shortcutAppId(spec.exe, spec.appName);
  const l = list(doc);
  const views = listShortcuts(doc);
  const hit = views.find((v) => v.appid === appid) ?? (match ? views.find(match) : undefined);
  if (hit) {
    const m = findEntry(l, hit.index)!.value as KVMap;
    setEntry(m, int('appid', toSigned32(appid)));
    setEntry(m, str('AppName', spec.appName));
    setEntry(m, str('Exe', spec.exe));
    setEntry(m, str('StartDir', spec.startDir));
    if (spec.icon !== undefined) setEntry(m, str('icon', spec.icon));
    setEntry(m, str('LaunchOptions', spec.launchOptions ?? ''));
    if (spec.tags) {
      const existing = getMap(m, 'tags');
      const merged = existing ? existing.entries.filter((t) => t.type === KV.STRING).map((t) => t.value as string) : [];
      for (const t of spec.tags) if (!merged.includes(t)) merged.push(t);
      setEntry(m, tagsEntry(merged));
    }
    return { appid, created: false };
  }
  const nextIndex = l.entries.reduce((n, e) => Math.max(n, (Number(e.key) || 0) + 1), 0);
  l.entries.push(map(String(l.entries.length === 0 ? 0 : nextIndex), newShortcutEntries(spec, appid)));
  return { appid, created: true };
}

/** Removes a shortcut by unsigned appid and renumbers the remaining keys 0..n-1 like Steam does. */
export function removeShortcut(doc: KVDocument, appid: number): boolean {
  const l = list(doc);
  const views = listShortcuts(doc);
  const hit = views.find((v) => v.appid === appid);
  if (!hit) return false;
  l.entries = l.entries.filter((e) => e.key !== hit.index);
  let i = 0;
  for (const e of l.entries) if (e.type === KV.MAP) e.key = String(i++);
  return true;
}

export const XCLOUD_ARG = /(?:^|\s)--xcloud=([^\s"]+)/;
export function xcloudTitleIdOf(s: ShortcutView): string | null {
  const m = XCLOUD_ARG.exec(s.launchOptions);
  return m ? m[1] : null;
}
