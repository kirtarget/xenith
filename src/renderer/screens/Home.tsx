import { useMemo } from 'react';
import type { ConsoleInfo, HistoryEntry } from '../../shared/api';
import { Button } from '../components/controls';
import { HintBar, Rail, Sparkline, type Hint } from '../components/data';
import { EmptyState, Skeleton, StatusDot } from '../components/feedback';
import { ListSelect } from '../components/overlays';
import { IconPlay } from '../components/Icons';
import { useI18n } from '../i18n';
import { historyRail, powerText, powerTone, consoleTypeText, resolutionCap } from '../lib/view';
import { useNavLayer, useScreenFocus } from '../nav/hooks';
import { go, loadConsoles } from '../state/actions';
import { connect } from '../state/session';
import { setState, useApp } from '../state/store';
import { AccountChip } from './Account';
import { ErrorCard } from './errors';

export function Home() {
  const i18n = useI18n();
  const { s } = i18n;
  const deck = useApp(x => x.deck);
  const consoles = useApp(x => x.consoles);
  const selectedId = useApp(x => x.selectedServerId);
  const history = useApp(x => x.history);
  const err = useApp(x => x.lastSessionError);
  const selected = consoles?.find(c => c.serverId === selectedId) ?? consoles?.[0] ?? null;
  const lastForConsole = useMemo(() => (history ?? []).find(h => h.kind === 'home' && (!selected || h.targetId === selected.serverId)) ?? null, [history, selected]);
  const homeErr = err && err.kind === 'home' ? err : null;

  const doConnect = () => { if (selected) void connect('home', selected.serverId, selected.name); };
  const multi = (consoles?.length ?? 0) > 1;

  useNavLayer({
    x: () => { if (multi) document.querySelector<HTMLButtonElement>('[data-nav-id="change-console"]')?.click(); },
    b: () => { if (deck) { void window.xenith.window.quit(); return true; } return false; },
  });
  useScreenFocus('home', consoles !== null);

  const hints: Hint[] = deck
    ? [{ k: 'a', label: s.hints.connect }, ...(multi ? [{ k: 'x' as const, label: s.hints.changeConsole }] : []), { k: 'b', label: s.hints.exit }]
    : [{ k: 'a', label: s.hints.select }, { k: 'b', label: s.hints.back }, { k: 'lbrb', label: s.hints.sections }, { k: 'y', label: s.hints.account }];

  let hero;
  if (consoles === null) hero = <HeroSkeleton deck={deck} />;
  else if (consoles.length === 0) hero = <ErrorCard code="no_console" className="hero hero--state" deck={deck} />;
  else if (homeErr) hero = <ErrorCard code={homeErr.error.code} className="hero hero--state" deck={deck} />;
  else hero = <Hero console={selected!} consoles={consoles} last={lastForConsole} onConnect={doConnect} deck={deck} />;

  if (deck) {
    return (
      <div className="page page--deck">
        <div className="deck-home">
          {hero}
          <div className="deck-home__side">
            <LastSessionCard last={lastForConsole} deck />
            <QualityCard deck />
            <ControllerCard deck />
          </div>
        </div>
        <HintBar hints={hints} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page__head">
        <p className="page__eyebrow">{s.home.myConsole}</p>
        <AccountChip />
      </header>
      {hero}
      {consoles?.length !== 0 && <>
        <div className="cards3">
          {consoles === null ? <><CardSkeleton /><CardSkeleton /><CardSkeleton /></> : <>
            <LastSessionCard last={lastForConsole} />
            <ControllerCard />
            <QualityCard />
          </>}
        </div>
        <HistoryList history={history} />
      </>}
      <HintBar hints={hints} />
    </div>
  );
}

function Hero({ console: c, consoles, last, onConnect, deck }: { console: ConsoleInfo; consoles: ConsoleInfo[]; last: HistoryEntry | null; onConnect: () => void; deck: boolean }) {
  const i18n = useI18n();
  const { s } = i18n;
  const rail = historyRail(i18n, last, deck);
  const connectBtn = (
    <Button variant="primary" size="xl" navId="connect" navDefault icon={<IconPlay size={deck ? 22 : 20} />} onClick={onConnect} disabled={c.power === 'Off' && !c.remotePlayReady}>
      {s.common.connect}
    </Button>
  );
  return (
    <section className="hero" aria-labelledby="console-name">
      <div className="hero__top">
        <div className="hero__id">
          <h1 id="console-name" className="hero__title">{c.name}</h1>
          <div className="hero__meta">
            {!deck && <span>{consoleTypeText(i18n, c.type)}</span>}
            <span className="hero__power"><StatusDot tone={powerTone(c)} size={deck ? 10 : 8} />{powerText(i18n, c)}</span>
          </div>
        </div>
        {!deck && consoles.length > 1 && <ConsolePicker consoles={consoles} current={c} />}
      </div>
      <div className="hero__cta">
        {connectBtn}
        {!deck && <span className={c.remotePlayReady ? 'muted' : 'warn-text'}>{c.remotePlayReady ? s.home.remoteReady : s.home.remoteNotReady}</span>}
        {deck && consoles.length > 1 && <ConsolePicker consoles={consoles} current={c} hidden />}
      </div>
      <div className="hero__rail">
        <Rail items={rail} label={s.home.railAria} compact={deck} />
      </div>
    </section>
  );
}

function ConsolePicker({ consoles, current, hidden }: { consoles: ConsoleInfo[]; current: ConsoleInfo; hidden?: boolean }) {
  const i18n = useI18n();
  const opts = consoles.map(c => ({ value: c.serverId, label: c.name, hint: `${consoleTypeText(i18n, c.type)} · ${powerText(i18n, c)}` }));
  return (
    <span className={hidden ? 'visually-collapsed' : undefined}>
      <ListSelect
        value={current.serverId}
        options={opts}
        title={i18n.s.home.chooseConsole}
        navId="change-console"
        buttonLabel={i18n.s.home.changeConsole}
        onChange={v => setState({ selectedServerId: v })}
      />
    </span>
  );
}

function HeroSkeleton({ deck }: { deck: boolean }) {
  return (
    <section className="hero" aria-busy="true" aria-label="…">
      <div className="hero__id">
        <Skeleton w={120} h={deck ? 50 : 44} r={8} />
        <Skeleton w={260} h={14} r={7} style={{ marginTop: 6 }} />
      </div>
      <Skeleton w={200} h={deck ? 64 : 56} r={14} />
      <div className="rail rail--past" style={{ gridTemplateColumns: `repeat(${deck ? 3 : 4}, minmax(0, 1fr))` }}>
        {Array.from({ length: deck ? 3 : 4 }, (_, i) => (
          <span key={i} className="rail__item"><span className="rail__bar skel" /><Skeleton w="60%" h={12} r={6} /><Skeleton w={48} h={16} r={6} /></span>
        ))}
      </div>
    </section>
  );
}

function CardSkeleton() {
  return (
    <section className="card" aria-hidden>
      <Skeleton w={110} h={14} r={7} />
      <Skeleton w="70%" h={26} r={8} />
      <Skeleton w="50%" h={14} r={7} />
      <Skeleton w="100%" h={56} r={8} style={{ marginTop: 'auto' }} />
    </section>
  );
}

function LastSessionCard({ last, deck }: { last: HistoryEntry | null; deck?: boolean }) {
  const { s, f } = useI18n();
  if (!last) {
    return (
      <section className="card" aria-labelledby="last">
        <h2 id="last" className="card__label">{s.home.lastSession}</h2>
        <div className="card__main">
          <span className="card__value card__value--m">{s.home.lastNone}</span>
          <span className="muted">{s.home.lastNoneBody}</span>
        </div>
      </section>
    );
  }
  const trace = last.bitrateTrace;
  const min = trace.length ? Math.min(...trace) : 0, max = trace.length ? Math.max(...trace) : 0;
  if (deck) {
    return (
      <section className="card" aria-labelledby="last">
        <h2 id="last" className="card__label">{s.home.lastSession}</h2>
        <span className="card__value">{s.home.deckLast(f.p(last.maxHeight), f.fps(last.fps))}</span>
        <span className="muted">{[f.mbps(last.avgKbps), `${last.packetsLost} ${s.home.losses(last.packetsLost)}`, f.whenAt(last.startedAt).toLowerCase()].join(', ')}</span>
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="last">
      <h2 id="last" className="card__label">{s.home.lastSession}</h2>
      <div className="card__main">
        <span className="card__value">{f.res(last.maxWidth, last.maxHeight)}, {f.fps(last.fps)}</span>
        <span className="muted">{f.whenAt(last.startedAt)}, {f.durLong(last.durationSec)}</span>
      </div>
      <Sparkline points={trace} label={s.home.sparkAria(f.mbpsValue(min), f.mbpsValue(max))} />
      <div className="card__stats">
        <span><b>{last.avgKbps != null ? f.mbpsValue(last.avgKbps) : s.common.dash}</b> {s.home.avgBitrate}</span>
        <span><b>{last.packetsLost}</b> {s.home.losses(last.packetsLost)}</span>
      </div>
    </section>
  );
}

function ControllerCard({ deck }: { deck?: boolean }) {
  const { s } = useI18n();
  const pads = useApp(x => x.controllers);
  const vibration = useApp(x => x.settings.controllers.vibration);
  const haptics = useApp(x => x.haptics);
  const isDeckHw = useApp(x => !!x.platform?.isSteamDeck);
  const pad = pads.find(p => !p.isDeck) ?? pads[0] ?? null;
  if (deck) {
    const builtIn = isDeckHw && (!pad || pad.isDeck);
    return (
      <section className="card" aria-labelledby="pad">
        <h2 id="pad" className="card__label">{s.home.deckControls}</h2>
        <span className="card__value card__value--m">{builtIn ? s.home.deckButtons : pad?.name ?? s.home.noController}</span>
        <span className="muted">{builtIn ? s.home.deckButtonsBody : pad ? s.home.ready : s.home.noControllerBody}</span>
      </section>
    );
  }
  const conn = pad ? s.home.connection[pad.connection] : '';
  const flydigi = !haptics ? s.common.dash
    : haptics.flydigiDevice.state === 'ok' ? (haptics.spaceStation.state === 'ok' ? s.home.flydigiReady : s.home.flydigiNoStation)
      : s.home.flydigiMissing;
  return (
    <section className="card" aria-labelledby="pad">
      <h2 id="pad" className="card__label">{s.home.controller}</h2>
      <div className="card__main">
        <span className="card__value card__value--m">{pad ? pad.name : s.home.noController}</span>
        <span className="muted">{pad ? (conn ? `${conn}, ${s.home.ready}` : s.home.ready.charAt(0).toUpperCase() + s.home.ready.slice(1)) : s.home.noControllerBody}</span>
      </div>
      <div className="card__kv">
        <span className="kv"><span className="muted">{s.home.vibration}</span><span>{vibration ? s.home.vibrationOn : s.home.vibrationOff}</span></span>
        <span className="kv"><span className="muted">{s.home.xhaptics}</span><span>{flydigi}</span></span>
      </div>
    </section>
  );
}

function QualityCard({ deck }: { deck?: boolean }) {
  const { s, f } = useI18n();
  const st = useApp(x => x.settings.streaming);
  const history = useApp(x => x.history);
  const selectedId = useApp(x => x.selectedServerId);
  const cap = resolutionCap(history, 'home', selectedId);
  const desc = st.resolution === 'auto'
    ? (cap ? s.home.qualityUpTo(f.p(cap)) : s.home.qualityAuto)
    : s.home.qualityFixed(`${st.resolution}p`);
  if (deck) {
    const res = st.resolution === 'auto' ? s.settings.streaming.resolutionOpts.auto : `${st.resolution}p`;
    const prof = s.profiles.name[st.profile] ?? st.profile;
    return (
      <section className="card" aria-labelledby="qual">
        <h2 id="qual" className="card__label">{s.home.deckQuality}</h2>
        <span className="card__value card__value--m">{res}, {prof.charAt(0).toLowerCase() + prof.slice(1)}</span>
        <span className="muted">{st.resolution === '720' ? s.home.deckQualityBody : desc}</span>
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="quality">
      <h2 id="quality" className="card__label">{s.home.quality}</h2>
      <div className="card__main">
        <span className="card__value card__value--m">{s.profiles.name[st.profile]}</span>
        <span className="muted">{desc}</span>
      </div>
      <Button variant="secondary" navId="change-quality" className="card__action" onClick={() => go('settings', 'streaming')}>{s.home.changeQuality}</Button>
    </section>
  );
}

function HistoryList({ history }: { history: HistoryEntry[] | null }) {
  const { s, f } = useI18n();
  const consoles = useApp(x => x.consoles);
  const items = (history ?? []).slice(0, 5);
  if (history === null) return null;
  return (
    <section className="history" aria-labelledby="history">
      <h2 id="history" className="section-title">{s.home.history}</h2>
      {items.length === 0 ? (
        <EmptyState tone="idle" title={s.home.lastNone} body={s.home.lastNoneBody} className="history__empty" />
      ) : (
        <div className="history__list" data-nav-region="">
          {items.map((h, i) => {
            const target = h.kind === 'home' ? consoles?.find(c => c.serverId === h.targetId) : null;
            const name = h.kind === 'home' ? (consoles && consoles.length > 1 ? h.targetName : null) : h.targetName;
            return (
              <div key={h.id} className={i === 0 ? 'hrow hrow--first' : 'hrow'}>
                <span>{f.when(h.startedAt)}{name ? <span className="muted"> · {name}</span> : null}</span>
                <span className="muted">{f.res(h.maxWidth, h.maxHeight)}, {f.fps(h.fps)}</span>
                <span className="muted num-right">{f.durShort(h.durationSec)}</span>
                <Button
                  variant="secondary"
                  size="s"
                  navId={`hist-${h.id}`}
                  disabled={h.kind === 'home' && !!consoles && !target}
                  onClick={() => void connect(h.kind, h.targetId, target?.name ?? h.targetName)}
                >
                  {s.common.reconnect}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function retryConsoles() { void loadConsoles(true); }
