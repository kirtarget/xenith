import { useState } from 'react';
import { Button } from '../components/controls';
import { StatusDot } from '../components/feedback';
import { Modal, Sheet } from '../components/overlays';
import { useI18n } from '../i18n';
import { signOut } from '../state/actions';
import { setState, useApp } from '../state/store';

export function Avatar({ size = 28 }: { size?: number }) {
  const account = useApp(s => s.account);
  const [broken, setBroken] = useState(false);
  const letter = (account?.gamertag ?? '?').charAt(0).toUpperCase();
  return account?.avatarUrl && !broken
    ? <img className="avatar" src={account.avatarUrl} alt="" width={size} height={size} style={{ width: size, height: size }} onError={() => setBroken(true)} />
    : <span aria-hidden className="avatar avatar--letter" style={{ width: size, height: size, fontSize: size * 0.43 }}>{letter}</span>;
}

export function AccountChip() {
  const account = useApp(s => s.account);
  const { s } = useI18n();
  if (!account?.signedIn) return null;
  return (
    <button type="button" className="chip-account" data-nav="" data-nav-id="account" aria-label={`${s.account.title}: ${account.gamertag ?? ''}`} onClick={() => setState({ sheet: 'account' })}>
      <Avatar />
      <span>{account.gamertag}</span>
    </button>
  );
}

export function AccountSheet() {
  const open = useApp(s => s.sheet === 'account');
  const account = useApp(s => s.account);
  const platform = useApp(s => s.platform);
  const deck = useApp(s => s.deck);
  const { s } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const close = () => setState({ sheet: null });
  const cloudTone = account?.hasCloud === true ? 'ok' : account?.hasCloud === false ? 'idle' : 'idle';
  const cloudText = account?.hasCloud === true ? s.account.cloudYes : account?.hasCloud === false ? s.account.cloudNo : s.account.cloudUnknown;
  return (
    <>
      <Sheet open={open && !confirm} title={s.account.title} onClose={close}>
        <div className="acct">
          <Avatar size={deck ? 72 : 64} />
          <div className="acct__who">
            <span className="muted">{s.account.signedInAs}</span>
            <span className="acct__tag">{account?.gamertag ?? s.common.dash}</span>
          </div>
        </div>
        <p className="acct__cloud"><StatusDot tone={cloudTone} />{cloudText}</p>
        <div className="sheet__spacer" />
        <Button variant="danger" size="l" block navDefault onClick={() => setConfirm(true)}>{s.account.signOut}</Button>
        {platform && <p className="tiny">{s.account.version(platform.version)} · Electron {platform.electron} · Chromium {platform.chrome}</p>}
      </Sheet>
      <Modal
        open={confirm}
        danger
        title={s.account.signOutTitle}
        body={s.account.signOutBody}
        confirmLabel={s.account.signOutConfirm}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => { await signOut(); setConfirm(false); }}
      />
    </>
  );
}
