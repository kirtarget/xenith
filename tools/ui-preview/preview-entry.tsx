// ⚠ PREVIEW ONLY — entry for the dev harness. Never part of the app build.
import { params, scenario } from './install';
import '../../src/renderer/main';
import { getState, setState, subscribe, type SettingsSection } from '../../src/renderer/state/store';
import { go } from '../../src/renderer/state/actions';
import { connect, toggleOverlay } from '../../src/renderer/state/session';

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
  if (sc === 'cloud-sheet') { await wait(100); document.querySelector<HTMLButtonElement>('[data-nav-id="game-FX-TITLE-02"]')?.click(); }
  if (sc === 'cloud-search') {
    const el = document.querySelector<HTMLInputElement>('input[type=search]');
    if (el) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(el, 'гонка'); el.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  if (sc.startsWith('settings')) {
    const sec = (params.get('sec') ?? 'streaming') as SettingsSection;
    go('settings', sec);
    await wait(150);
    if (sc === 'settings-reset') document.querySelector<HTMLButtonElement>('.btn--danger')?.click();
    if (sc === 'settings-select') document.querySelector<HTMLButtonElement>('.select')?.click();
  }
  if (sc === 'connecting' || sc === 'conn-error') void connect('home', 'FIXTURE-SERVER-1', 'Xbox');
  if (sc === 'connecting-cloud') void connect('cloud', 'FX-TITLE-05', 'Fixture Racing');
  if (sc.startsWith('stream')) {
    void connect('home', 'FIXTURE-SERVER-1', 'Xbox');
    await until(() => getState().session?.phase === 'streaming' || getState().session?.phase === 'reconnecting');
    if (sc === 'stream') { await wait(50); toggleOverlay(true); }
  }
  await wait(Number(params.get('settle') ?? 600));
  markReady();
}
void run();
