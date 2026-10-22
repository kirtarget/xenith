// Remote ICE candidate post-processing (pure, unit-tested).
// Idea credited to Geocld/XStreaming-desktop (MIT) main/helpers/xcloudapi.ts checkIce(): consoles
// advertise a Teredo IPv6 address; the embedded IPv4 client address/port are added as extra host
// candidates, then all candidates are renumbered with the first one at top priority.
import { Address6 } from 'ip-address';
import type { IceCandidateInit } from '../shared/api';

export interface RemoteCandidate extends IceCandidateInit { messageType: 'iceCandidate' }

const RE = /^(?:a=)?candidate:\d+ \d+ (\w+) \d+ (\S+) (\d+) (.*)$/;

export function expandCandidates(list: readonly any[], preferIPv6 = false): RemoteCandidate[] {
  const mk = (candidate: string): RemoteCandidate => ({ candidate, messageType: 'iceCandidate', sdpMLineIndex: '0', sdpMid: '0' });
  const parsed: { ip: string; port: string; rest: string }[] = [];
  for (const c of Array.isArray(list) ? list : []) {
    const cand = typeof c?.candidate === 'string' ? c.candidate.trim() : '';
    if (!cand || cand === 'a=end-of-candidates') continue;
    const m = RE.exec(cand);
    if (!m) continue;
    const [, , ip, port, rest] = m;
    if (ip.toLowerCase().startsWith('2001:')) {
      try {
        const t = new Address6(ip).inspectTeredo();
        parsed.push({ ip: t.client4, port: '9002', rest: 'typ host' });
        parsed.push({ ip: t.client4, port: String(t.udpPort), rest: 'typ host' });
      } catch { /* not a Teredo address */ }
    }
    parsed.push({ ip, port, rest: rest.trim() });
  }
  // de-duplicate identical ip:port pairs (e.g. Teredo port 9002 twice)
  const seen = new Set<string>();
  let uniq = parsed.filter((p) => { const k = `${p.ip}|${p.port}|${p.rest}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (preferIPv6) {
    const v6 = uniq.filter((p) => p.ip.includes(':')), v4 = uniq.filter((p) => !p.ip.includes(':'));
    uniq = [...v6, ...v4];
  }
  const out = uniq.map((p, i) => mk(`a=candidate:${i + 1} 1 UDP ${i === 0 ? 2130706431 : 1} ${p.ip} ${p.port} ${p.rest}`));
  out.push(mk('a=end-of-candidates'));
  return out;
}
