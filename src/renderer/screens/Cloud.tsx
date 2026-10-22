import { useEffect, useMemo, useRef, useState } from 'react';
import type { CloudTitle, SteamStatus } from '../../shared/api';
import { Button, cx } from '../components/controls';
import { CoverCard, HintBar } from '../components/data';
import { EmptyState, Skeleton, StatusDot } from '../components/feedback';
import { Sheet } from '../components/overlays';
import { IconPlay, IconSearch } from '../components/Icons';
import { useI18n } from '../i18n';
import { focusEl } from '../nav/engine';
import { useNavLayer, useScreenFocus } from '../nav/hooks';
import { go, loadCloud, toast } from '../state/actions';
import { connect } from '../state/session';
import { setState, useApp } from '../state/store';
import { AccountChip } from './Account';
import { ErrorCard } from './errors';

type Chip = 'all' | 'recent' | 'mkb' | 'steam';
const CHIPS: Chip[] = ['all', 'recent', 'mkb', 'steam'];

let steamCache: SteamStatus | null = null;

export function Cloud() {
  const { s } = useI18n();
  const deck = useApp(x => x.deck);
  const account = useApp(x => x.account);
  const titles = useApp(x => x.cloud);
  const failed = useApp(x => x.cloudFailed);
  const history = useApp(x => x.history);
  const regionName = useApp(x => x.settings.network.regionName);
  const [regions, setRegions] = useState<{ name: string; isDefault: boolean }[] | null>(null);
  const [q, setQ] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const [open, setOpen] = useState<CloudTitle | null>(null);
  const [steam, setSteam] = useState<SteamStatus | null>(steamCache);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void loadCloud(); }, []);
  useEffect(() => {
    window.xenith.regions().then(setRegions).catch(() => setRegions([]));
    window.xenith.steamStatus().then(st => { steamCache = st; setSteam(st); }).catch(() => undefined);
  }, []);

  const recentIds = useMemo(() => Array.from(new Set((history ?? []).filter(h => h.kind === 'cloud').map(h => h.targetId))), [history]);
  const list = useMemo(() => {
    if (!titles) return null;
    let l = titles;
    if (chip === 'recent') l = recentIds.map(id => titles.find(t => t.titleId === id)).filter((t): t is CloudTitle => !!t);
    if (chip === 'mkb') l = l.filter(t => t.supportsMouseKeyboard);
    if (chip === 'steam') l = l.filter(t => t.inSteam);
    const needle = q.trim().toLocaleLowerCase();
    if (needle) l = l.filter(t => t.name.toLocaleLowerCase().includes(needle) || (t.publisher ?? '').toLocaleLowerCase().includes(needle));
    return l;
  }, [titles, chip, q, recentIds]);

  const addToSteam = async (t: CloudTitle) => {
    try {
      const r = await window.xenith.steamAddCloudShortcut(t.titleId);
      toast(r.message || s.settings.steam.restartSteam, r.ok ? 'ok' : 'bad', 6000);
      if (r.ok) setState(st => ({ cloud: st.cloud?.map(c => c.titleId === t.titleId ? { ...c, inSteam: true } : c) ?? null }));
    } catch { toast(s.cloud.steamMissing, 'bad'); }
  };
  const focusedTitle = (): CloudTitle | null => {
    const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-nav-id^="game-"]')?.dataset.navId?.slice(5);
    return titles?.find(t => t.titleId === id) ?? null;
  };

  useNavLayer({
    y: () => { focusEl(searchRef.current); return true; },
    x: () => { const t = focusedTitle(); if (t && !t.inSteam && steam?.installed) void addToSteam(t); return true; },
    b: () => { if (q) { setQ(''); return true; } go('home'); return true; },
  });
  useScreenFocus('cloud', titles !== null);

  const regionLabel = regionName ?? regions?.find(r => r.isDefault)?.name ?? null;
  const desc = regionLabel ? (regionName ? s.cloud.descChosen(regionLabel) : s.cloud.descAuto(regionLabel)) : s.cloud.descNoRegion;
  const meta = (t: CloudTitle) => t.inSteam ? s.cloud.metaSteam : t.supportsMouseKeyboard ? s.cloud.metaMkb : s.cloud.metaPad;

  const hints = [
    { k: 'a' as const, label: s.hints.play },
    ...(steam?.installed ? [{ k: 'x' as const, label: s.hints.addSteam }] : []),
    { k: 'y' as const, label: s.hints.search },
  ];

  if (account?.hasCloud === false) {
    return (
      <div className={deck ? 'page page--deck' : 'page'}>
        {!deck && <header className="page__head"><h1 className="page__title">{s.cloud.title}</h1><AccountChip /></header>}
        <ErrorCard code="no_cloud_entitlement" className="hero hero--state" deck={deck} />
        <HintBar hints={[{ k: 'a', label: s.hints.select }, { k: 'b', label: s.hints.back }]} />
      </div>
    );
  }

  return (
    <div className={deck ? 'page page--deck' : 'page page--cloud'}>
      <header className="cloud-head">
        <div className="cloud-head__text">
          {!deck && <h1 className="page__title">{s.cloud.title}</h1>}
          <p className="muted">{desc}</p>
        </div>
        <label className="search">
          <IconSearch />
          <span className="sr-only">{s.cloud.searchLabel}</span>
          <input
            ref={searchRef}
            type="search"
            data-nav=""
            data-nav-id="search"
            placeholder={s.cloud.searchPh}
            value={q}
            onChange={e => setQ(e.currentTarget.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
          />
        </label>
      </header>

      <div role="tablist" aria-label={s.cloud.chipsAria} className="chips" data-nav-region="">
        {CHIPS.map(c => (
          <button key={c} type="button" role="tab" aria-selected={chip === c} data-nav="" data-nav-id={`chip-${c}`} className={cx('chipf', chip === c && 'is-on')} onClick={() => setChip(c)}>
            {s.cloud.chips[c]}
          </button>
        ))}
      </div>

      {failed ? <ErrorCard code="network" className="hero hero--state" /> :
        list === null ? <CoverGridSkeleton /> :
          list.length === 0 ? <CloudEmpty chip={chip} q={q} onAll={() => { setChip('all'); setQ(''); }} /> : (
            <div className="covers" data-nav-region="">
              {list.map(t => (
                <CoverCard
                  key={t.titleId}
                  navId={`game-${t.titleId}`}
                  name={t.name}
                  meta={meta(t)}
                  coverUrl={t.coverUrl}
                  label={s.cloud.open(t.name)}
                  onOpen={() => setOpen(t)}
                />
              ))}
            </div>
          )}

      <HintBar hints={hints} />
      <GameSheet title={open} onClose={() => setOpen(null)} steam={steam} onAdd={addToSteam} />
    </div>
  );
}

function CloudEmpty({ chip, q, onAll }: { chip: Chip; q: string; onAll: () => void }) {
  const { s } = useI18n();
  const c = s.cloud;
  const [title, body] = q.trim() ? [c.nothingFound, c.nothingFoundBody(q.trim())]
    : chip === 'recent' ? [c.recentEmpty, c.recentEmptyBody]
      : chip === 'steam' ? [c.steamEmpty, c.steamEmptyBody]
        : chip === 'mkb' ? [c.mkbEmpty, c.mkbEmptyBody]
          : [c.nothingFound, ''];
  return <EmptyState tone="idle" title={title} body={body} className="cloud-empty" actions={<Button variant="primary" navDefault onClick={onAll}>{c.showAll}</Button>} />;
}

function CoverGridSkeleton() {
  return (
    <div className="covers" aria-busy="true">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="cover">
          <Skeleton h="auto" r={14} className="cover__art cover__art--skel" />
          <Skeleton w="80%" h={14} r={7} />
          <Skeleton w="50%" h={12} r={6} />
        </div>
      ))}
    </div>
  );
}

