// ⚠ PREVIEW ONLY. Imported before the app: reads ?s=<scenario>&deck=1&lang=en&scale=m and installs fakes.
import { installFakeApi, type FakeConfig } from './fake-api';
import { fakeStreamConfig, type FakeMode } from './fake-stream';

export const params = new URLSearchParams(location.search);
export const scenario = params.get('s') ?? 'home';
const deck = params.get('deck') === '1';

const cfg: FakeConfig = {
  deck,
  signedIn: !scenario.startsWith('login'),
  consoles: scenario === 'home-loading' ? 'loading' : scenario === 'home-empty' ? 'empty' : scenario === 'home-two' ? 'two' : 'one',
  history: scenario === 'home-new' ? 'empty' : 'full',
  hasCloud: scenario === 'cloud-none' ? false : true,
  cloudLoading: scenario === 'cloud-loading',
  lang: params.get('lang') === 'en' ? 'en' : 'ru',
  scale: (params.get('scale') as FakeConfig['scale']) ?? 'm',
  layout: deck ? 'auto' : ((params.get('layout') as FakeConfig['layout']) ?? 'auto'),
};
installFakeApi(cfg);

const modes: Record<string, FakeMode> = {
  connecting: 'connecting', 'connecting-cloud': 'connecting-cloud', 'conn-error': 'error-ice',
  stream: 'streaming', 'stream-hud': 'streaming', 'stream-lost': 'reconnecting',
};
fakeStreamConfig.mode = modes[scenario] ?? 'streaming';
