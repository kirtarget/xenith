// Microsoft account → Xbox Live → gssv (xHome / xCloud) token chain.
//   MSA (login.live.com, device code or refresh token) → Xbox user token → XSTS
//   → POST https://{offering}.gssv-play-prod.xboxlive.com/v2/login/user → gsToken + regions.
// Client id: public Xbox app id used by open-source Xbox Live libraries (live.com OAuth, device-code capable).
// xCloud offerings (xgpuweb, fallback xgpuwebf2p) as used by Geocld/XStreaming-desktop (MIT).
//
// Refresh tokens ROTATE on every use, so every refresh-token use is serialised: an in-process mutex
// plus a lock file in userData/secure (other Xenith processes share the same token). Short-lived
// tokens are cached (memory + encrypted token_cache.bin) until shortly before expiry.
import { closeSync, openSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { LoginCode } from '../shared/api';
import { deleteSecret, importLegacyRefreshToken, loadSecret, markLegacyImportDone, saveSecret, secureDir } from './secure-store';
import { log, logWarn } from './log';
import { sleep } from './util';

export const CLIENT_ID = '000000004C12AE6F';
export const SCOPE_XBL = 'service::user.auth.xboxlive.com::MBI_SSL';
export const SCOPE_TRANSFER = 'service::http://Passport.NET/purpose::PURPOSE_XBOX_CLOUD_CONSOLE_TRANSFER_TOKEN';
const TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
const CONNECT_URL = 'https://login.live.com/oauth20_connect.srf';
const RP_GSSV = 'http://gssv.xboxlive.com/';
const RP_XBL = 'http://xboxlive.com';
const MIN_VALID = 5 * 60_000;

export type AuthErrorCode = 'no_account' | 'refresh_failed' | 'network' | 'http' | 'no_cloud' | 'xsts_denied';
export class AuthError extends Error {
  constructor(public code: AuthErrorCode, message: string, public status?: number) { super(message); this.name = 'AuthError'; }
}

export type Offering = 'xhome' | 'xgpuweb' | 'xgpuwebf2p';
export interface Region { name: string; baseUri: string; isDefault: boolean }
export interface GsSession { offering: Offering; gsToken: string; regions: Region[]; expiresAt: number }
export interface XstsToken { token: string; expiresAt: number; uhs: string | null; gtg: string | null; xid: string | null }
export interface ProfileInfo { gamertag: string | null; avatarUrl: string | null; xuid: string | null }
export interface CloudEntitlement { hasCloud: boolean; offering: Offering | null }
export type LoginStatus = 'waiting' | 'done' | 'expired' | 'error';

interface Timed { token: string; expiresAt: number }
interface TokenCache { v: 1; msa: Record<string, Timed>; user: Timed | null; xsts: Record<string, XstsToken>; gs: Partial<Record<Offering, GsSession>> }
const emptyCache = (): TokenCache => ({ v: 1, msa: {}, user: null, xsts: {}, gs: {} });

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const JSON_XBL = { 'content-type': 'application/json', accept: 'application/json', 'x-xbl-contract-version': '1' };

interface HttpResult { status: number; ok: boolean; json: any }
async function http(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<HttpResult> {
  let r: Response;
  try { r = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) }); }
  catch (e: any) { throw new AuthError('network', `${new URL(url).host}: ${e?.cause?.code || e?.name || 'network error'}`); }
  const text = await r.text().catch(() => '');
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, ok: r.ok, json };
}

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const res = this.tail.then(fn, fn);
    this.tail = res.catch(() => undefined);
    return res;
  }
}

/** Cross-process lock (exclusive-create lock file, stale after 30 s). */
async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = join(secureDir(), 'refresh.lock');
  const t0 = Date.now();
  let fd: number | null = null;
  while (fd === null) {
    try { fd = openSync(lock, 'wx'); try { writeSync(fd, String(process.pid)); } catch { /* ignore */ } }
    catch (e: any) {
      if (e?.code !== 'EEXIST') break;
      try { if (Date.now() - statSync(lock).mtimeMs > 30_000) { unlinkSync(lock); continue; } } catch { continue; }
      if (Date.now() - t0 > 20_000) { logWarn('auth.lock_timeout'); break; }
      await sleep(150);
    }
  }
  try { return await fn(); }
  finally { if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } try { unlinkSync(lock); } catch { /* ignore */ } } }
}

