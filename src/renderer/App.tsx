import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UiScale } from '../shared/api';
import { cx } from './components/controls';
import { ToastHost } from './components/feedback';
import { IconCloud, IconConsole, IconSliders, XenithMark } from './components/Icons';
import { I18nContext, makeI18n, useI18n } from './i18n';
import { readGamepads } from './lib/controllers';
import { reportAudioOutputs } from './lib/api';
import { startInput } from './nav/input';
import { useNavLayer } from './nav/hooks';
import { boot, cycleScreen, go, onSettings, pollGamepads, setInput } from './state/actions';
import { applyLiveSettings, isStreamingVisible, toggleOverlay } from './state/session';
import { getState, setState, useApp, type Screen } from './state/store';
import { AccountSheet } from './screens/Account';
import { Cloud } from './screens/Cloud';
import { Connecting } from './screens/Connecting';
import { Home } from './screens/Home';
import { Login } from './screens/Login';
import { Settings } from './screens/Settings';
import { StreamLayer } from './screens/Stream';

const ZOOM: Record<UiScale, number> = { xs: 0.85, s: 0.92, m: 1, l: 1.1, xl: 1.2 };

function useDeckLayout(): boolean {
  const layout = useApp(s => s.settings.ui.layout);
  const isDeck = useApp(s => !!s.platform?.isSteamDeck);
  const [small, setSmall] = useState(() => window.innerWidth <= 1280 && window.innerHeight <= 800);
  useEffect(() => {
    const on = () => setSmall(window.innerWidth <= 1280 && window.innerHeight <= 800);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return layout === 'deck' || (layout === 'auto' && (isDeck || small));
}

export function App() {
  const lang = useApp(s => s.settings.ui.lang);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const deck = useDeckLayout();
  const phase = useApp(s => s.session?.phase ?? 'idle');
  const streaming = phase === 'streaming' || phase === 'reconnecting';
  const overlayOpen = useApp(s => !!s.session?.overlayOpen);

  useEffect(() => {
    document.documentElement.dataset.input = getState().input;
    void boot();
    const offSettings = onSettings(() => applyLiveSettings());
    const offInput = startInput({
      uiOwnsInput: () => !isStreamingVisible() || !!getState().session?.overlayOpen,
      onStreamEscape: () => toggleOverlay(),
      onInput: setInput,
      onPadsChanged: pollGamepads,
    });
    const padTimer = window.setInterval(pollGamepads, 2000);
    pollGamepads();
    navigator.mediaDevices?.enumerateDevices?.().then(all => {
      const outs = all.filter(d => d.kind === 'audiooutput' && !!d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map(d => ({ deviceId: d.deviceId, label: d.label }));
      if (outs.length) reportAudioOutputs(outs);
    }).catch(() => undefined);
    return () => { offSettings(); offInput(); window.clearInterval(padTimer); };
  }, []);

  useEffect(() => {
    if (getState().deck !== deck) setState({ deck });
    document.documentElement.dataset.layout = deck ? 'deck' : 'desktop';
  }, [deck]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    document.documentElement.dataset.streaming = String(streaming);
    if (!streaming && readGamepads().length !== getState().controllers.length) pollGamepads();
  }, [streaming]);

  return (
    <I18nContext.Provider value={i18n}>
      <Root deck={deck} hideUi={streaming} overlayOpen={overlayOpen} />
    </I18nContext.Provider>
  );
}

function Root({ deck, hideUi, overlayOpen }: { deck: boolean; hideUi: boolean; overlayOpen: boolean }) {
  const booted = useApp(s => s.booted);
  const signedIn = useApp(s => !!s.account?.signedIn);
  const scale = useApp(s => s.settings.ui.scale);
  const z = ZOOM[scale] ?? 1;
  const zoomStyle = z === 1 ? undefined : { zoom: z, width: `calc(100vw / ${z})`, height: `calc(100vh / ${z})` };
  const uiRef = useRef<HTMLDivElement>(null);
  useEffect(() => { uiRef.current?.toggleAttribute('inert', hideUi); }, [hideUi]);
  return (
    <>
      <div ref={uiRef} className={cx('app-ui', deck && 'app-ui--deck')} style={zoomStyle} data-nav-root="" aria-hidden={hideUi || undefined}>
        {!booted ? <BootSkeleton deck={deck} /> : !signedIn ? <Login /> : <Shell deck={deck} />}
        <ToastHost />
      </div>
      <div className="stream-root" style={zoomStyle} data-overlay={overlayOpen ? 'open' : 'closed'}>
        <StreamLayer />
      </div>
    </>
  );
}

function Shell({ deck }: { deck: boolean }) {
  const screen = useApp(s => s.route.screen);
  useNavLayer({
    lb: () => { cycleScreen(-1); return true; },
    rb: () => { cycleScreen(1); return true; },
    y: () => { setState({ sheet: 'account' }); return true; },
    menu: () => { go('settings'); return true; },
  });
  const content = screen === 'home' ? <Home /> : screen === 'cloud' ? <Cloud /> : screen === 'settings' ? <Settings /> : <Connecting />;
  return (
    <div className={deck ? 'shell shell--deck' : 'shell'}>
      {deck ? <DeckTabs screen={screen} /> : <NavRail screen={screen} />}
      <div className="shell__main" key={screen}>{content}</div>
      <AccountSheet />
    </div>
  );
}

function activeTop(screen: Screen): Screen {
  if (screen !== 'connecting') return screen;
  return getState().session?.kind === 'cloud' ? 'cloud' : 'home';
}

function NavRail({ screen }: { screen: Screen }) {
  const { s } = useI18n();
  const cur = activeTop(screen);
  const items: Array<{ id: Screen; label: string; icon: ReactNode }> = [
    { id: 'home', label: s.nav.home, icon: <IconConsole /> },
    { id: 'cloud', label: s.nav.cloud, icon: <IconCloud /> },
    { id: 'settings', label: s.nav.settings, icon: <IconSliders /> },
  ];
  const phase = useApp(x => x.session?.phase);
  const locked = screen === 'connecting' && phase === 'connecting';
  return (
    <nav className="rail-nav" aria-label={s.nav.aria} data-nav-region="" data-nav-contain="v">
      <div aria-hidden className="brand"><XenithMark size={20} /></div>
      {items.map(it => (
        <button
          key={it.id}
          type="button"
          data-nav=""
          data-nav-id={`nav-${it.id}`}
          aria-current={cur === it.id ? 'page' : undefined}
          className={cx('rail-nav__item', cur === it.id && 'is-on')}
          disabled={locked && cur !== it.id}
          onClick={() => go(it.id)}
        >
          {it.icon}
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

function DeckTabs({ screen }: { screen: Screen }) {
  const { s } = useI18n();
  const cur = activeTop(screen);
  const gamertag = useApp(x => x.account?.gamertag);
  const input = useApp(x => x.input);
  const items: Array<{ id: Screen; label: string }> = [
    { id: 'home', label: s.nav.home }, { id: 'cloud', label: s.nav.cloud }, { id: 'settings', label: s.nav.settings },
  ];
  const kb = input === 'keyboard';
  const phase = useApp(x => x.session?.phase);
  return (
    <header className="dtabs">
      <span aria-hidden className="dtabs__key">{kb ? 'Q' : 'L1'}</span>
      <nav aria-label={s.nav.aria} className="dtabs__nav" data-nav-region="" data-nav-contain="h">
        {items.map(it => (
          <button key={it.id} type="button" data-nav="" data-nav-id={`nav-${it.id}`} aria-current={cur === it.id ? 'page' : undefined}
            className={cx('dtabs__tab', cur === it.id && 'is-on')} disabled={screen === 'connecting' && phase === 'connecting' && cur !== it.id} onClick={() => go(it.id)}>
            {it.label}
          </button>
        ))}
      </nav>
      <span aria-hidden className="dtabs__key">{kb ? 'E' : 'R1'}</span>
      <button type="button" className="dtabs__account" data-nav="" data-nav-id="account" onClick={() => setState({ sheet: 'account' })}>{gamertag}</button>
    </header>
  );
}

function BootSkeleton({ deck }: { deck: boolean }) {
  return (
    <div className={deck ? 'shell shell--deck' : 'shell'} aria-busy="true">
      {deck ? <header className="dtabs" /> : <nav className="rail-nav"><div aria-hidden className="brand"><XenithMark size={20} /></div></nav>}
      <div className="shell__main"><div className={deck ? 'page page--deck' : 'page'}>
        <div className="hero"><span className="skel" style={{ width: 120, height: 44, borderRadius: 8 }} /><span className="skel" style={{ width: 220, height: 14, borderRadius: 7 }} /><span className="skel" style={{ width: 200, height: 56, borderRadius: 14 }} /></div>
      </div></div>
    </div>
  );
}
