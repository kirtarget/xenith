// Binary KeyValues ("binary VDF") reader/writer, as used by Steam's userdata/<id>/config/shortcuts.vdf.
// Written in-house (no dependency). Order, key casing and value types are preserved exactly, so
// parse(serialize(x)) and serialize(parse(bytes)) are byte-identical for every file Steam writes.
//
// Grammar:  map := entry* END     entry := TYPE key\0 value
//   TYPE 0x00 nested map, 0x01 UTF-8 string\0, 0x02 int32 LE, 0x03 float32 LE, 0x04 pointer (4 bytes),
//   0x05 wide string (UTF-16LE, \0\0), 0x06 colour (4 bytes), 0x07 uint64 LE, 0x0A int64 LE,
//   0x08 end of map (0x0B is accepted as an alternate end marker and preserved).
// shortcuts.vdf = one top-level map: 00 "shortcuts" 00 { 00 "0" 00 {...} 08 ... } 08 08

export const KV = {
  MAP: 0x00, STRING: 0x01, INT32: 0x02, FLOAT32: 0x03, POINTER: 0x04, WSTRING: 0x05,
  COLOR: 0x06, UINT64: 0x07, END: 0x08, INT64: 0x0a, END_ALT: 0x0b,
} as const;

export type KVEntry =
  | { key: string; type: 0x00; value: KVMap }
  | { key: string; type: 0x01; value: string }
  | { key: string; type: 0x02; value: number }
  | { key: string; type: 0x03 | 0x04 | 0x06; value: Uint8Array }   // raw 4 bytes (bit-exact)
  | { key: string; type: 0x05; value: Uint8Array }                 // raw UTF-16LE without terminator
  | { key: string; type: 0x07 | 0x0a; value: bigint };

export interface KVMap { entries: KVEntry[]; end?: number /* 0x08 (default) or 0x0B */ }
export interface KVDocument { root: KVMap; trailing: Uint8Array }

const utf8 = new TextDecoder('utf-8', { fatal: false });
const enc = new TextEncoder();

export class VdfError extends Error {}

export function parseBinaryVdf(input: Uint8Array): KVDocument {
  const buf = input;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;
  const cstr = (): string => {
    const start = pos;
    while (pos < buf.length && buf[pos] !== 0) pos++;
    if (pos >= buf.length) throw new VdfError(`unterminated string at ${start}`);
    const s = utf8.decode(buf.subarray(start, pos));
    pos++;
    return s;
  };
  const need = (n: number) => { if (pos + n > buf.length) throw new VdfError(`truncated at ${pos}`); };
  const readMap = (depth: number): KVMap => {
    if (depth > 64) throw new VdfError('nesting too deep');
    const entries: KVEntry[] = [];
    for (;;) {
      need(1);
      const type = buf[pos++];
      if (type === KV.END || type === KV.END_ALT) return type === KV.END ? { entries } : { entries, end: type };
      const key = cstr();
      switch (type) {
        case KV.MAP: entries.push({ key, type, value: readMap(depth + 1) }); break;
        case KV.STRING: entries.push({ key, type, value: cstr() }); break;
        case KV.INT32: need(4); entries.push({ key, type, value: dv.getInt32(pos, true) }); pos += 4; break;
        case KV.FLOAT32: case KV.POINTER: case KV.COLOR:
          need(4); entries.push({ key, type, value: buf.slice(pos, pos + 4) } as KVEntry); pos += 4; break;
        case KV.WSTRING: {
          const start = pos;
          while (pos + 1 < buf.length && !(buf[pos] === 0 && buf[pos + 1] === 0)) pos += 2;
          need(2);
          entries.push({ key, type, value: buf.slice(start, pos) }); pos += 2; break;
        }
        case KV.UINT64: need(8); entries.push({ key, type, value: dv.getBigUint64(pos, true) }); pos += 8; break;
        case KV.INT64: need(8); entries.push({ key, type, value: dv.getBigInt64(pos, true) }); pos += 8; break;
        default: throw new VdfError(`unknown type 0x${type.toString(16)} at ${pos - key.length - 2}`);
      }
    }
  };
  const root = readMap(0);
  return { root, trailing: buf.slice(pos) };
}

export function serializeBinaryVdf(doc: KVDocument | KVMap): Uint8Array {
  const root = 'root' in doc ? doc.root : doc;
  const trailing = 'root' in doc ? doc.trailing : new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  const u8 = (...b: number[]) => chunks.push(Uint8Array.from(b));
  const cstr = (s: string) => { chunks.push(enc.encode(s)); u8(0); };
  const writeMap = (m: KVMap) => {
    for (const e of m.entries) {
      u8(e.type); cstr(e.key);
      switch (e.type) {
        case KV.MAP: writeMap(e.value); break;
        case KV.STRING: cstr(e.value); break;
        case KV.INT32: { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, e.value | 0, true); chunks.push(b); break; }
        case KV.FLOAT32: case KV.POINTER: case KV.COLOR: chunks.push(e.value.subarray(0, 4)); break;
        case KV.WSTRING: chunks.push(e.value); u8(0, 0); break;
        case KV.UINT64: { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, e.value), true); chunks.push(b); break; }
        case KV.INT64: { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt.asIntN(64, e.value), true); chunks.push(b); break; }
      }
    }
    u8(m.end ?? KV.END);
  };
  writeMap(root);
  if (trailing.length) chunks.push(trailing);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ─── helpers (keys are case-insensitive in Steam: "AppName"/"appname", "OpenVR"/"openvr") ───

export function findEntry(m: KVMap, key: string): KVEntry | undefined {
  const k = key.toLowerCase();
  return m.entries.find((e) => e.key.toLowerCase() === k);
}
export function getString(m: KVMap, key: string): string | undefined {
  const e = findEntry(m, key); return e && e.type === KV.STRING ? e.value : undefined;
}
export function getInt(m: KVMap, key: string): number | undefined {
  const e = findEntry(m, key); return e && e.type === KV.INT32 ? e.value : undefined;
}
export function getMap(m: KVMap, key: string): KVMap | undefined {
  const e = findEntry(m, key); return e && e.type === KV.MAP ? e.value : undefined;
}
/** Sets a value, keeping the existing key's position and casing; appends otherwise. */
export function setEntry(m: KVMap, entry: KVEntry): void {
  const i = m.entries.findIndex((e) => e.key.toLowerCase() === entry.key.toLowerCase());
  if (i >= 0) m.entries[i] = { ...entry, key: m.entries[i].key } as KVEntry;
  else m.entries.push(entry);
}
export const str = (key: string, value: string): KVEntry => ({ key, type: KV.STRING, value });
export const int = (key: string, value: number): KVEntry => ({ key, type: KV.INT32, value: value | 0 });
export const map = (key: string, entries: KVEntry[]): KVEntry => ({ key, type: KV.MAP, value: { entries } });

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
