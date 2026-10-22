import { useEffect } from 'react';
import { Button } from '../components/controls';
import { HintBar } from '../components/data';
import { Skeleton, StatusDot } from '../components/feedback';
import { XenithMark } from '../components/Icons';
import { useI18n } from '../i18n';
import { useNow } from '../lib/view';
import { useNavLayer, useScreenFocus } from '../nav/hooks';
import { startLogin, toast } from '../state/actions';
import { getState, useApp } from '../state/store';

export function Login() {
  const { s } = useI18n();
  const l = s.login;
  const login = useApp(x => x.login);
  const deck = useApp(x => x.deck);
  const now = useNow(1000, login.status === 'waiting');

  useEffect(() => {
    const st = getState().login.status;
    if (st === 'idle' || st === 'done') void startLogin();
    return () => { if (getState().login.status === 'waiting') void window.xenith.loginCancel(); };
  }, []);
  useNavLayer({ b: () => true });
  useScreenFocus(`login-${login.status}`, login.status !== 'loading');

  const code = login.code?.userCode ?? '';
  const pretty = code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
  const minsLeft = login.code ? Math.floor((login.code.expiresAt - now) / 60000) : 0;
  const copy = async () => { await window.xenith.copyText(code); toast(l.copied, 'ok'); };
  const open = () => void window.xenith.openExternal(login.code?.verificationUri ?? 'https://www.microsoft.com/link');

  let card;
  if (login.status === 'expired' || login.status === 'error') {
    const expired = login.status === 'expired';
    card = (
      <section className="login__card" aria-labelledby="code-title" aria-live="polite">
        <h2 id="code-title" className="card__label">{l.codeTitle}</h2>
        <p className="login__code login__code--dead">{expired ? pretty : '—'}</p>
        <div className="login__status">
          <span className="login__line"><StatusDot tone={expired ? 'warn' : 'bad'} />{expired ? l.expired : l.error}</span>
          <span className="muted">{expired ? l.expiredBody : l.errorBody}</span>
        </div>
        <Button variant="primary" size="l" navDefault onClick={() => void startLogin()}>{expired ? l.newCode : s.common.retry}</Button>
      </section>
    );
  } else {
    const loading = login.status === 'loading' || !login.code;
    card = (
      <section className="login__card" aria-labelledby="code-title" aria-busy={loading}>
        <h2 id="code-title" className="card__label">{l.codeTitle}</h2>
        {loading ? <Skeleton w={300} h={56} r={10} /> : <p className="login__code" aria-live="polite" aria-label={code.split('').join(' ')}>{pretty}</p>}
        <div className="login__actions">
          <Button variant="primary" size="l" navDefault disabled={loading} onClick={() => void copy()}>{l.copy}</Button>
          <Button variant="outline" size="l" disabled={loading} onClick={open}>{l.openSite}</Button>
        </div>
        <div className="login__status">
          <span className="login__line"><StatusDot tone={loading ? 'idle' : 'ok'} />{loading ? l.gettingCode : login.status === 'done' ? l.done : l.waiting}</span>
          {!loading && <span className="muted">{minsLeft >= 1 ? l.expiresIn(minsLeft) : l.expiresSoon}</span>}
        </div>
      </section>
    );
  }

  return (
    <div className={deck ? 'login login--deck' : 'login'}>
      <main className="login__inner">
        <div className="login__intro">
          <div aria-hidden className="brand brand--l"><XenithMark size={24} /></div>
          <h1 className="login__title">{l.title}</h1>
          <p className="login__body">{l.body}</p>
          <ol className="login__steps">
            <li>{l.step1a}<a href="https://www.microsoft.com/link" onClick={e => { e.preventDefault(); open(); }}>{l.step1link}</a>{l.step1b}</li>
            <li>{l.step2}</li>
            <li>{l.step3}</li>
          </ol>
        </div>
        {card}
      </main>
      {deck && <HintBar hints={[{ k: 'a', label: s.hints.select }]} />}
    </div>
  );
}
