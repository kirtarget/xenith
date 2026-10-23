import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GpuStatus, Settings, SteamStatus, StreamProfile } from '../../../shared/api';
import { Button, cx } from '../../components/controls';
import { SettingRow, useRowId } from '../../components/data';
import { Badge, Skeleton, StatusDot, type Tone } from '../../components/feedback';
import { ListSelect, Modal } from '../../components/overlays';
import { useI18n, type I18n } from '../../i18n';
import { resolutionCap } from '../../lib/view';
import { loadHaptics, resetSettings, toast, updateSettings } from '../../state/actions';
import { getState, setState, useApp, type SettingsSection } from '../../state/store';
import { DeckRow, useAsync, type Opt, type RowSpec } from './rows';
import { reportAudioOutputs } from '../../lib/api';
import { cancelResume } from '../../state/session';

const opts = (rec: Record<string, string>, keys?: string[]): Opt[] => (keys ?? Object.keys(rec)).map(k => ({ value: k, label: rec[k] }));

export function sectionRows(section: SettingsSection, i18n: I18n, st: Settings, deck: boolean): RowSpec[] {
  const s = i18n.s.settings;
  const history = getState().history;
  switch (section) {
    case 'streaming': {
      const cap = resolutionCap(history, 'home');
      const resDesc = cap && cap < 1440 ? s.streaming.resolutionDescCapped(`${cap}p`) : s.streaming.resolutionDesc;
      return [
        { kind: 'custom', key: 'profile', desktop: <ProfileCards />, deck: null },
        ...(deck ? [{ kind: 'seg', path: 'streaming.profile', title: s.streaming.profile, options: opts(i18n.s.profiles.name), deckDesc: i18n.s.profiles.desc[st.streaming.profile] } as RowSpec] : []),
        { kind: 'group', title: s.streaming.image, key: 'image' },
        { kind: 'seg', path: 'streaming.resolution', title: s.streaming.resolution, desc: resDesc, deckDesc: st.streaming.resolution === '720' ? s.streaming.resolutionDeck : resDesc, options: opts(s.streaming.resolutionOpts, ['auto', '1440', '1080', '720']) },
        { kind: 'seg', path: 'streaming.bitrateMode', title: s.streaming.bitrate, desc: s.streaming.bitrateDesc, deckDesc: st.streaming.bitrateMode === 'auto' ? s.streaming.bitrateDeck : s.streaming.bitrateDesc, options: opts(s.streaming.bitrateOpts, ['auto', 'balanced', 'high', 'custom']) },
        {
          kind: 'slider', path: 'streaming.customKbps', title: s.streaming.custom, desc: s.streaming.customDesc, min: 5, max: 40, step: 1,
          toUi: v => Math.round(v / 1000), fromUi: v => v * 1000, format: v => `${v} ${i18n.s.units.mbps}`, disabled: st.streaming.bitrateMode !== 'custom',
        },
        { kind: 'seg', path: 'streaming.codec', title: s.streaming.codec, desc: s.streaming.codecDesc, options: opts(s.streaming.codecOpts, ['main', 'baseline']) },
        ...(deck ? [{ kind: 'custom', key: 'hw', deck: <HwDecodeDeckRow /> } as RowSpec] : []),
        { kind: 'toggle', path: 'streaming.autoConnectOnLaunch', title: s.streaming.autoConnect, desc: s.streaming.autoConnectDesc, deckTitle: s.streaming.autoConnectDeck, deckDesc: s.streaming.autoConnectDeckDesc },
      ];
    }
    case 'video': {
      const pct = { min: 50, max: 150, step: 5, toUi: (v: number) => Math.round(v * 100), fromUi: (v: number) => v / 100, format: (v: number) => `${v} %` };
      return [
        { kind: 'slider', path: 'video.sharpness', title: s.video.sharpness, desc: s.video.sharpnessDesc, min: 0, max: 10, step: 1, format: v => i18n.s.stream.sharpnessValue(v) },
        { kind: 'toggle', path: 'video.upscaleFsr', title: s.video.fsr, desc: s.video.fsrDesc },
        { kind: 'group', title: s.video.picture, key: 'pic' },
        { kind: 'slider', path: 'video.brightness', title: s.video.brightness, desc: s.video.pictureDesc, ...pct },
        { kind: 'slider', path: 'video.contrast', title: s.video.contrast, ...pct },
        { kind: 'slider', path: 'video.saturation', title: s.video.saturation, ...pct },
        { kind: 'seg', path: 'video.fit', title: s.video.fit, desc: s.video.fitDesc, options: opts(s.video.fitOpts, ['contain', 'cover', 'fill']) },
        { kind: 'seg', path: 'video.hud', title: s.video.hud, desc: s.video.hudDesc, options: opts(s.video.hudOpts, ['off', 'compact', 'full']) },
        { kind: 'seg', path: 'video.hudCorner', title: s.video.hudCorner, desc: s.video.hudCornerDesc, options: opts(s.video.cornerOpts, ['top-left', 'top-right', 'bottom-left', 'bottom-right']), select: true, disabled: st.video.hud === 'off' },
      ];
    }
    case 'audio':
      return [
        { kind: 'custom', key: 'out', desktop: <AudioOutputRow />, deck: <AudioOutputRow deck /> },
        { kind: 'slider', path: 'audio.volume', title: s.audio.volume, desc: s.audio.volumeDesc, min: 0, max: 100, step: 5, toUi: v => Math.round(v * 100), fromUi: v => v / 100, format: v => `${v} %` },
      ];
    case 'controllers':
      return [
        { kind: 'custom', key: 'pads', desktop: <ConnectedPads />, deck: <ConnectedPads deck /> },
        { kind: 'group', title: '', key: 'opts' },
        { kind: 'toggle', path: 'controllers.vibration', title: s.controllers.vibration, desc: s.controllers.vibrationDesc },
        { kind: 'toggle', path: 'controllers.triggerRumble', title: s.controllers.triggers, desc: s.controllers.triggersDesc, disabled: !st.controllers.vibration },
        { kind: 'slider', path: 'controllers.deadZone', title: s.controllers.deadZone, desc: s.controllers.deadZoneDesc, min: 0, max: 30, step: 1, toUi: v => Math.round(v * 100), fromUi: v => v / 100, format: v => `${v} %` },
        { kind: 'toggle', path: 'controllers.guideCombo', title: s.controllers.guide, desc: s.controllers.guideDesc },
        { kind: 'toggle', path: 'controllers.overlayCombo', title: s.controllers.overlay, desc: s.controllers.overlayDesc },
        { kind: 'toggle', path: 'controllers.mouseKeyboard', title: s.controllers.mkb, desc: s.controllers.mkbDesc },
        { kind: 'custom', key: 'remap', desktop: <RemapRow />, deck: <RemapRow deck /> },
      ];
    case 'haptics':
      return [{ kind: 'custom', key: 'haptics', desktop: <HapticsSection />, deck: <HapticsSection /> }];
    case 'network':
      return [
        { kind: 'custom', key: 'region', desktop: <RegionRow />, deck: <RegionRow deck /> },
        { kind: 'toggle', path: 'network.preferIPv6', title: s.network.ipv6, desc: s.network.ipv6Desc },
        { kind: 'custom', key: 'check', desktop: <NetworkCheck />, deck: <NetworkCheck /> },
      ];
    case 'steam':
      return [
        { kind: 'custom', key: 'status', desktop: <SteamBlock />, deck: <SteamBlock deck /> },
        { kind: 'toggle', path: 'steam.promptCloudShortcut', title: s.steam.cloudPrompt, desc: s.steam.cloudPromptDesc },
        { kind: 'seg', path: 'steam.artworkSource', title: s.steam.artwork, desc: s.steam.artworkDesc, options: opts(s.steam.artworkOpts, ['xcloud', 'none']) },
        { kind: 'custom', key: 'resync', desktop: <ResyncRow />, deck: <ResyncRow deck /> },
      ];
    case 'ui':
      return [
        { kind: 'seg', path: 'ui.lang', title: s.ui.lang, desc: s.ui.langDesc, options: opts(s.ui.langOpts, ['ru', 'en']) },
        { kind: 'seg', path: 'ui.scale', title: s.ui.scale, desc: s.ui.scaleDesc, options: opts(s.ui.scaleOpts, ['xs', 's', 'm', 'l', 'xl']) },
        { kind: 'seg', path: 'ui.layout', title: s.ui.layout, desc: s.ui.layoutDesc, options: opts(s.ui.layoutOpts, ['auto', 'desktop', 'deck']) },
        { kind: 'toggle', path: 'ui.startFullscreen', title: s.ui.fullscreen, desc: s.ui.fullscreenDesc },
        { kind: 'toggle', path: 'ui.showTips', title: s.ui.tips, desc: s.ui.tipsDesc },
      ];
    case 'advanced': {
      const os = getState().platform?.os ?? 'win32';
      const pipes = os === 'win32' ? ['auto', 'd3d11', 'vulkan', 'gl'] : ['auto', 'vulkan', 'gl'];
      return [
        { kind: 'seg', path: 'advanced.gpuMode', title: s.advanced.gpu, desc: s.advanced.gpuDesc, options: opts(s.advanced.gpuOpts, ['auto', 'high-performance', 'low-power']) },
        {
          kind: 'seg', path: 'advanced.renderPipeline', title: s.advanced.pipeline,
          desc: os === 'win32' && (st.advanced.renderPipeline === 'gl' || st.advanced.renderPipeline === 'vulkan')
            ? <>{s.advanced.pipelineDesc}<span className="row__warn">{s.advanced.pipelineSoftware}</span></>
            : s.advanced.pipelineDesc,
          options: opts({ ...s.advanced.pipelineOpts, auto: s.advanced.pipelineAuto }, pipes),
        },
        { kind: 'custom', key: 'gpu', desktop: <GpuBlock />, deck: <GpuBlock /> },
        { kind: 'custom', key: 'logs', desktop: <LogsRow />, deck: <LogsRow deck /> },
        { kind: 'custom', key: 'args', desktop: <ArgsBlock />, deck: <ArgsBlock /> },
        { kind: 'group', title: s.advanced.resetSettings, key: 'g-reset' },
        { kind: 'custom', key: 'reset', desktop: <ResetRows />, deck: <ResetRows deck /> },
      ];
    }
  }
}

