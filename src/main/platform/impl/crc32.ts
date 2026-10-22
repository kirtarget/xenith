// CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320) — the same CRC that zlib / PNG / Steam use.
// Written in-house to avoid a dependency. Check value: crc32("123456789") === 0xCBF43926.

const TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array | string): number {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
