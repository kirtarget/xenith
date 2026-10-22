// Redaction for logs and exported diagnostics. Pure module (unit-tested).
// Never let tokens, refresh tokens, Authorization headers or SDP ice-pwd reach disk.

const SECRET_KEY = /(token|authorization|refresh|password|secret|rpsticket|ice-?pwd|cookie|device_?code|^sdp$|^offer$|^answer$)/i;

export function redact(s: string): string {
  return s
    // SDP credentials (also inside JSON-escaped SDP where newlines are literal "\r\n")
    .replace(/(a=ice-pwd:)[A-Za-z0-9+/=]+/g, '$1[redacted]')
    // Authorization header values
    .replace(/\b(Bearer|XBL3\.0)\s+[^\s"',]+/gi, '$1 [redacted]')
    // JWT-shaped tokens
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[jwt]')
    // MSA tokens (refresh tokens look like "M.C5xx_BAY.0.U.-…")
    .replace(/\bM\.[A-Za-z0-9]+_[A-Za-z0-9!*$._-]+/g, '[msa-token]')
    // JSON fields that carry tokens
    .replace(/("(?:[A-Za-z_]*[Tt]oken|RpsTicket|device_code|refresh_token|access_token)"\s*:\s*")[^"]*"/g, '$1[redacted]"')
    // any other long opaque blob (access tokens are base64-ish and > 300 chars)
    .replace(/[A-Za-z0-9+/_!*$=-]{48,}/g, (m) => `[redacted:${m.length}]`);
}

/** Deep copy with secret-looking keys removed and every string redacted. */
export function scrub(v: unknown, depth = 0): unknown {
  if (v instanceof Error) return { name: v.name, message: redact(v.message), code: (v as any).code, status: (v as any).status };
  if (depth > 6) return '[deep]';
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => scrub(x, depth + 1));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEY.test(k) ? '[redacted]' : scrub(x, depth + 1);
    return o;
  }
  if (typeof v === 'string') return redact(v);
  return v;
}
