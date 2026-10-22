// Xenith auth spike: MSA device-code -> Xbox user token -> XSTS (gssv) -> xHome gsToken -> console list.
// Secrets never printed; refresh token stored with Windows DPAPI (CurrentUser).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = join(process.env.LOCALAPPDATA, 'Xenith');
const statusFile = join(dir, 'auth-status.json');
const status = (o) => writeFileSync(statusFile, JSON.stringify({ ...o, at: new Date().toISOString() }, null, 2));
const CLIENT_ID = '000000004C12AE6F'; // public Xbox app client id used by open-source Xbox Live libs
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';
const form = (o) => new URLSearchParams(o).toString();
const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers, body });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  return { ok: r.ok, status: r.status, j };
};
const dpapiSave = (name, secret) => {
  const ps = `$s=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; $b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,'CurrentUser'); [IO.File]::WriteAllBytes('${join(dir, name).replace(/'/g, "''")}',$b)`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { input: secret });
  if (r.status !== 0) throw new Error('DPAPI save failed');
};
try {
  const dc = await post('https://login.live.com/oauth20_connect.srf', form({ client_id: CLIENT_ID, scope: SCOPE, response_type: 'device_code' }), { 'content-type': 'application/x-www-form-urlencoded' });
  if (!dc.ok) throw new Error('device_code: ' + dc.status + ' ' + JSON.stringify(dc.j));
  const { device_code, user_code, verification_uri, interval = 5, expires_in } = dc.j;
  status({ stage: 'waiting_user', user_code, verification_uri, expires_in });
  let tok; const deadline = Date.now() + expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((s) => setTimeout(s, interval * 1000));
    const t = await post('https://login.live.com/oauth20_token.srf', form({ client_id: CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code }), { 'content-type': 'application/x-www-form-urlencoded' });
    if (t.ok) { tok = t.j; break; }
    if (t.j.error && t.j.error !== 'authorization_pending' && t.j.error !== 'slow_down') throw new Error('token: ' + t.j.error);
  }
  if (!tok) throw new Error('device code expired');
  dpapiSave('msa_refresh.bin', tok.refresh_token);
  status({ stage: 'msa_ok' });
  const ut = await post('https://user.auth.xboxlive.com/user/authenticate', JSON.stringify({ RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT', Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: tok.access_token } }), { 'content-type': 'application/json', 'x-xbl-contract-version': '1' });
  if (!ut.ok) throw new Error('user token ' + ut.status);
  const xsts = await post('https://xsts.auth.xboxlive.com/xsts/authorize', JSON.stringify({ RelyingParty: 'http://gssv.xboxlive.com/', TokenType: 'JWT', Properties: { UserTokens: [ut.j.Token], SandboxId: 'RETAIL' } }), { 'content-type': 'application/json', 'x-xbl-contract-version': '1' });
  if (!xsts.ok) throw new Error('xsts ' + xsts.status + ' ' + JSON.stringify(xsts.j).slice(0, 200));
  const gs = await post('https://xhome.gssv-play-prod.xboxlive.com/v2/login/user', JSON.stringify({ offeringId: 'xhome', token: xsts.j.Token }), { 'content-type': 'application/json', 'x-gssv-client': 'XboxComBrowser' });
  if (!gs.ok) throw new Error('gssv login ' + gs.status + ' ' + JSON.stringify(gs.j).slice(0, 200));
  const regions = gs.j.offeringSettings?.regions || [];
  const region = regions.find((x) => x.isDefault) || regions[0];
  const sv = await fetch(region.baseUri + '/v6/servers/home', { headers: { authorization: 'Bearer ' + gs.j.gsToken } });
  const servers = await sv.json();
  status({ stage: 'done', gamertagHash: (ut.j.DisplayClaims?.xui?.[0]?.uhs || '').slice(0, 4) + '…', region: region.name, consoles: (servers.results || []).map((c) => ({ name: c.deviceName, type: c.consoleType, power: c.powerState, streaming: c.playPath, serverId: c.serverId })) });
} catch (e) { status({ stage: 'error', message: String(e.message || e) }); }
