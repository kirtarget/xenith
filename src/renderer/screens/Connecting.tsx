import { Button } from '../components/controls';
import { HintBar, Rail } from '../components/data';
import { useI18n } from '../i18n';
import { liveRail, useNow } from '../lib/view';
import { useNavLayer, useScreenFocus } from '../nav/hooks';
import { disconnect, dismissError } from '../state/session';
import { useApp } from '../state/store';
import { AccountChip } from './Account';
import { ErrorCard } from './errors';

export function Connecting() {
  const i18n = useI18n();
  const { s } = i18n;
  const sess = useApp(x => x.session);
  const deck = useApp(x => x.deck);
  const settings = useApp(x => x.settings);
  const pads = useApp(x => x.controllers);
  const showTips = useApp(x => x.settings.ui.showTips);
  const phase = sess?.phase;
  const now = useNow(100, phase === 'connecting');

  useNavLayer({ b: () => { if (phase === 'error') dismissError(); else void disconnect(); return true; } });
  useScreenFocus(`connecting-${phase}`, !!sess);

  if (!sess) return null;
  const c = s.connecting;
  const cloud = sess.kind === 'cloud';
  const rail = liveRail(i18n, sess, now);
  const pad = pads.find(p => !p.isDeck) ?? pads[0];
  const st = settings.streaming;
  const requested = st.resolution === 'auto' ? c.requestedAuto : c.requestedFixed(`${s.settings.streaming.resolutionOpts[st.resolution]}`);
  const codec = s.settings.streaming.codecOpts[st.codec];

  return (
    <div className={deck ? 'page page--deck' : 'page'}>
      {!deck && (
        <header className="page__head">
          <p className="page__eyebrow">{cloud ? s.cloud.title : s.home.myConsole}</p>
          <AccountChip />
        </header>
      )}
      {phase === 'error' && sess.error ? (
        <div className="stack-16">
          <ErrorCard code={sess.error.code} className="hero hero--state" deck={deck} />
          <div className="hero hero--quiet"><Rail items={rail} label={c.stagesAria} live /></div>
        </div>
      ) : (
        <section className="hero hero--connecting" aria-labelledby="conn-title" aria-live="polite">
          <div className="hero__id">
            <h1 id="conn-title" className="hero__title">{cloud ? c.titleCloud(sess.targetName) : c.titleHome(sess.targetName)}</h1>
            <p className="muted hero__lead">{cloud ? c.bodyCloud : c.bodyHome}</p>
          </div>
          <Rail items={rail} label={c.stagesAria} live />
          <div className="hero__cta">
            <Button variant="outline" size="xl" navDefault onClick={() => void disconnect()}>{s.common.cancel}</Button>
            {showTips && <span className="muted">{cloud ? c.tipCloud : c.tipHome}</span>}
          </div>
        </section>
      )}
      <section className="cards3" aria-labelledby="while">
        <h2 id="while" className="sr-only">{c.params}</h2>
        <div className="card card--tight">
          <span className="muted">{c.requested}</span>
          <span className="card__value card__value--m">{requested}</span>
          <span className="muted">{c.actualAfter}</span>
        </div>
        <div className="card card--tight">
          <span className="muted">{c.profile}</span>
          <span className="card__value card__value--m">{s.profiles.name[st.profile]}</span>
          <span className="muted">{codec}, {s.profiles.tech[st.profile]}</span>
        </div>
        <div className="card card--tight">
          <span className="muted">{c.controller}</span>
          <span className="card__value card__value--m">{pad?.name ?? s.home.noController}</span>
          <span className="muted">{pad ? c.controllerBody : s.home.noControllerBody}</span>
        </div>
      </section>
      <HintBar hints={[{ k: 'b', label: phase === 'error' ? s.hints.back : s.hints.cancelConnect }]} />
    </div>
  );
}