// ─────────── Стриминг ───────────
function ProfileCards() {
  const { s } = useI18n();
  const profile = useApp(x => x.settings.streaming.profile);
  const list: StreamProfile[] = profile === 'battery' ? ['low-latency', 'quality', 'battery'] : ['low-latency', 'quality'];
  return (
    <section className="sgroup" aria-labelledby="p-title">
      <h3 id="p-title" className="sgroup__title">{s.settings.streaming.profile}</h3>
      <div role="radiogroup" aria-labelledby="p-title" className="pcards" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }} data-nav-region="">
        {list.map(p => (
          <button key={p} type="button" role="radio" aria-checked={profile === p} data-nav="" data-nav-id={`profile-${p}`} className={cx('pcard', profile === p && 'is-on')} onClick={() => updateSettings({ streaming: { profile: p } })}>
            <span className="pcard__title">{s.profiles.name[p]}</span>
            <span className="muted">{s.profiles.desc[p]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function HwDecodeDeckRow() {
  const { s } = useI18n();
  const [gpu] = useAsync<GpuStatus>(() => window.xenith.gpuStatus());
  const on = !!gpu && (gpu.hardwareH264 ?? /hardware/i.test(gpu.videoDecode));
  return <DeckRow title={s.settings.streaming.hwDecode} desc={gpu?.vaapi ? s.settings.streaming.hwDecodeDeck : gpu?.videoDecode} value={gpu ? (on ? s.settings.streaming.hwDecodeOn : s.settings.streaming.hwDecodeOff) : s.common.dash} valueTone={on ? 'ok' : undefined} onActivate={() => undefined} />;
}

// ─────────── Звук ───────────
function useAudioOutputs(): Opt[] | null {
  const { s } = useI18n();
  const [list, setList] = useState<Opt[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      let devs: { deviceId: string; label: string }[] = [];
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        devs = all.filter(d => d.kind === 'audiooutput' && !!d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map(d => ({ deviceId: d.deviceId, label: d.label }));
        if (devs.length) reportAudioOutputs(devs);
      } catch { /* fall back to main's cache */ }
      if (!devs.length) { try { devs = await window.xenith.audioOutputs(); } catch { /* none */ } }
      if (alive) setList([{ value: '', label: s.settings.audio.defaultDevice }, ...devs.map((d, i) => ({ value: d.deviceId, label: d.label || s.settings.audio.unnamed(i + 1) }))]);
    };
    void load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => { alive = false; navigator.mediaDevices?.removeEventListener?.('devicechange', load); };
  }, [s]);
  return list;
}

function AudioOutputRow({ deck, title, desc }: { deck?: boolean; title?: string; desc?: string }) {
  const { s } = useI18n();
  const id = useRowId('out');
  const value = useApp(x => x.settings.audio.outputDeviceId);
  const list = useAudioOutputs();
  const t = title ?? s.settings.audio.output, d = desc ?? s.settings.audio.outputDesc;
  const options = list ?? [{ value: '', label: s.settings.audio.defaultDevice }];
  const safe = options.some(o => o.value === value) ? value : '';
  const set = (v: string) => updateSettings({ audio: { outputDeviceId: v } });
  if (deck) {
    const i = options.findIndex(o => o.value === safe);
    return <DeckRow title={t} desc={d} value={options[i]?.label} cycle onStep={dd => set(options[(i + dd + options.length) % options.length].value)} />;
  }
  return <SettingRow title={t} titleId={id} desc={d} control={<ListSelect value={safe} options={options} onChange={set} title={t} labelledBy={id} navId="audio-out" minWidth={260} />} />;
}

// ─────────── Контроллеры ───────────
function ConnectedPads({ deck }: { deck?: boolean }) {
  const { s } = useI18n();
  const pads = useApp(x => x.controllers);
  return (
    <section className={cx('padlist', deck && 'padlist--deck')} aria-labelledby="pads-title">
      <h3 id="pads-title" className="sgroup__title">{s.settings.controllers.connected}</h3>
      {pads.length === 0 ? <p className="muted">{s.settings.controllers.none}</p> : (
        <ul className="padlist__items">
          {pads.map(p => (
            <li key={`${p.index}-${p.id}`} className="padlist__item">
              <StatusDot tone="ok" />
              <span className="padlist__name">{p.name}</span>
              <span className="muted">{[s.home.connection[p.connection], p.isFlydigi ? 'Flydigi' : ''].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RemapRow({ deck }: { deck?: boolean }) {
  const { s } = useI18n();
  const remap = useApp(x => x.settings.controllers.remap);
  const n = Object.keys(remap).length;
  const desc = n ? s.settings.controllers.remapCustom(n) : s.settings.controllers.remapDefault;
  const reset = () => updateSettings({ controllers: { remap: {} } }, { immediate: true });
  if (deck) return <DeckRow title={s.settings.controllers.remap} desc={desc} value={n ? s.settings.controllers.remapReset : undefined} onActivate={n ? reset : () => undefined} />;
  return <SettingRow title={s.settings.controllers.remap} desc={desc} last control={n ? <Button variant="outline" onClick={reset}>{s.settings.controllers.remapReset}</Button> : null} />;
}

// ─────────── X-Haptics ───────────
const FLYDIGI_URL = 'https://www.flydigi.com/download';
const toneOf = (st: string): Tone => st === 'ok' ? 'ok' : st === 'warn' ? 'warn' : st === 'fail' ? 'bad' : 'idle';

function playTestTone(sinkId: string) {
  const Ctx = window.AudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const anyCtx = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  const go = () => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 60;   // low tone the haptics engine reacts to
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.6, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1);
    osc.onended = () => void ctx.close();
  };
  if (sinkId && anyCtx.setSinkId) anyCtx.setSinkId(sinkId).then(go, go); else go();
}

function HapticsSection() {
  const { s, f } = useI18n();
  const h = s.settings.haptics;
  const diag = useApp(x => x.haptics);
  const sess = useApp(x => x.session);
  const bridge = useApp(x => x.settings.haptics.bridgeMode);
  const out = useApp(x => x.settings.audio.outputDeviceId);
  const deck = useApp(x => x.deck);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void loadHaptics(); }, []);
  const recheck = async () => { setBusy(true); setState({ haptics: null }); try { await loadHaptics(); } finally { setBusy(false); } };

  const live = sess && (sess.phase === 'streaming' || sess.phase === 'reconnecting');
  const rumble = (live && sess.lastRumble) ? { at: sess.lastRumble.at, l: sess.lastRumble.left, r: sess.lastRumble.right } : diag?.rumble.last && diag.rumble.lastEventAt ? { at: diag.rumble.lastEventAt, l: diag.rumble.last.left, r: diag.rumble.last.right } : null;

  type Check = { key: string; tone: Tone; title: string; body: string; right: ReactNode };
  const det = (x: unknown): string | undefined => (x as { detail?: string } | undefined)?.detail || undefined;
  const checks: Check[] = diag ? [
    {
      key: 'dev', tone: toneOf(diag.flydigiDevice.state), title: h.flydigi,
      body: det(diag.flydigiDevice) ?? (diag.flydigiDevice.state === 'ok' && diag.flydigiDevice.name ? h.flydigiFound(diag.flydigiDevice.name, diag.flydigiDevice.connection ? s.home.connection[diag.flydigiDevice.connection] : '') : h.flydigiMissing),
      right: <span className={diag.flydigiDevice.state === 'ok' ? 'ok-text' : 'warn-text'}>{diag.flydigiDevice.state === 'ok' ? h.stateYes : h.stateNo}</span>,
    },
    {
      key: 'station', tone: toneOf(diag.spaceStation.state), title: h.station,
      body: det(diag.spaceStation) ?? (!diag.spaceStation.installed ? h.stationMissing : !diag.spaceStation.running ? h.stationStopped : h.stationRunning(diag.spaceStation.version)),
      right: !diag.spaceStation.installed
        ? <a href={FLYDIGI_URL} data-nav="" className="link" onClick={e => { e.preventDefault(); void window.xenith.openExternal(FLYDIGI_URL); }}>{h.download}</a>
        : <span className={diag.spaceStation.running ? 'ok-text' : 'warn-text'}>{diag.spaceStation.running ? h.stateWorks : h.stateWarn}</span>,
    },
    {
      key: 'audio', tone: toneOf(diag.gameAudio.state), title: h.audio,
      body: det(diag.gameAudio) ?? (diag.gameAudio.deviceLabel ? h.audioOn(diag.gameAudio.deviceLabel) : h.audioNone),
      right: <span className={diag.gameAudio.state === 'ok' ? 'ok-text' : 'warn-text'}>{diag.gameAudio.state === 'ok' ? h.stateYes : h.stateNo}</span>,
    },
    {
      key: 'reach', tone: toneOf(diag.audioReachesEngine.state), title: h.reaches,
      body: det(diag.audioReachesEngine) ?? (diag.audioReachesEngine.state === 'ok' ? h.reachesOk : diag.audioReachesEngine.state === 'fail' ? h.reachesFail : h.reachesUnknown),
      right: <span className={diag.audioReachesEngine.state === 'ok' ? 'ok-text' : diag.audioReachesEngine.state === 'fail' ? 'bad-text' : 'muted'}>{diag.audioReachesEngine.state === 'ok' ? h.stateWorks : diag.audioReachesEngine.state === 'fail' ? h.stateNo : h.stateUnknown}</span>,
    },
    {
      key: 'rumble', tone: rumble ? 'ok' : toneOf(diag.rumble.state), title: h.rumble,
      body: rumble ? h.rumbleLast(h.ago(Math.max(1, Math.round((Date.now() - rumble.at) / 1000))), Math.round(rumble.l * 100), Math.round(rumble.r * 100)) : det(diag.rumble) ?? h.rumbleNone,
      right: <span className={rumble ? 'ok-text' : 'muted'}>{rumble ? h.stateWorks : h.stateUnknown}</span>,
    },
  ] : [];

  return (
    <div className="haptics">
      <section className="checks" aria-labelledby="check-title" aria-busy={!diag}>
        <h3 id="check-title" className="sr-only">{h.checks}</h3>
        {!diag ? Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="check"><Skeleton w={10} h={10} r={5} style={{ marginTop: 6 }} /><span className="stack-4"><Skeleton w={180} h={14} r={7} /><Skeleton w="70%" h={12} r={6} /></span><span /></div>
        )) : checks.map(c => (
          <div key={c.key} className="check">
            <StatusDot tone={c.tone} size={10} className="check__dot" />
            <span className="check__text"><span className="check__title">{c.title}</span><span className="muted">{c.body}</span></span>
            <span className="check__right">{c.right}</span>
          </div>
        ))}
      </section>

      {live && (
        <section className="hlive" aria-label={h.live}>
          <span className="muted">{h.liveLevel}</span>
          <span className="meter" aria-hidden><span style={{ width: `${Math.round(Math.min(1, sess.audioLevel) * 100)}%` }} /></span>
          <span className="num">{f.pct(Math.min(1, sess.audioLevel) * 100)}</span>
        </section>
      )}

      <div className="btnrow">
        <Button variant="secondary" size="l" navDefault disabled={busy} onClick={() => void recheck()}>{h.recheck}</Button>
        <Button variant="secondary" size="l" onClick={() => playTestTone(out)}>{h.testSound}</Button>
      </div>

      <section className="bridge" aria-labelledby="bridge-title">
        <label className="bridge__top">
          <span className="stack-4">
            <span id="bridge-title" className="bridge__title">{h.bridge}</span>
            <span className="muted">{h.bridgeDesc}</span>
          </span>
          <input type="checkbox" role="switch" className="toggle" data-nav="" aria-labelledby="bridge-title" checked={bridge} onChange={e => updateSettings({ haptics: { bridgeMode: e.currentTarget.checked } })} />
        </label>
        <AudioOutputInline deck={deck} />
      </section>
    </div>
  );
}

function AudioOutputInline({ deck }: { deck: boolean }) {
  const { s } = useI18n();
  const id = useRowId('hout');
  const value = useApp(x => x.settings.audio.outputDeviceId);
  const list = useAudioOutputs() ?? [{ value: '', label: s.settings.audio.defaultDevice }];
  const safe = list.some(o => o.value === value) ? value : '';
  return (
    <div className="kv kv--center">
      <span id={id} className="muted">{s.settings.haptics.output}</span>
      <ListSelect value={safe} options={list} onChange={v => updateSettings({ audio: { outputDeviceId: v } })} title={s.settings.haptics.output} labelledBy={id} minWidth={deck ? 300 : 260} />
    </div>
  );
}

// ─────────── Сеть ───────────
function RegionRow({ deck }: { deck?: boolean }) {
  const { s } = useI18n();
  const n = s.settings.network;
  const id = useRowId('reg');
  const value = useApp(x => x.settings.network.regionName);
  const [regions] = useAsync(() => window.xenith.regions());
  const def = regions?.find(r => r.isDefault)?.name ?? null;
  const options: Opt[] = [{ value: '', label: n.regionAuto(def) }, ...(regions ?? []).map(r => ({ value: r.name, label: r.name }))];
  const v = value ?? '';
  const set = (x: string) => updateSettings({ network: { regionName: x || null } });
  if (deck) {
    const i = Math.max(0, options.findIndex(o => o.value === v));
    return <DeckRow title={n.region} desc={n.regionDesc} value={options[i]?.label} cycle onStep={d => set(options[(i + d + options.length) % options.length].value)} />;
  }
  return <SettingRow title={n.region} titleId={id} desc={n.regionDesc} control={<ListSelect value={v} options={options} onChange={set} title={n.region} labelledBy={id} navId="region" />} />;
}

function NetworkCheck() {
  const { s, f } = useI18n();
  const n = s.settings.network;
  const history = useApp(x => x.history);
  const last = history?.[0] ?? null;
  return (
    <section className="panel" aria-labelledby="net-title">
      <h3 id="net-title" className="panel__title">{n.check}</h3>
      <p className="muted">{last ? n.checkDesc : n.checkNone}</p>
      {last && (
        <dl className="stats3">
          <div><dt>{n.lastBitrate}</dt><dd>{f.mbps(last.avgKbps)}</dd></div>
          <div><dt>{n.lastLoss}</dt><dd className={last.packetsLost ? 'warn-text' : 'ok-text'}>{last.packetsLost}</dd></div>
          <div><dt>{s.home.railFirstFrame}</dt><dd>{last.connectMs != null ? f.sec(last.connectMs) : s.common.dash}</dd></div>
        </dl>
      )}
      <p className="tiny">{n.portHelp}</p>
    </section>
  );
}

// ─────────── Steam ───────────
function SteamBlock({ deck }: { deck?: boolean }) {
  const { s } = useI18n();
  const t = s.settings.steam;
  const [st, reload] = useAsync<SteamStatus>(() => window.xenith.steamStatus());
  const keep = useApp(x => x.settings.steam.maintainLibraryShortcut);
  const consoles = useApp(x => x.consoles);
  const selectedServerId = useApp(x => x.selectedServerId);
  const isSteamDeck = useApp(x => x.platform?.isSteamDeck);
  const console = consoles?.find(c => c.serverId === selectedServerId) ?? consoles?.[0];
  const [busy, setBusy] = useState(false);
  const statusText = !st ? s.common.loading : !st.installed ? t.notInstalled : st.running ? t.running : t.stopped;
  const addNow = async () => {
    setBusy(true);
    try { const r = await window.xenith.steamAddLibraryShortcut(); toast(r.message || t.restartSteam, r.ok ? 'ok' : 'bad', 6000); reload(); }
    finally { setBusy(false); }
  };
  const run = async (action: () => Promise<{ ok: boolean; message: string }>) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      toast(result.message || (result.ok ? t.restartSteam : t.actionFailed), result.ok ? 'ok' : 'bad', 10000);
    } catch { toast(t.actionFailed, 'bad'); }
    finally { setBusy(false); }
  };
  const addConsole = () => { if (console) void run(() => window.xenith.steamAddConsoleShortcut(console.serverId)); };
  const installLayout = () => void run(() => window.xenith.steamInstallDeckLayout());
  if (deck) {
    return (
      <>
        <DeckRow title={t.status} value={statusText} valueTone={st?.installed ? 'ok' : undefined} onActivate={reload} />
        <DeckRow title={t.library} desc={t.libraryDesc} value={keep ? s.common.yes : s.common.no} onActivate={() => updateSettings({ steam: { maintainLibraryShortcut: !keep } })} onStep={() => updateSettings({ steam: { maintainLibraryShortcut: !keep } })} disabled={!st?.installed} />
        <DeckRow navId="steam-console" title={t.consoleTile} desc={console ? `${console.name}. ${t.consoleTileDesc}` : t.noConsole} value={t.addNow} onActivate={addConsole} disabled={!st?.installed || !console || busy} />
        {isSteamDeck && <DeckRow navId="steam-layout" title={t.deckLayout} desc={t.deckLayoutDesc} value={t.installLayout} onActivate={installLayout} disabled={!st?.installed || busy} />}
      </>
    );
  }
  return (
    <>
      <SettingRow title={t.status} desc={st?.userIds.length ? `ID: ${st.userIds.join(', ')}` : undefined} control={<span className="status-inline"><StatusDot tone={!st ? 'idle' : st.installed ? 'ok' : 'warn'} />{statusText}</span>} />
      <label className={cx('row row--toggle', !st?.installed && 'is-disabled')}>
        <span className="row__text">
          <span id="steam-lib" className="row__title">{t.library}</span>
          <span className="row__desc">{t.libraryDesc}</span>
        </span>
        <span className="row__control row__control--gap">
          {st?.installed && (st.libraryShortcut ? <Badge tone="ok">{t.added}</Badge> : <Button variant="secondary" size="s" disabled={busy} onClick={e => { e.preventDefault(); void addNow(); }}>{t.addNow}</Button>)}
          <input type="checkbox" role="switch" className="toggle" data-nav="" aria-labelledby="steam-lib" disabled={!st?.installed} checked={keep} onChange={e => updateSettings({ steam: { maintainLibraryShortcut: e.currentTarget.checked } })} />
        </span>
      </label>
      <SettingRow title={t.consoleTile} desc={console ? `${console.name}. ${t.consoleTileDesc}` : t.noConsole} control={<Button navId="steam-console" variant="secondary" disabled={!st?.installed || !console || busy} onClick={addConsole}>{t.addNow}</Button>} />
      {isSteamDeck && <SettingRow title={t.deckLayout} desc={t.deckLayoutDesc} control={<Button navId="steam-layout" variant="secondary" disabled={!st?.installed || busy} onClick={installLayout}>{t.installLayout}</Button>} />}
    </>
  );
}

function ResyncRow({ deck }: { deck?: boolean }) {
  const { s } = useI18n();
  const t = s.settings.steam;
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await window.xenith.steamResyncArtwork(); toast(r.ok ? `${t.resynced(r.count)}. ${t.restartSteam}` : t.notInstalled, r.ok ? 'ok' : 'bad', 6000); }
    finally { setBusy(false); }
  };
  if (deck) return <DeckRow title={t.resync} onActivate={() => void run()} disabled={busy} />;
  return <SettingRow title={t.resync} last control={<Button variant="secondary" disabled={busy} onClick={() => void run()}>{t.resync}</Button>} />;
}

