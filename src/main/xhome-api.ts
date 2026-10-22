// gssv REST API for xHome (Remote Play) and xCloud. Field names verified against MIT-licensed open-source
// clients (Geocld/XStreaming-desktop main/helpers/xcloudapi.ts, unknownskl/greenlight). See docs/research.
import type { ResolutionChoice, SessionKind } from '../shared/api';
import { XboxAuth, type Offering, type Region } from './xbox-auth';
import { expandCandidates, type RemoteCandidate } from './ice';
import { sleep } from './util';

export { expandCandidates } from './ice';

export type OsName = 'android' | 'windows' | 'tizen';
export interface PlayRequest { targetId: string; osName: OsName; width: number; height: number; locale: string }
export interface RawConsole { serverId: string; name: string; type: string; power: string; playPath: string | null }
export interface ApiBase { url: string; offering: Offering; region: string }

// Client identity. Defaults mirror the current official xbox.com web client structure
// (clientAppVersion 29.21.3 / web SDK 10.6.65, read from its public JS bundle 2026-10-22).
// Override with XENITH_APP_VERSION / XENITH_SDK_VERSION for experiments.
export const APP_VERSION = process.env.XENITH_APP_VERSION || '29.21.3';
const SDK_VERSION = process.env.XENITH_SDK_VERSION || '10.6.65';

export const deviceInfo = (osName: OsName, w: number, h: number) => JSON.stringify({
  appInfo: { env: { clientAppId: 'www.xbox.com', clientAppType: 'browser', clientAppVersion: APP_VERSION, clientSdkVersion: SDK_VERSION, httpEnvironment: 'prod', sdkInstallId: '' } },
  dev: {
    displayInfo: { dimensions: { heightInPixels: h, widthInPixels: w }, pixelDensity: { dpiX: 1, dpiY: 1 } },
    browser: { browserName: 'chrome', browserVersion: '156.0.0.0' },
    hw: { make: 'Microsoft', model: 'unknown', platformType: 'desktop', sdkType: 'web' },
    os: { name: osName, ver: '10.0', platform: 'desktop' },
  },
});

/** osName + X-MS-Device-Info dims per resolution setting (resolution alias signalling stays in the renderer engine). */
export function streamProfileFor(res: ResolutionChoice): { osName: OsName; width: number; height: number } {
  switch (res) {
    case '720': return { osName: 'android', width: 1280, height: 720 };
    case '1080': return { osName: 'windows', width: 1920, height: 1080 };
    default: return { osName: 'windows', width: 2560, height: 1440 }; // 'auto' | '1440'
  }
}

export class GssvError extends Error {
  constructor(public status: number, public path: string, public body: string, public code: string | null) {
    super(`${path} → ${status || 'network'}${code ? ' ' + code : ''}`);
    this.name = 'GssvError';
  }
}

const shortPath = (p: string) => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{id}').split('?')[0];

export class GssvApi {
  constructor(private auth: XboxAuth) {}

  async regions(offering: Offering): Promise<Region[]> { return (await this.auth.getGs(offering)).regions; }

  async base(offering: Offering, regionName?: string | null): Promise<ApiBase> {
    const gs = await this.auth.getGs(offering);
    const r = (regionName && gs.regions.find((x) => x.name === regionName)) || gs.regions.find((x) => x.isDefault) || gs.regions[0];
    if (!r) throw new GssvError(0, `${offering} regions`, '', 'no_region');
    return { url: r.baseUri.replace(/\/$/, ''), offering, region: r.name };
  }

