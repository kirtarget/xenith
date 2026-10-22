import { useCallback, useEffect, useRef, useState } from 'react';
import type { HudCorner, Settings, StreamProfile, StreamStats } from '../../shared/api';
import { Button, cx, Segmented, Slider, Toggle } from '../components/controls';
import { useI18n, type I18n } from '../i18n';
import { useNow } from '../lib/view';
import { useFocusTrap, useNavLayer } from '../nav/hooks';
import { updateSettings } from '../state/actions';
import { disconnect, pressGuide, registerStreamContainer, retry, toggleOverlay } from '../state/session';
import { useApp } from '../state/store';
import { ERROR_TONE } from './errors';
import { StatusDot } from '../components/feedback';

/** Always mounted: the engine needs its container while connecting. Visible only once streaming. */
export function StreamLayer() {
  const phase = useApp(x => x.session?.phase ?? 'idle');
  const visible = phase === 'streaming' || phase === 'reconnecting';
  const mounted = phase !== 'idle';
  const ref = useCallback((el: HTMLDivElement | null) => registerStreamContainer(el), []);
  const { s } = useI18n();
  return (
    <div className={cx('stream', visible && 'is-visible')} aria-hidden={!visible}>
      <div ref={ref} className="stream__video" role="img" aria-label={s.stream.videoAria} />
      {mounted && visible && <StreamChrome />}
    </div>
  );
}

function StreamChrome() {
  const i18n = useI18n();
  const sess = useApp(x => x.session)!;
  const hud = useApp(x => x.settings.video.hud);
  const corner = useApp(x => x.settings.video.hudCorner);
  const deck = useApp(x => x.deck);
  return (
    <>
      {hud !== 'off' && <Hud stats={sess.stats} mode={hud} corner={corner} lossTrend={sess.lossTrend} i18n={i18n} deck={deck} />}
      {sess.phase === 'reconnecting' && <Reconnecting />}
      {sess.overlayOpen && <SidePanel />}
      {!sess.overlayOpen && <MouseMenuButton />}
    </>
  );
}

/** Appears on mouse movement over the stream, hides after 2.5 s of stillness; cursor hides with it. */
function MouseMenuButton() {
  const { s } = useI18n();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const move = () => { setShown(true); document.body.classList.remove('stream-cursor-hidden'); if (t) clearTimeout(t); t = setTimeout(() => { setShown(false); document.body.classList.add('stream-cursor-hidden'); }, 2500); };
    window.addEventListener('mousemove', move);
    return () => { window.removeEventListener('mousemove', move); if (t) clearTimeout(t); document.body.classList.remove('stream-cursor-hidden'); };
  }, []);
  return (
    <button type="button" className={cx('stream-menu-btn', shown && 'is-shown')} aria-label={s.stream.openMenu} tabIndex={-1} onClick={() => toggleOverlay(true)}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      <span>{s.stream.openMenu}</span>
    </button>
  );
}

function Hud({ stats, mode, corner, lossTrend, i18n, deck }: { stats: StreamStats | null; mode: 'compact' | 'full'; corner: HudCorner; lossTrend: number; i18n: I18n; deck: boolean }) {
  const { s, f } = i18n;
  const st = s.stream;
  const lossTone = !stats ? '' : lossTrend > 20 ? 'bad-text' : lossTrend > 0 ? 'warn-text' : 'ok-text';
  if (mode === 'compact') {
    return (
      <dl className={cx('hud hud--compact', `hud--${corner}`, deck && 'hud--deck')} aria-label={st.hudAria}>
        <div><dt>{st.video}</dt><dd>{stats ? `${f.res(stats.frameWidth, stats.frameHeight)}, ${f.fps(stats.fps)}` : s.common.dash}</dd></div>
        <div><dt>{st.net}</dt><dd>{f.ms(stats?.rttMs ?? null, 0)}</dd></div>
        <div><dt>{st.lossShort}</dt><dd className={lossTone}>{stats ? stats.packetsLost : s.common.dash}</dd></div>
      </dl>
    );
  }
  return (
    <dl className={cx('hud', `hud--${corner}`)} aria-label={st.hudAria}>
      <dt>{st.resolution}</dt><dd>{f.res(stats?.frameWidth ?? null, stats?.frameHeight ?? null)}</dd>
      <dt>{st.fps}</dt><dd>{stats?.fps != null ? Math.round(stats.fps) : s.common.dash}</dd>
      <dt>{st.bitrate}</dt><dd>{f.mbps(stats?.kbps ?? null)}</dd>
      <dt>{st.rtt}</dt><dd>{f.ms(stats?.rttMs ?? null, 0)}</dd>
      <dt>{st.jitterBuffer}</dt><dd>{f.ms(stats?.jitterBufferMs ?? null)}</dd>
      <dt>{st.decode}</dt><dd>{f.ms(stats?.decodeMsPerFrame ?? null)}</dd>
      <dt>{st.loss}</dt><dd className={lossTone}>{stats ? stats.packetsLost : s.common.dash}</dd>
    </dl>
  );
}