// ─────────── Дополнительно ───────────
function GpuBlock() {
  const { s } = useI18n();
  const a = s.settings.advanced;
  const [gpu, , failed] = useAsync<GpuStatus>(() => window.xenith.gpuStatus());
  const os = useApp(x => x.platform?.os);
  return (
    <section className="panel" aria-labelledby="gpu-title" aria-busy={!gpu && !failed}>
      <h3 id="gpu-title" className="panel__title">{a.status}</h3>
      {!gpu ? (failed ? <p className="muted">{s.common.unknown}</p> : <><Skeleton w="60%" h={14} r={7} /><Skeleton w="40%" h={14} r={7} /></>) : (
        <dl className="kvlist">
          <div><dt>{a.statusGpu}</dt><dd>{gpu.gpu ?? s.common.unknown}</dd></div>
          <div><dt>{a.statusDecode}</dt><dd className={/hardware/i.test(gpu.videoDecode) ? 'ok-text' : 'warn-text'}>{gpu.videoDecode}</dd></div>
          {gpu.hardwareH264 != null && <div><dt>{a.statusH264}</dt><dd className={gpu.hardwareH264 ? 'ok-text' : 'warn-text'}>{gpu.hardwareH264 ? a.h264Hw : a.h264Sw}</dd></div>}
          {gpu.angle && <div><dt>{a.statusAngle}</dt><dd>{gpu.angle}</dd></div>}
          {os === 'linux' && <div><dt>{a.statusVaapi}</dt><dd className={gpu.vaapi ? 'ok-text' : 'warn-text'}>{gpu.vaapi == null ? s.common.unknown : gpu.vaapi ? s.common.on : s.common.off}</dd></div>}
          {gpu.decodeProfiles.length > 0 && <div className="kvlist__wide"><dt>{a.statusProfiles}</dt><dd className="mono-list">{gpu.decodeProfiles.slice(0, 6).map(p => <span key={p}>{p}</span>)}</dd></div>}
        </dl>
      )}
    </section>
  );
}