function GameSheet({ title, onClose, steam, onAdd }: { title: CloudTitle | null; onClose: () => void; steam: SteamStatus | null; onAdd: (t: CloudTitle) => Promise<void> }) {
  const { s } = useI18n();
  const [busy, setBusy] = useState(false);
  const live = useApp(x => x.cloud?.find(c => c.titleId === title?.titleId) ?? null);
  const t = live ?? title;
  return (
    <Sheet open={!!t} title={t?.name ?? ''} onClose={onClose} width={420}>
      {t && <>
        <div className="game">
          <div className="game__art">
            {t.heroUrl || t.coverUrl ? <img src={t.heroUrl ?? t.coverUrl!} alt="" loading="lazy" /> : <span className="cover__ph">{t.name.slice(0, 2).toUpperCase()}</span>}
          </div>
          {t.publisher && <span className="muted">{t.publisher}</span>}
          <span className="game__feat"><StatusDot tone={t.supportsMouseKeyboard ? 'ok' : 'idle'} />{t.supportsMouseKeyboard ? s.cloud.supportsMkb : s.cloud.padOnly}</span>
        </div>
        <div className="sheet__spacer" />
        <div className="stack-8">
          <Button variant="primary" size="l" block navDefault icon={<IconPlay />} onClick={() => { onClose(); void connect('cloud', t.titleId, t.name); }}>{s.cloud.play}</Button>
          <Button
            variant="secondary"
            size="l"
            block
            disabled={busy || t.inSteam || !steam?.installed}
            onClick={async () => { setBusy(true); try { await onAdd(t); } finally { setBusy(false); } }}
          >
            {t.inSteam ? s.cloud.inSteam : s.cloud.addSteam}
          </Button>
          {steam && !steam.installed && <span className="tiny">{s.cloud.steamMissing}</span>}
        </div>
      </>}
    </Sheet>
  );
}
