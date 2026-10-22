// READ-ONLY live check of the core against the real account (no play sessions are started).
// Run: node tools/core-test/live.mjs   (bundles this file and runs it as an Electron main process)
// Prints a JSON summary without tokens. Uses the shared secure store in %APPDATA%\xenith\secure.
import { app } from 'electron';
import { join } from 'node:path';
import { setConsoleLogging, currentLogFile } from '../../src/main/log';

app.setPath('userData', join(app.getPath('appData'), 'xenith'));
setConsoleLogging(false);

const out: Record<string, unknown> = {};
const step = async (name: string, fn: () => Promise<unknown>) => {
  const t0 = Date.now();
  try { out[name] = { ok: true, ms: Date.now() - t0, ...(await fn() as object) }; (out[name] as any).ms = Date.now() - t0; }
  catch (e: any) { out[name] = { ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 200) }; }
};

app.whenReady().then(async () => {
  const { SettingsStore } = await import('../../src/main/settings');
  const { XenithCore } = await import('../../src/main/core');
  const { onEvent } = await import('../../src/main/events');
  const events: string[] = [];
  onEvent((ev) => events.push(ev.type));
  const core = new XenithCore(new SettingsStore(), { kind: null, targetId: null });
  const withLogin = process.argv.includes('--device-code');

  await step('account', async () => {
    const a = await core.account();
    return { signedIn: a.signedIn, gamertag: a.gamertag ? `${a.gamertag.slice(0, 2)}…(${a.gamertag.length})` : null, avatar: a.avatarUrl ? new URL(a.avatarUrl).host : null, hasCloud: a.hasCloud };
  });
  await step('consoles', async () => {
    const l = await core.consoles(true);
    return { count: l.length, list: l.map((c) => ({ name: c.name, type: c.type, power: c.power, ready: c.remotePlayReady, id: c.serverId.slice(0, 4) + '…' })) };
  });
  await step('consolesCached', async () => ({ count: (await core.consoles()).length }));
  await step('homeRegions', async () => ({ regions: (await core.api.regions('xhome')).map((r) => `${r.name}${r.isDefault ? '*' : ''}`) }));
  await step('cloudRegions', async () => ({ regions: (await core.regions()).map((r) => `${r.name}${r.isDefault ? '*' : ''}`) }));
  await step('activeHome', async () => {
    const b = await core.api.base('xhome');
    const a = await core.api.activeSessions(b, 'home');
    return { count: a.length, keys: a[0] ? Object.keys(a[0]) : [] };
  });
  await step('cloudTitles', async () => {
    const t = await core.cloudTitles(true);
    return {
      count: t.length, withCover: t.filter((x) => x.coverUrl).length, withHero: t.filter((x) => x.heroUrl).length,
      mkb: t.filter((x) => x.supportsMouseKeyboard).length, sample: t.slice(0, 5).map((x) => `${x.titleId} | ${x.name} | ${x.publisher}`),
      heroSample: t[0]?.heroUrl?.slice(0, 80) ?? null, coverSample: t[0]?.coverUrl?.slice(0, 80) ?? null,
    };
  });
  await step('cloudTitlesCached', async () => ({ count: (await core.cloudTitles()).length }));
  await step('catalogImageFields', async () => {
    const t = core.catalog.find((await core.cloudTitles())[0]?.titleId ?? '');
    if (!t) return { none: true };
    const r = await fetch('https://catalog.gamepass.com/v3/products?market=US&language=en-US&hydration=RemoteLowJade0', {
      method: 'POST', headers: { 'content-type': 'application/json', 'calling-app-name': 'Xbox Cloud Gaming Web', 'calling-app-version': '29.21.3', 'ms-cv': '0' },
      body: JSON.stringify({ Products: [t.productId] }),
    });
    const j: any = await r.json();
    const p = j.Products?.[t.productId] || {};
    return { keys: Object.keys(p).filter((k) => k.startsWith('Image')) };
  });
  await step('rawTitleShape', async () => {
    const ent = await core.auth.cloudEntitlement();
    if (!ent.offering) return { none: true };
    const r = await core.api.titles(await core.api.base(ent.offering));
    return { offering: ent.offering, raw: r.length, entitled: r.filter((x) => x?.details?.hasEntitlement !== false).length, detailKeys: Object.keys(r[0]?.details || {}), inputTypes: r[0]?.details?.supportedInputTypes };
  });
  if (withLogin) {
    await step('deviceCode', async () => {
      const c = await core.loginStart();
      core.loginCancel();
      return { userCodeLen: c.userCode.length, verificationUri: c.verificationUri, expiresInSec: Math.round((c.expiresAt - Date.now()) / 1000) };
    });
  }
  out.history = { count: core.historyList().length };
  out.events = events;
  out.logFile = currentLogFile();
  process.stdout.write('\nLIVE-CHECK ' + JSON.stringify(out, null, 2) + '\n');
  app.exit(0);
});
