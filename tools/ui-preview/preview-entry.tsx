// ⚠ PREVIEW ONLY — entry for the dev harness. Never part of the app build.
import { params, scenario } from './install';
import '../../src/renderer/main';
import { getState, setState, subscribe, type SettingsSection } from '../../src/renderer/state/store';
import { go } from '../../src/renderer/state/actions';
import { connect, disconnect, toggleOverlay } from '../../src/renderer/state/session';
import { fakeEmit } from './fake-api';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = (pred: () => boolean) => new Promise<void>(res => {
  if (pred()) return res();
  const off = subscribe(() => { if (pred()) { off(); res(); } });
});
const markReady = () => { (window as unknown as { __previewReady: boolean }).__previewReady = true; };

async function run() {
  await until(() => getState().booted);
  const sc = scenario;
  if (params.get('input') === 'gamepad') { document.documentElement.dataset.input = 'gamepad'; setState({ input: 'gamepad' }); }
  if (sc.startsWith('login')) {
    await until(() => getState().login.status === 'waiting' || getState().login.status === 'error');
    if (sc === 'login-expired') setState(s => ({ login: { ...s.login, status: 'expired' } }));
  } else if (sc === 'home-loading') {
    await wait(50);
  } else {
    await until(() => getState().consoles !== null);
  }
  if (sc === 'home-error') setState({ lastSessionError: { error: { code: 'console_unreachable', message: 'FIXTURE' }, kind: 'home', targetId: 'FIXTURE-SERVER-1', targetName: 'Xbox', stage: 'provision' } });
  if (sc === 'home-busy') setState({ lastSessionError: { error: { code: 'console_busy', message: 'FIXTURE' }, kind: 'home', targetId: 'FIXTURE-SERVER-1', targetName: 'Xbox', stage: 'provision' } });
  if (sc === 'account') setState({ sheet: 'account' });
  if (sc.startsWith('cloud')) { go('cloud'); await wait(150); }
  if (sc === 'cloud-keyboard') {
    const input = document.querySelector<HTMLInputElement>('input[type=search]');
    if (!input) throw new Error('Search field missing');
    input.focus();
    input.click();
    await wait(100);
    const count = () => (window as unknown as { __keyboardRequests?: number }).__keyboardRequests ?? 0;
    if (count() !== (getState().platform?.isSteamDeck ? 1 : 0)) throw new Error(`Unexpected keyboard requests: ${count()}`);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(50);
    if (count() !== (getState().platform?.isSteamDeck ? 1 : 0)) throw new Error('Typing reopened keyboard');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(100);
    document.querySelector<HTMLButtonElement>('[data-nav-id="chip-all"]')?.focus();
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await wait(100);
    if (count() !== (getState().platform?.isSteamDeck ? 2 : 0)) throw new Error(`Refocusing search after Enter requested keyboard ${count()} times`);
  }
  if (sc === 'cloud-sheet') { await wait(100); document.querySelector<HTMLButtonElement>('[data-nav-id="game-FX-TITLE-02"]')?.click(); }
  if (sc === 'cloud-search') {
    const el = document.querySelector<HTMLInputElement>('input[type=search]');
    if (el) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(el, getState().settings.ui.lang === 'en' ? 'racing' : 'гонка'); el.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  if (sc.startsWith('settings')) {
    const sec = (params.get('sec') ?? 'streaming') as SettingsSection;
    go('settings', sec);
    await wait(150);
    if (sc === 'settings-steam-actions') {
      document.querySelector<HTMLButtonElement>('[data-nav-id="steam-console"]')?.click();
      await wait(100);
      if (getState().platform?.isSteamDeck) {
        document.querySelector<HTMLButtonElement>('[data-nav-id="steam-layout"]')?.click();
        await wait(100);
      }
      const actions = (window as unknown as { __steamActions: string[] }).__steamActions;
      if (actions.join(',') !== (getState().platform?.isSteamDeck ? 'console:FIXTURE-SERVER-1,layout' : 'console:FIXTURE-SERVER-1')) throw new Error(`Steam controls did not dispatch expected actions: ${actions}`);
    }
    if (sc === 'settings-reset') document.querySelector<HTMLButtonElement>('.btn--danger')?.click();
    if (sc === 'settings-select') document.querySelector<HTMLButtonElement>('.select')?.click();
  }
  if (sc === 'connecting' || sc === 'conn-error') void connect('home', 'FIXTURE-SERVER-1', 'Xbox');
  if (sc === 'connecting-cloud') void connect('cloud', 'FX-TITLE-05', 'Fixture Racing');
  if (sc.startsWith('stream')) {
    const cloudAspect = sc === 'stream-aspect-cloud';
    void connect(cloudAspect ? 'cloud' : 'home', cloudAspect ? 'FX-TITLE-03' : 'FIXTURE-SERVER-1', cloudAspect ? 'Demo game 3' : 'Xbox');
    await until(() => getState().session?.phase === 'streaming' || getState().session?.phase === 'reconnecting');
    if (sc === 'stream' || sc.startsWith('stream-aspect')) { await wait(50); toggleOverlay(true); }
    if (sc.startsWith('stream-aspect') && getState().deck) {
      await wait(100);
      const pictureFit = () => document.querySelector<HTMLCanvasElement>('.stream__video canvas')?.style.objectFit;
      for (const fit of ['cover', 'fill', 'contain']) {
        const control = document.querySelector<HTMLButtonElement>('[data-nav-id="sp-fit"]');
        if (!control) throw new Error('Picture size control is missing');
        control.click();
        await wait(200);
        if (pictureFit() !== fit) throw new Error(`Picture fit did not apply: ${pictureFit()} instead of ${fit}`);
        const settings = getState().settings;
        if (cloudAspect && (settings.video.fit !== 'contain' || settings.video.cloudFits['FX-TITLE-03'] !== fit)) throw new Error('Cloud fit changed the global setting or was not saved');
        if (!cloudAspect && settings.video.fit !== fit) throw new Error('Remote Play fit was not saved globally');
      }
      if (cloudAspect) {
        document.querySelector<HTMLButtonElement>('[data-nav-id="sp-fit"]')!.click();
        await wait(200);
        await disconnect();
        await connect('cloud', 'FX-TITLE-05', 'Fixture Racing');
        if (pictureFit() !== 'contain') throw new Error('Cloud fit leaked to another game');
        await disconnect();
        await connect('cloud', 'FX-TITLE-03', 'Demo game 3');
        if (pictureFit() !== 'cover') throw new Error('Cloud fit was not restored on reconnect');
        toggleOverlay(true);
      }
    }
    if (sc === 'stream-resume') {
      const original = getState().session!;
      fakeEmit({ type: 'power', state: 'suspend' });
      await wait(100);
      fakeEmit({ type: 'power', state: 'resume' });
      await until(() => getState().session?.phase === 'streaming' && getState().session?.startedAt !== original.startedAt);
      if (getState().session?.targetId !== original.targetId) throw new Error('Resume changed the target');
    }
    if (sc === 'stream-resume-cancel') {
      fakeEmit({ type: 'power', state: 'suspend' });
      await wait(100);
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      fakeEmit({ type: 'power', state: 'resume' });
      await until(() => getState().session?.engineState === 'reconnecting');
      await wait(100);
      const cancel = document.querySelector<HTMLButtonElement>('.hero__cta button');
      if (!cancel) throw new Error('Restoring screen has no cancel control');
      cancel.click();
      await wait(100);
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      await wait(1200);
      if (getState().session !== null) throw new Error('Canceled resume started a session');
    }
  }
  await wait(Number(params.get('settle') ?? 600));
  markReady();
}
void run();
