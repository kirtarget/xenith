import type { DeepPartial, HistoryEntry, LaunchIntent, Settings } from '../../shared/api';
import type { XenithEventExt } from '../../shared/core-additions';
import { onXenithEvent, parseIpcError } from '../lib/api';
import { makeI18n } from '../i18n';
import { readGamepads, sameControllers } from '../lib/controllers';
import { deepMerge, getState, setState, type InputKind, type Screen, type SettingsSection } from './store';
import { cancelResume, connect, handleMainEvent, isStreamingVisible } from './session';

const api = () => window.xenith;
const strings = () => makeI18n(getState().settings.ui.lang).s;

// ─────────── toasts ───────────
let toastSeq = 1;
export function toast(text: string, tone: 'info' | 'ok' | 'bad' = 'info', ms = 4200): void {
  const id = toastSeq++;
  setState(s => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
  window.setTimeout(() => setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), ms);
}

// ─────────── routing ───────────
export const TOP_SCREENS: Screen[] = ['home', 'cloud', 'settings'];
export const SECTIONS: SettingsSection[] = ['streaming', 'video', 'audio', 'controllers', 'haptics', 'network', 'steam', 'ui', 'advanced'];
export const DECK_SECTIONS: SettingsSection[] = ['streaming', 'video', 'audio', 'controllers', 'network', 'steam', 'ui', 'advanced'];

export function go(screen: Screen, section?: SettingsSection): void {
  setState(s => ({
    route: { screen, section: section ?? s.route.section, returnTo: s.route.screen === 'settings' ? s.route.returnTo : s.route.screen },
    sheet: null,
  }));
  if (screen === 'cloud') void loadCloud();
}

export function cycleScreen(delta: 1 | -1): void {
  const s = getState();
  if (s.route.screen === 'connecting') return;
  const i = TOP_SCREENS.indexOf(s.route.screen);
  go(TOP_SCREENS[(i + delta + TOP_SCREENS.length) % TOP_SCREENS.length]);
}

export function cycleSection(delta: 1 | -1): void {
  const s = getState();
  const list = s.deck ? DECK_SECTIONS : SECTIONS;
  const i = Math.max(0, list.indexOf(s.route.section));
  setState({ route: { ...s.route, section: list[(i + delta + list.length) % list.length] } });
}

export function setInput(kind: InputKind): void {
  if (getState().input === kind) return;
  document.documentElement.dataset.input = kind;
  setState({ input: kind });
}

// ─────────── settings (optimistic) ───────────
let pendingPatch: DeepPartial<Settings> | null = null;
let pendingTimer = 0;
let settingsSeq = 0;
let confirmed: Settings | null = null;
let bootSnapshot: Settings | null = null;
/** Value a setting had when the app started — used for "restart required" rows. */
export function bootSettings(): Settings | null { return bootSnapshot; }

export function updateSettings(patch: DeepPartial<Settings>, opts: { immediate?: boolean } = {}): void {
  const s = getState();
  if (!confirmed) confirmed = s.settings;
  const next = deepMerge(s.settings, patch);
  setState({ settings: next });
  onSettingsChanged(next);
  pendingPatch = pendingPatch ? deepMerge(pendingPatch, patch) : patch;
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(flushSettings, opts.immediate ? 0 : 140);
}

function flushSettings(): void {
  const patch = pendingPatch;
  pendingPatch = null;
  if (!patch) return;
  const seq = ++settingsSeq;
  api().settingsSet(patch).then(saved => {
    confirmed = saved;
    if (seq === settingsSeq && !pendingPatch) { setState({ settings: saved }); onSettingsChanged(saved); }
  }).catch(() => {
    if (seq !== settingsSeq) return;
    const back = confirmed ?? getState().settings;
    setState({ settings: back });
    onSettingsChanged(back);
    toast(strings().settings.saveFailed, 'bad');
  });
}

let settingsListeners: Array<(s: Settings) => void> = [];
export function onSettings(fn: (s: Settings) => void): () => void {
  settingsListeners.push(fn);
  return () => { settingsListeners = settingsListeners.filter(f => f !== fn); };
}
function onSettingsChanged(s: Settings) { settingsListeners.forEach(f => f(s)); }

export async function resetSettings(): Promise<void> {
  cancelResume();
  const s = await api().settingsReset();
  confirmed = s;
  setState({ settings: s });
  onSettingsChanged(s);
  toast(strings().settings.advanced.done, 'ok');
}

// ─────────── data loading ───────────
export async function loadConsoles(refresh = false): Promise<void> {
  setState({ consolesFailed: false, ...(refresh ? { consoles: null } : {}) });
  try {
    const list = await api().consoles(refresh);
    const s = getState();
    const keep = list.find(c => c.serverId === s.selectedServerId)
      ?? list.find(c => c.serverId === s.settings.streaming.lastServerId)
      ?? list[0];
    setState({ consoles: list, selectedServerId: keep?.serverId ?? null });
  } catch (e) {
    const err = parseIpcError(e);
    if (err.code === 'not_signed_in' || err.code === 'auth_expired') setState(st => ({ account: st.account ? { ...st.account, signedIn: false } : st.account }));
    setState({ consoles: [], consolesFailed: true });
  }
}

