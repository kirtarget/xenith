// SDP helpers (offer munging + codec description).

/** Replace/insert `b=AS:<kbps>` in the m=video section (RFC 4566 order: after i=/c=). */
export function setVideoBandwidth(sdp: string, kbps: number): string {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  const start = lines.findIndex((l) => l.startsWith('m=video'));
  if (start < 0) return sdp;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('m='));
  if (end < 0) end = lines.length;
  const section = lines.slice(start + 1, end).filter((l) => !l.startsWith('b=AS:') && !l.startsWith('b=TIAS:'));
  let at = 0;
  while (at < section.length && (section[at].startsWith('i=') || section[at].startsWith('c='))) at++;
  section.splice(at, 0, `b=AS:${Math.round(kbps)}`);
  return [...lines.slice(0, start + 1), ...section, ...lines.slice(end)].join(eol);
}

const H264_PROFILES: Record<number, string> = { 0x42: 'Baseline', 0x4d: 'Main', 0x58: 'Extended', 0x64: 'High', 0x6e: 'High 10', 0x7a: 'High 4:2:2', 0xf4: 'High 4:4:4' };

/** "H.264 Main 4.2" from codec stats (mimeType + sdpFmtpLine). Returns what the fmtp says, nothing inferred. */
export function describeCodec(mimeType: string | undefined, fmtp: string | undefined): string | null {
  if (!mimeType) return null;
  const name = mimeType.split('/')[1] || mimeType;
  if (name.toUpperCase() !== 'H264') return name.toUpperCase() === 'H265' ? 'H.265' : name;
  const m = /profile-level-id=([0-9a-fA-F]{6})/.exec(fmtp || '');
  if (!m) return 'H.264';
  const idc = parseInt(m[1].slice(0, 2), 16);
  const constraints = parseInt(m[1].slice(2, 4), 16);
  const level = parseInt(m[1].slice(4, 6), 16);
  let profile = H264_PROFILES[idc] || `profile 0x${m[1].slice(0, 2)}`;
  if (idc === 0x42 && constraints & 0x40) profile = 'Constrained Baseline';
  const lv = level === 9 ? '1b' : (level / 10).toFixed(1).replace(/\.0$/, '');
  return `H.264 ${profile} ${lv}`;
}
