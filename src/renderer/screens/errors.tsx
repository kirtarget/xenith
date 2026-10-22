import type { SessionErrorCode } from '../../shared/api';
import { Button } from '../components/controls';
import { EmptyState, type Tone } from '../components/feedback';
import { useI18n } from '../i18n';
import { go, loadConsoles, toast } from '../state/actions';
import { disconnect, dismissError, retry } from '../state/session';
import { setState } from '../state/store';

export const ERROR_TONE: Record<SessionErrorCode, Tone> = {
  not_signed_in: 'warn', auth_expired: 'warn', no_console: 'warn', console_unreachable: 'bad', console_busy: 'warn',
  provision_failed: 'bad', no_cloud_entitlement: 'idle', ice_failed: 'bad', stream_lost: 'bad', network: 'bad', unknown: 'bad',
};

function signInAgain() {
  setState(s => ({ session: null, lastSessionError: null, account: { ...(s.account ?? { gamertag: null, avatarUrl: null, hasCloud: null }), signedIn: false } }));
}

async function exportLogs(savedText: (p: string) => string) {
  try { const p = await window.xenith.exportLogs(); toast(savedText(p), 'ok', 7000); } catch { /* main reports */ }
}

/** Primary/secondary handlers for each SessionErrorCode (States mockup). */
export function useErrorActions(code: SessionErrorCode) {
  const { s } = useI18n();
  const primary: Record<SessionErrorCode, () => void> = {
    not_signed_in: signInAgain,
    auth_expired: signInAgain,
    no_console: () => { setState({ lastSessionError: null }); void loadConsoles(true); },
    console_unreachable: retry,
    console_busy: retry,
    provision_failed: retry,
    no_cloud_entitlement: () => { dismissError(); setState({ lastSessionError: null }); go('home'); },
    ice_failed: retry,
    stream_lost: retry,
    network: retry,
    unknown: retry,
  };
  const secondary: Partial<Record<SessionErrorCode, () => void>> = {
    no_console: () => setState({ sheet: 'account' }),
    console_busy: () => { dismissError(); setState({ lastSessionError: null }); },
    ice_failed: () => { dismissError(); setState({ lastSessionError: null }); go('settings', 'network'); },
    stream_lost: () => { void disconnect(); },
    unknown: () => { void exportLogs(s.settings.advanced.logsSaved); },
  };
  return { primary: primary[code], secondary: secondary[code] };
}

export function ErrorCard({ code, className, deck }: { code: SessionErrorCode; className?: string; deck?: boolean }) {
  const { s } = useI18n();
  const copy = s.errors[code] ?? s.errors.unknown;
  const { primary, secondary } = useErrorActions(code);
  return (
    <EmptyState
      live
      className={className}
      tone={ERROR_TONE[code]}
      title={copy.title}
      body={copy.body}
      actions={<>
        <Button variant="primary" size={deck ? 'l' : 'm'} navDefault onClick={primary}>{copy.primary}</Button>
        {copy.secondary && secondary && <Button variant="outline" size={deck ? 'l' : 'm'} onClick={secondary}>{copy.secondary}</Button>}
      </>}
    />
  );
}