  /** Authorised request; on 401 refreshes the gsToken once. Host stays fixed for the whole session. */
  async req(b: ApiBase, method: string, path: string, body?: unknown, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<any> {
    const label = `${method} ${shortPath(path)}`;
    for (let attempt = 0; ; attempt++) {
      const gs = await this.auth.getGs(b.offering, attempt > 0);
      let r: Response;
      try {
        const timeout = AbortSignal.timeout(20_000);
        r = await fetch(`${b.url}/${path.replace(/^\//, '')}`, {
          method,
          headers: { authorization: 'Bearer ' + gs.gsToken, 'content-type': 'application/json', accept: 'application/json', ...extra },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch {
        throw new GssvError(0, label, '', signal?.aborted ? 'aborted' : 'network');
      }
      const t = await r.text().catch(() => '');
      if (r.status === 401 && attempt === 0) continue;
      if (!r.ok) {
        let code: string | null = null;
        try { const j = JSON.parse(t); code = j?.code ?? j?.errorCode ?? j?.error?.code ?? j?.errorDetails?.code ?? null; } catch { /* not JSON */ }
        throw new GssvError(r.status, label, t.slice(0, 300), code === null ? null : String(code));
      }
      if (!t) return '';
      try { return JSON.parse(t); } catch { return t; }
    }
  }

  async consoles(b: ApiBase): Promise<RawConsole[]> {
    const j = await this.req(b, 'GET', 'v6/servers/home?mr=50', undefined, { 'X-MS-Device-Info': deviceInfo('windows', 1920, 1080) });
    return (j?.results || []).map((c: any) => ({ serverId: String(c.serverId), name: String(c.deviceName ?? c.serverId), type: String(c.consoleType ?? ''), power: String(c.powerState ?? 'Unknown'), playPath: c.playPath || null }));
  }

  async activeSessions(b: ApiBase, kind: SessionKind): Promise<any[]> {
    const j = await this.req(b, 'GET', `v5/sessions/${kind}/active`);
    return Array.isArray(j) ? j : Array.isArray(j?.results) ? j.results : [];
  }

  async titles(b: ApiBase): Promise<any[]> {
    const j = await this.req(b, 'GET', 'v2/titles');
    return Array.isArray(j?.results) ? j.results : [];
  }

  async recentTitles(b: ApiBase): Promise<any[]> {
    const j = await this.req(b, 'GET', 'v2/titles/mru?mr=25');
    return Array.isArray(j?.results) ? j.results : [];
  }

  waittime(b: ApiBase, titleId: string, signal?: AbortSignal) { return this.req(b, 'GET', `v1/waittime/${encodeURIComponent(titleId)}`, undefined, {}, signal); }

  async play(b: ApiBase, kind: SessionKind, s: PlayRequest, signal?: AbortSignal): Promise<string> {
    const body = {
      titleId: kind === 'cloud' ? s.targetId : '', systemUpdateGroup: '', clientSessionId: '',
      serverId: kind === 'home' ? s.targetId : '', fallbackRegionNames: [],
      settings: { nanoVersion: 'V3;WebrtcTransport.dll', enableTextToSpeech: false, highContrast: 0, locale: s.locale,
        useIceConnection: false, timezoneOffsetMinutes: -new Date().getTimezoneOffset(), sdkType: 'web', osName: s.osName, magnifier: false, enableOptionalDataCollection: false },
    };
    const j = await this.req(b, 'POST', `v5/sessions/${kind}/play`, body, { 'X-MS-Device-Info': deviceInfo(s.osName, s.width, s.height) }, signal);
    if (!j?.sessionPath) throw new GssvError(200, `POST v5/sessions/${kind}/play`, '', 'no_session_path');
    return String(j.sessionPath).replace(/^\//, ''); // "v5/sessions/home/<id>"
  }

  state(b: ApiBase, p: string, signal?: AbortSignal) { return this.req(b, 'GET', `${p}/state`, undefined, {}, signal); }
  connect(b: ApiBase, p: string, userToken: string, signal?: AbortSignal) { return this.req(b, 'POST', `${p}/connect`, { userToken }, {}, signal); }
  keepalive(b: ApiBase, p: string) { return this.req(b, 'POST', `${p}/keepalive`); }
  stop(b: ApiBase, p: string) { return this.req(b, 'DELETE', p); }

  async sdp(b: ApiBase, p: string, offer: string, signal?: AbortSignal): Promise<{ sdp: string; [k: string]: unknown }> {
    await this.req(b, 'POST', `${p}/sdp`, {
      messageType: 'offer', sdp: offer,
      configuration: {
        chatConfiguration: { bytesPerSample: 2, expectedClipDurationMs: 20, format: { codec: 'opus', container: 'webm' }, numChannels: 1, sampleFrequencyHz: 24000 },
        chat: { minVersion: 1, maxVersion: 1 }, control: { minVersion: 1, maxVersion: 3 }, input: { minVersion: 1, maxVersion: 8 }, message: { minVersion: 1, maxVersion: 1 },
      },
    }, {}, signal);
    for (let i = 0; i < 60 && !signal?.aborted; i++) {
      const r = await this.req(b, 'GET', `${p}/sdp`, undefined, {}, signal);
      if (r && r.exchangeResponse) return JSON.parse(r.exchangeResponse);
      await sleep(1000, signal);
    }
    throw new GssvError(0, 'GET sdp', '', signal?.aborted ? 'aborted' : 'sdp_timeout');
  }

  async ice(b: ApiBase, p: string, local: unknown[], preferIPv6 = false, signal?: AbortSignal): Promise<RemoteCandidate[]> {
    await this.req(b, 'POST', `${p}/ice`, { messageType: 'iceCandidate', candidate: local }, {}, signal);
    for (let i = 0; i < 60 && !signal?.aborted; i++) {
      const r = await this.req(b, 'GET', `${p}/ice`, undefined, {}, signal);
      if (r && r.exchangeResponse) return expandCandidates(JSON.parse(r.exchangeResponse), preferIPv6);
      await sleep(1000, signal);
    }
    throw new GssvError(0, 'GET ice', '', signal?.aborted ? 'aborted' : 'ice_timeout');
  }
}
