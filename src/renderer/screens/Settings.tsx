import { useEffect, useRef } from 'react';
import { cx } from '../components/controls';
import { HintBar } from '../components/data';
import { useI18n } from '../i18n';
import { focusById } from '../nav/engine';
import { useNavLayer, useScreenFocus } from '../nav/hooks';
import { cycleSection, DECK_SECTIONS, go, SECTIONS } from '../state/actions';
import { getState, setState, useApp, type SettingsSection } from '../state/store';
import { DeckRows, DesktopRows } from './settings/rows';
import { sectionRows } from './settings/sections';

export function Settings() {
  const i18n = useI18n();
  const { s } = i18n;
  const deck = useApp(x => x.deck);
  const section = useApp(x => x.route.section);
  const settings = useApp(x => x.settings);
  const list = deck ? DECK_SECTIONS : SECTIONS;
  const current: SettingsSection = list.includes(section) ? section : 'streaming';
  const mainRef = useRef<HTMLElement>(null);
  const cameFromNav = useRef(false);

  const select = (sec: SettingsSection) => setState(st => ({ route: { ...st.route, section: sec } }));
  const step = (d: 1 | -1) => { cameFromNav.current = true; cycleSection(d); };

  useNavLayer({
    lt: () => { step(-1); return true; },
    rt: () => { step(1); return true; },
    b: () => {
      const inMain = mainRef.current?.contains(document.activeElement);
      if (inMain) { focusById(`sec-${current}`); return true; }
      go(getState().route.returnTo === 'settings' ? 'home' : getState().route.returnTo);
      return true;
    },
  });
  useScreenFocus('settings');

  // After LT/RT keep the gamepad user on the section list, on the new section.
  useEffect(() => {
    if (cameFromNav.current) { cameFromNav.current = false; focusById(`sec-${current}`); }
    mainRef.current?.scrollTo({ top: 0 });
  }, [current]);

  const rows = sectionRows(current, i18n, settings, deck);
  const titles = s.settings.sections;
  const title = (k: SettingsSection) => (deck && k === 'controllers' ? titles.deckControllers : titles[k]);
  const intro = (s.settings as unknown as Record<string, { intro?: string }>)[current]?.intro;

  return (
    <div className={deck ? 'settings settings--deck' : 'settings'}>
      <nav className="snav" aria-label={s.settings.sectionsAria} data-nav-region="" data-nav-contain="v">
        {!deck && <h1 className="snav__title">{s.settings.title}</h1>}
        {list.map(k => (
          <button
            key={k}
            type="button"
            data-nav=""
            data-nav-id={`sec-${k}`}
            data-nav-default={k === current ? '' : undefined}
            aria-current={k === current ? 'page' : undefined}
            className={cx('snav__item', k === current && 'is-on')}
            onClick={() => select(k)}
            onFocus={() => { if (getState().input !== 'mouse' && k !== current) select(k); }}
          >
            {title(k)}
          </button>
        ))}
      </nav>
      <main ref={mainRef} className="smain" aria-labelledby="sec-title">
        <div className="smain__inner">
          <header className="smain__head">
            <h2 id="sec-title" className="smain__title">{title(current)}</h2>
            {intro && !deck && <p className="muted">{intro}</p>}
          </header>
          {deck ? <div className="dlist-wrap"><DeckRows rows={rows} /></div> : <DesktopRows rows={rows} />}
        </div>
        {!deck && <HintBar hints={[{ k: 'ltrt', label: s.hints.otherSection }, { k: 'lbrb', label: s.hints.otherScreen }, { k: 'b', label: s.hints.back }]} />}
      </main>
      {deck && <HintBar hints={[{ k: 'lr', label: s.hints.change }, { k: 'ltrt', label: s.hints.otherSection }, { k: 'lbrb', label: s.hints.otherScreen }, { k: 'b', label: s.hints.back }]} />}
    </div>
  );
}