export class XboxAuth {
  private cache: TokenCache = emptyCache();
  private cacheLoaded = false;
  private refreshLock = new Mutex();
  private inflight = new Map<string, Promise<unknown>>();
  private profileCache: ProfileInfo | null = null;
  private cloudCache: { at: number; value: CloudEntitlement } | null = null;
  private login: AbortController | null = null;

  // ─── cache ───
  private loadCache(force = false) {
    if (this.cacheLoaded && !force) return;
    this.cacheLoaded = true;
    try {
      const raw = loadSecret('token_cache');
      if (raw) { const j = JSON.parse(raw); if (j?.v === 1) this.cache = { ...emptyCache(), ...j }; }
    } catch (e) { logWarn('auth.cache_unreadable', e); }
  }
  private saveCache() {
    try { saveSecret('token_cache', JSON.stringify(this.cache)); } catch (e) { logWarn('auth.cache_save_failed', e); }
  }
  private dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const p = this.inflight.get(key) as Promise<T> | undefined;
    if (p) return p;
    const n = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, n);
    return n;
  }

  hasAccount(): boolean {
    try { return !!(loadSecret('msa_refresh') || importLegacyRefreshToken()); } catch (e) { logWarn('auth.has_account_failed', e); return false; }
  }

  // ─── MSA ───
  /** MSA access token for `scope`; uses (and rotates) the refresh token under the mutex + file lock. */
  async msaToken(scope: string, minValidMs = MIN_VALID): Promise<string> {
    this.loadCache();
    const c = this.cache.msa[scope];
    if (c && c.expiresAt - Date.now() > minValidMs) return c.token;
    return this.refreshLock.run(() => withFileLock(async () => {
      this.loadCache(true); // another waiter or another Xenith process may have refreshed meanwhile
      const c2 = this.cache.msa[scope];
      if (c2 && c2.expiresAt - Date.now() > minValidMs) return c2.token;
      const rt = loadSecret('msa_refresh') || importLegacyRefreshToken();
      if (!rt) throw new AuthError('no_account', 'Not signed in');
      const r = await http(TOKEN_URL, { method: 'POST', headers: FORM, body: form({ client_id: CLIENT_ID, grant_type: 'refresh_token', scope, refresh_token: rt }) });
      if (!r.ok || !r.json?.access_token) {
        logWarn('auth.refresh_failed', { status: r.status, error: r.json?.error });
        throw new AuthError('refresh_failed', 'Microsoft sign-in expired: ' + (r.json?.error || r.status), r.status);
      }
      if (r.json.refresh_token) saveSecret('msa_refresh', r.json.refresh_token); // rotated: persist immediately
      this.cache.msa[scope] = { token: r.json.access_token, expiresAt: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 };
      this.saveCache();
      log('auth.refresh_ok', { scope: scope === SCOPE_TRANSFER ? 'transfer' : 'xbl', rotated: !!r.json.refresh_token });
      return r.json.access_token as string;
    }));
  }

  // ─── Xbox Live ───
  private userToken(): Promise<string> {
    this.loadCache();
    const u = this.cache.user;
    if (u && u.expiresAt - Date.now() > MIN_VALID) return Promise.resolve(u.token);
    return this.dedupe('user', async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const rps = await this.msaToken(SCOPE_XBL);
        const r = await http('https://user.auth.xboxlive.com/user/authenticate', {
          method: 'POST', headers: JSON_XBL,
          body: JSON.stringify({ RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT', Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: rps } }),
        });
        if (r.ok && r.json?.Token) {
          this.cache.user = { token: r.json.Token, expiresAt: Date.parse(r.json.NotAfter) || Date.now() + 12 * 3600_000 };
          this.saveCache();
          return r.json.Token as string;
        }
        if ((r.status === 400 || r.status === 401) && attempt === 0) { delete this.cache.msa[SCOPE_XBL]; continue; }
        throw new AuthError('http', `user.auth.xboxlive.com ${r.status}`, r.status);
      }
      throw new AuthError('http', 'user.auth.xboxlive.com failed');
    });
  }

  xsts(rp: string): Promise<XstsToken> {
    this.loadCache();
    const c = this.cache.xsts[rp];
    if (c && c.expiresAt - Date.now() > MIN_VALID) return Promise.resolve(c);
    return this.dedupe('xsts:' + rp, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const ut = await this.userToken();
        const r = await http('https://xsts.auth.xboxlive.com/xsts/authorize', {
          method: 'POST', headers: JSON_XBL,
          body: JSON.stringify({ RelyingParty: rp, TokenType: 'JWT', Properties: { UserTokens: [ut], SandboxId: 'RETAIL' } }),
        });
        if (r.ok && r.json?.Token) {
          const xui = r.json.DisplayClaims?.xui?.[0] || {};
          const t: XstsToken = { token: r.json.Token, expiresAt: Date.parse(r.json.NotAfter) || Date.now() + 12 * 3600_000, uhs: xui.uhs ?? null, gtg: xui.gtg ?? null, xid: xui.xid ?? null };
          this.cache.xsts[rp] = t;
          this.saveCache();
          return t;
        }
        if (r.status === 401 && r.json?.XErr) throw new AuthError('xsts_denied', `XSTS denied (XErr ${r.json.XErr})`, 401);
        if ((r.status === 400 || r.status === 401) && attempt === 0) { this.cache.user = null; continue; }
        throw new AuthError('http', `xsts ${r.status}`, r.status);
      }
      throw new AuthError('http', 'xsts failed');
    });
  }

  // ─── gssv ───
  getGs(offering: Offering = 'xhome', force = false): Promise<GsSession> {
    this.loadCache();
    const c = this.cache.gs[offering];
    if (!force && c && c.expiresAt - Date.now() > MIN_VALID) return Promise.resolve(c);
    return this.dedupe('gs:' + offering, async () => {
      const x = await this.xsts(RP_GSSV);
      const r = await http(`https://${offering}.gssv-play-prod.xboxlive.com/v2/login/user`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-gssv-client': 'XboxComBrowser' },
        body: JSON.stringify({ offeringId: offering, token: x.token }),
      });
      if (!r.ok || !r.json?.gsToken) {
        if (offering !== 'xhome' && r.status >= 400 && r.status < 500) throw new AuthError('no_cloud', `${offering} login ${r.status}`, r.status);
        if (r.status === 401) { delete this.cache.xsts[RP_GSSV]; this.saveCache(); }
        throw new AuthError('http', `${offering} login ${r.status}`, r.status);
      }
      const gs: GsSession = {
        offering, gsToken: r.json.gsToken,
        regions: (r.json.offeringSettings?.regions || []).map((g: any) => ({ name: String(g.name), baseUri: String(g.baseUri), isDefault: !!g.isDefault })),
        expiresAt: Date.now() + (Number(r.json.durationInSeconds) || 3600) * 1000,
      };
      this.cache.gs[offering] = gs;
      this.saveCache();
      log('auth.gs_ok', { offering, regions: gs.regions.length });
      return gs;
    });
  }

  /** Passport transfer token required by POST …/connect when a session reaches ReadyToConnect. */
  getTransferToken(): Promise<string> { return this.msaToken(SCOPE_TRANSFER, 10 * 60_000); }

  /** xCloud entitlement: Game Pass Ultimate accounts can log into offering xgpuweb; others may still get xgpuwebf2p (free titles). */
  cloudEntitlement(force = false): Promise<CloudEntitlement> {
    if (!force && this.cloudCache && Date.now() - this.cloudCache.at < 10 * 60_000) return Promise.resolve(this.cloudCache.value);
    return this.dedupe('cloud', async () => {
      let value: CloudEntitlement = { hasCloud: false, offering: null };
      try { await this.getGs('xgpuweb', force); value = { hasCloud: true, offering: 'xgpuweb' }; }
      catch (e) {
        if (!(e instanceof AuthError) || e.code === 'network' || e.code === 'no_account' || e.code === 'refresh_failed') throw e;
        log('auth.xgpuweb_denied', { code: e.code, status: e.status });
        try { await this.getGs('xgpuwebf2p', force); value = { hasCloud: false, offering: 'xgpuwebf2p' }; }
        catch (e2) { if (e2 instanceof AuthError && (e2.code === 'network' || e2.code === 'refresh_failed')) throw e2; }
      }
      this.cloudCache = { at: Date.now(), value };
      return value;
    });
  }

  // ─── profile ───
  profile(force = false): Promise<ProfileInfo> {
    if (this.profileCache && !force) return Promise.resolve(this.profileCache);
    return this.dedupe('profile', async () => {
      const x = await this.xsts(RP_XBL);
      let gamertag = x.gtg, avatarUrl: string | null = null;
      try {
        const r = await http('https://profile.xboxlive.com/users/me/profile/settings?settings=GameDisplayPicRaw,Gamertag', {
          headers: { authorization: `XBL3.0 x=${x.uhs};${x.token}`, 'x-xbl-contract-version': '3', accept: 'application/json', 'accept-language': 'en-US' },
        });
        if (r.ok) {
          for (const s of r.json?.profileUsers?.[0]?.settings || []) {
            if (s?.id === 'Gamertag' && s.value) gamertag = String(s.value);
            if (s?.id === 'GameDisplayPicRaw' && s.value) avatarUrl = String(s.value);
          }
        } else logWarn('auth.profile_http', { status: r.status });
      } catch (e) { logWarn('auth.profile_failed', e); }
      this.profileCache = { gamertag, avatarUrl, xuid: x.xid };
      return this.profileCache;
    });
  }

  // ─── device-code sign-in ───
  async startDeviceLogin(onStatus: (s: LoginStatus, message?: string) => void): Promise<LoginCode> {
    this.cancelLogin();
    const r = await http(CONNECT_URL, { method: 'POST', headers: FORM, body: form({ client_id: CLIENT_ID, scope: SCOPE_XBL, response_type: 'device_code' }) });
    if (!r.ok || !r.json?.device_code) throw new AuthError('http', `device code ${r.status} ${r.json?.error || ''}`.trim(), r.status);
    const { device_code, user_code, verification_uri } = r.json;
    const interval = Math.max(1, Number(r.json.interval) || 5);
    const expiresAt = Date.now() + (Number(r.json.expires_in) || 900) * 1000;
    const abort = new AbortController();
    this.login = abort;
    log('auth.login_started', { expiresIn: Math.round((expiresAt - Date.now()) / 1000) });
    queueMicrotask(() => onStatus('waiting'));
    void this.pollDeviceLogin(String(device_code), interval * 1000, expiresAt, abort.signal, onStatus);
    return { userCode: String(user_code), verificationUri: String(verification_uri || 'https://www.microsoft.com/link'), expiresAt };
  }

  private async pollDeviceLogin(deviceCode: string, waitMs: number, expiresAt: number, signal: AbortSignal, onStatus: (s: LoginStatus, m?: string) => void) {
    try {
      while (Date.now() < expiresAt) {
        await sleep(waitMs, signal);
        if (signal.aborted) return;
        const t = await http(TOKEN_URL, { method: 'POST', headers: FORM, body: form({ client_id: CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode }) });
        if (signal.aborted) return;
        if (t.ok && t.json?.refresh_token) {
          await this.refreshLock.run(() => withFileLock(async () => {
            saveSecret('msa_refresh', t.json.refresh_token);
            markLegacyImportDone();
            this.cache = emptyCache();
            if (t.json.access_token) this.cache.msa[SCOPE_XBL] = { token: t.json.access_token, expiresAt: Date.now() + (Number(t.json.expires_in) || 3600) * 1000 };
            this.saveCache();
          }));
          this.profileCache = null; this.cloudCache = null;
          log('auth.login_done');
          onStatus('done');
          return;
        }
        const err = t.json?.error;
        if (err === 'authorization_pending') continue;
        if (err === 'slow_down') { waitMs += 5000; continue; }
        if (err === 'expired_token') { onStatus('expired'); return; }
        logWarn('auth.login_error', { status: t.status, error: err });
        onStatus('error', String(err || t.status));
        return;
      }
      onStatus('expired');
    } catch (e: any) {
      if (!signal.aborted) { logWarn('auth.login_error', e); onStatus('error', e?.code || 'network'); }
    } finally {
      if (this.login?.signal === signal) this.login = null;
    }
  }

  cancelLogin() { this.login?.abort(); this.login = null; }

  /** Deletes stored tokens (user action only). */
  signOut() {
    this.cancelLogin();
    deleteSecret('msa_refresh');
    deleteSecret('token_cache');
    markLegacyImportDone();
    this.cache = emptyCache();
    this.profileCache = null;
    this.cloudCache = null;
    this.inflight.clear();
    log('auth.signed_out');
  }
}