export async function loadHistory(): Promise<void> {
  try { setState({ history: await api().history() }); } catch { setState({ history: [] }); }
}

let cloudLoading = false;
export async function loadCloud(refresh = false): Promise<void> {
  const s = getState();
  if (cloudLoading || (!refresh && s.cloud) || s.account?.hasCloud === false) return;
  cloudLoading = true;
  setState({ cloudFailed: false });
  try { setState({ cloud: await api().cloudTitles(refresh) }); } catch { setState({ cloudFailed: true }); }
  finally { cloudLoading = false; }
}

export async function loadHaptics(): Promise<void> {
  try { setState({ haptics: await api().hapticsDiagnostics() }); } catch { /* card shows unknown */ }
}

export function pollGamepads(): void {
  if (isStreamingVisible()) return;
  const list = readGamepads();
  if (!sameControllers(list, getState().controllers)) setState({ controllers: list });
}

// ─────────── account / login ───────────
let loginTimer = 0;
export async function startLogin(): Promise<void> {
  setState({ login: { status: 'loading', code: null } });
  try {
    const code = await api().loginStart();
    setState({ login: { status: 'waiting', code } });
    window.clearTimeout(loginTimer);
    loginTimer = window.setTimeout(() => {
      const l = getState().login;
      if (l.status === 'waiting' && l.code === code) setState({ login: { status: 'expired', code } });
    }, Math.max(0, code.expiresAt - Date.now()));
  } catch (e) {
    setState({ login: { status: 'error', code: null, message: parseIpcError(e).message } });
  }
}

export async function signOut(): Promise<void> {
  cancelResume();
  await api().signOut();
  setState({ account: { signedIn: false, gamertag: null, avatarUrl: null, hasCloud: null }, consoles: null, cloud: null, history: null, sheet: null, login: { status: 'idle', code: null } });
}

async function afterSignIn(): Promise<void> {
  await Promise.all([loadConsoles(), loadHistory(), loadHaptics()]);
  if (getState().route.screen === 'cloud') void loadCloud();
}

// ─────────── events from main ───────────
function onEvent(ev: XenithEventExt): void {
  switch (ev.type) {
    case 'settings':
      confirmed = ev.settings;
      if (!pendingPatch) { setState({ settings: ev.settings }); onSettingsChanged(ev.settings); }
      break;
    case 'account': {
      const was = getState().account?.signedIn;
      if (!ev.account.signedIn) cancelResume();
      setState({ account: ev.account });
      if (ev.account.signedIn && !was) void afterSignIn();
      break;
    }
    case 'consoles': {
      const s = getState();
      setState({ consoles: ev.consoles, selectedServerId: ev.consoles.some(c => c.serverId === s.selectedServerId) ? s.selectedServerId : ev.consoles[0]?.serverId ?? null });
      break;
    }
    case 'login': {
      const l = getState().login;
      if (ev.status === 'done') setState({ login: { status: 'done', code: l.code } });
      else if (ev.status === 'expired') setState({ login: { status: 'expired', code: l.code } });
      else if (ev.status === 'error') setState({ login: { status: 'error', code: null, message: ev.message } });
      else setState({ login: { ...l, status: 'waiting' } });
      if (ev.status === 'done') void api().account().then(a => onEvent({ type: 'account', account: a }));
      break;
    }
    case 'launchIntent':
      void applyIntent(ev.intent);
      break;
    default:
      handleMainEvent(ev);
  }
}

export function addHistoryEntry(entry: HistoryEntry): void {
  setState(s => ({ history: [entry, ...(s.history ?? []).filter(h => h.id !== entry.id)] }));
}

// ─────────── boot ───────────
export async function boot(): Promise<void> {
  const x = api();
  onXenithEvent(onEvent);
  const [platform, settings, account] = await Promise.all([x.platform(), x.settingsGet(), x.account()]);
  confirmed = settings;
  bootSnapshot = settings;
  setState({ platform, settings, account, booted: true });
  onSettingsChanged(settings);
  if (!account.signedIn) return;
  await afterSignIn();
  // Launch intent (--xhome / --xcloud=<id>) or auto-connect
  try { await applyIntent(await x.launchIntent(), true); } catch { /* no intent */ }
}

/** --xhome / --xcloud=<titleId>, at start or from a second launch (Steam shortcut) while running. */
async function applyIntent(intent: LaunchIntent, atBoot = false): Promise<void> {
  const s = getState();
  if (!s.account?.signedIn) return;
  if (s.session && s.session.phase !== 'error') return; // never interrupt a running session
  if (intent.kind === 'cloud' && intent.targetId) {
    if (!s.cloud) await loadCloud();
    const t = getState().cloud?.find(c => c.titleId === intent.targetId);
    void connect('cloud', intent.targetId, t?.name ?? intent.targetId);
  } else if (intent.kind === 'home' || (atBoot && intent.kind == null && s.settings.streaming.autoConnectOnLaunch)) {
    const c = s.consoles?.find(k => k.serverId === (intent.targetId ?? s.settings.streaming.lastServerId)) ?? s.consoles?.[0];
    if (c) void connect('home', c.serverId, c.name);
  }
}