function LogsRow({ deck }: { deck?: boolean }) {
  const { s } = useI18n();
  const a = s.settings.advanced;
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const p = await window.xenith.exportLogs(); toast(a.logsSaved(p), 'ok', 8000); } finally { setBusy(false); }
  };
  if (deck) return <DeckRow title={a.exportLogs} desc={a.logsDesc} onActivate={() => void run()} disabled={busy} />;
  return <SettingRow title={a.logs} desc={a.logsDesc} control={<Button variant="secondary" disabled={busy} onClick={() => void run()}>{a.exportLogs}</Button>} />;
}

function ArgsBlock() {
  const { s } = useI18n();
  const a = s.settings.advanced;
  return (
    <section className="panel" aria-labelledby="args-title">
      <h3 id="args-title" className="panel__title">{a.args}</h3>
      <p className="muted">{a.argsDesc}</p>
      <dl className="args">
        <div><dt><code>--xhome</code></dt><dd>{a.argXhome}</dd></div>
        <div><dt><code>--xcloud=&lt;titleId&gt;</code></dt><dd>{a.argXcloud}</dd></div>
      </dl>
    </section>
  );
}

function ResetRows({ deck }: { deck?: boolean }) {
  const { s } = useI18n();
  const a = s.settings.advanced;
  const [which, setWhich] = useState<'settings' | 'all' | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const ask = (w: 'settings' | 'all') => { opener.current = document.activeElement as HTMLElement; setWhich(w); };
  return (
    <>
      {deck ? (
        <>
          <DeckRow title={a.resetSettings} desc={a.resetSettingsDesc} onActivate={() => ask('settings')} />
          <DeckRow title={a.resetAll} desc={a.resetAllDesc} onActivate={() => ask('all')} />
        </>
      ) : (
        <>
          <SettingRow title={a.resetSettings} desc={a.resetSettingsDesc} control={<Button variant="outline" onClick={() => ask('settings')}>{a.resetSettingsConfirm}</Button>} />
          <SettingRow title={a.resetAll} desc={a.resetAllDesc} last control={<Button variant="danger" onClick={() => ask('all')}>{a.resetAll}</Button>} />
        </>
      )}
      <Modal
        open={which === 'settings'}
        title={a.resetSettingsTitle}
        body={a.resetSettingsBody}
        confirmLabel={a.resetSettingsConfirm}
        danger
        onCancel={() => setWhich(null)}
        onConfirm={async () => { await resetSettings(); setWhich(null); }}
      />
      <Modal
        open={which === 'all'}
        title={a.resetAllTitle}
        body={a.resetAllBody}
        confirmLabel={a.resetAllConfirm}
        danger
        onCancel={() => setWhich(null)}
        onConfirm={async () => { cancelResume(); await window.xenith.resetAllData(); setWhich(null); }}
      />
    </>
  );
}