function Reconnecting() {
  const { s } = useI18n();
  const copy = s.errors.stream_lost;
  return (
    <div className="reconnect" role="alert">
      <StatusDot tone={ERROR_TONE.stream_lost} size={10} />
      <div className="reconnect__text">
        <strong>{copy.title}</strong>
        <span className="muted">{copy.body}</span>
      </div>
      <Button variant="primary" onClick={retry}>{copy.primary}</Button>
      <Button variant="outline" onClick={() => void disconnect()}>{copy.secondary}</Button>
    </div>
  );
}

const PROFILES: StreamProfile[] = ['low-latency', 'quality', 'battery'];

function useFullscreen(): [boolean, () => void] {
  const [fs, setFs] = useState(() => Math.abs(window.innerWidth - screen.width) < 2 && Math.abs(window.innerHeight - screen.height) < 2);
  const toggle = () => { void window.xenith.window.toggleFullscreen().then(setFs); };
  return [fs, toggle];
}

function SidePanel() {
  const i18n = useI18n();
  const { s } = i18n;
  const st = s.stream;
  const deck = useApp(x => x.deck);
  const sess = useApp(x => x.session)!;
  const settings = useApp(x => x.settings);
  const pads = useApp(x => x.controllers);
  const ref = useRef<HTMLElement>(null);
  const now = useNow(15000);
  const [fs, toggleFs] = useFullscreen();
  const close = () => toggleOverlay(false);

  useNavLayer({ b: () => { close(); return true; }, menu: () => { close(); return true; } }, { scope: ref, modal: true });
  useFocusTrap(ref, true);

  const minutes = sess.firstFrameAt ? Math.floor((now - sess.firstFrameAt) / 60000) : 0;
  const quality = sess.lossTrend > 0 ? st.unstable : st.stable;
  const pad = pads.find(p => !p.isDeck) ?? pads[0];
  const vib = !settings.controllers.vibration ? st.vibrationOff : sess.lastRumble && Date.now() - sess.lastRumble.at < 120000 ? st.vibrationWorks : st.vibrationIdle;
  const profiles = deck || settings.streaming.profile === 'battery' ? PROFILES : PROFILES.slice(0, 2);
  const setVideo = (p: Partial<Settings['video']>) => updateSettings({ video: p });

  if (deck) {
    const hudCycle: Settings['video']['hud'][] = ['off', 'compact', 'full'];
    return (
      <aside ref={ref} className="spanel spanel--deck" aria-label={st.menuAria}>
        <h1 className="spanel__title">{sess.targetName}</h1>
        <p className="muted spanel__sub">{st.inGame(minutes)}</p>
        <button type="button" className="dlist" data-nav="" data-nav-default="" onClick={close}><span>{st.resume}</span></button>
        <button type="button" className="dlist" data-nav="" onClick={pressGuide}><span>{st.guide}</span></button>
        <CycleRow label={st.profile} value={s.profiles.name[settings.streaming.profile]} onStep={d => {
          const i = PROFILES.indexOf(settings.streaming.profile);
          updateSettings({ streaming: { profile: PROFILES[(i + d + PROFILES.length) % PROFILES.length] } });
        }} />
        <CycleRow label={st.sharpness} value={st.sharpnessValue(settings.video.sharpness)} onStep={d => setVideo({ sharpness: Math.min(10, Math.max(0, settings.video.sharpness + d)) })} />
        <CycleRow label={st.hudToggle} value={st.hudMode[settings.video.hud]} onStep={d => {
          const i = hudCycle.indexOf(settings.video.hud);
          setVideo({ hud: hudCycle[(i + d + hudCycle.length) % hudCycle.length] });
        }} />
        <button type="button" className="dlist dlist--danger" data-nav="" onClick={() => void disconnect()}><span>{s.common.disconnect}</span></button>
        <p className="spanel__help">{st.overlayHelpDeck}</p>
      </aside>
    );
  }

  return (
    <aside ref={ref} className="spanel" aria-label={st.menuAria}>
      <div className="spanel__head">
        <h1 className="spanel__title">{sess.targetName}</h1>
        <span className="muted">{st.inGame(minutes)}{sess.firstFrameAt ? `, ${quality}` : ''}</span>
      </div>
      <div className="spanel__group">
        <span id="sp-prof" className="muted">{st.profile}</span>
        <Segmented
          labelledBy="sp-prof"
          grid={profiles.length}
          size="l"
          value={settings.streaming.profile}
          options={profiles.map(p => ({ value: p, label: s.profiles.short[p] }))}
          onChange={v => updateSettings({ streaming: { profile: v } })}
          navIdPrefix="sp-prof"
        />
      </div>
      <div className="spanel__group">
        <label htmlFor="sp-sharp" className="kv"><span className="muted">{st.sharpness}</span><span>{st.sharpnessValue(settings.video.sharpness)}</span></label>
        <Slider id="sp-sharp" min={0} max={10} value={settings.video.sharpness} onChange={v => setVideo({ sharpness: v })} navId="sp-sharp" width="100%" />
        <span className="tiny">{st.sharpnessHelp}</span>
      </div>
      <div className="spanel__toggles">
        <label className="toggle-row"><span id="sp-hud">{st.hudToggle}</span>
          <Toggle labelledBy="sp-hud" checked={settings.video.hud !== 'off'} onChange={v => setVideo({ hud: v ? 'full' : 'off' })} navId="sp-hud" />
        </label>
        <label className="toggle-row"><span id="sp-fs">{st.fullscreen}</span>
          <Toggle labelledBy="sp-fs" checked={fs} onChange={toggleFs} navId="sp-fs" />
        </label>
      </div>
      <div className="spanel__kv">
        <span className="kv"><span className="muted">{st.controller}</span><span>{pad?.name ?? st.noController}</span></span>
        <span className="kv"><span className="muted">{st.vibration}</span><span>{vib}</span></span>
      </div>
      <div className="spanel__actions">
        <Button variant="secondary" size="l" block onClick={pressGuide} navId="sp-guide">{st.guide}</Button>
        <Button variant="danger" size="l" block onClick={() => void disconnect()} navId="sp-disc">{s.common.disconnect}</Button>
      </div>
      <p className="tiny">{st.overlayHelp}</p>
    </aside>
  );
}

function CycleRow({ label, value, onStep }: { label: string; value: string; onStep: (d: 1 | -1) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const cb = useRef(onStep);
  cb.current = onStep;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: Event) => cb.current((e as CustomEvent<number>).detail > 0 ? 1 : -1);
    el.addEventListener('navadjust', h);
    return () => el.removeEventListener('navadjust', h);
  }, []);
  return (
    <button ref={ref} type="button" className="dlist dlist--kv" data-nav="" data-nav-lr="" onClick={() => cb.current(1)}>
      <span>{label}</span>
      <span className="dlist__value"><span aria-hidden className="muted">‹</span>{value}<span aria-hidden className="muted">›</span></span>
    </button>
  );
}
