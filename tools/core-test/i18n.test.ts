import test from 'node:test';
import assert from 'node:assert/strict';
import { applySettingsPatch, normalizeSettings } from '../../src/main/settings-core';
import { dictionaries, makeI18n } from '../../src/renderer/i18n';

function leaves(value: object, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item !== null && typeof item === 'object') Object.assign(result, leaves(item, path));
    else result[path] = typeof item;
  }
  return result;
}

test('fresh and legacy settings without a language use English', () => {
  assert.equal(normalizeSettings({}).ui.lang, 'en');
  assert.equal(normalizeSettings({ ui: { scale: 'l' } }).ui.lang, 'en');
  assert.equal(normalizeSettings({ ui: { lang: 'unsupported' } }).ui.lang, 'en');
});

test('saved Russian language survives loading and unrelated settings changes', () => {
  const saved = normalizeSettings({ ui: { lang: 'ru' } });
  assert.equal(saved.ui.lang, 'ru');
  const changed = applySettingsPatch(saved, { audio: { volume: 0.5 } });
  assert.equal(changed.ui.lang, 'ru');
  assert.equal(applySettingsPatch(changed, { ui: { lang: 'invalid' } }).ui.lang, 'ru');
});

test('English and Russian dictionaries have the same complete shape', () => {
  assert.deepEqual(leaves(dictionaries.en), leaves(dictionaries.ru));
});

test('English interface strings contain no untranslated Russian except the language name', () => {
  const visit = (value: object, prefix = '') => {
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (item !== null && typeof item === 'object') visit(item, path);
      else if (typeof item === 'string' && path !== 'settings.ui.langOpts.ru') {
        assert.doesNotMatch(item, /[А-Яа-яЁё]/u, path);
      }
    }
  };
  visit(dictionaries.en);
});

test('English labels, plural forms and stream units are ready for display', () => {
  const { s, f, t } = makeI18n('en');
  assert.equal(s.common.signIn, 'Sign in');
  assert.equal(s.time.seconds(1), '1 second');
  assert.equal(s.time.seconds(2), '2 seconds');
  assert.equal(s.settings.steam.resynced(1), 'Artwork refreshed for 1 shortcut');
  assert.equal(s.settings.steam.resynced(2), 'Artwork refreshed for 2 shortcuts');
  assert.equal(f.mbps(16900), '16.9 Mbps');
  assert.equal(f.ms(2.8), '2.8 ms');
  assert.equal(f.durLong(3660), '1 hour 1 minute');
  assert.equal(t('home.losses', 2), 'lost packets');
});

test('1440p support is distinct from the resolution measured in previous sessions', () => {
  for (const lang of ['en', 'ru'] as const) {
    const { s } = makeI18n(lang);
    assert.equal(s.settings.streaming.resolutionOpts['1440'], '1440p');
    for (const text of [s.home.qualityUpTo('1080p'), s.settings.streaming.resolutionDescCapped('1080p')]) {
      assert.match(text, /1440p/);
      assert.match(text, /1080p/);
      assert.doesNotMatch(text, /Microsoft/);
    }
  }
});

test('switching languages updates labels and formatting without changing saved settings', () => {
  const settings = normalizeSettings({ ui: { lang: 'ru' } });
  const russian = makeI18n(settings.ui.lang);
  const switched = applySettingsPatch(settings, { ui: { lang: 'en' } });
  const english = makeI18n(switched.ui.lang);
  assert.equal(russian.s.common.signIn, 'Войти');
  assert.equal(russian.f.mbps(16900), '16,9 Мбит/с');
  assert.equal(english.s.common.signIn, 'Sign in');
  assert.equal(english.f.mbps(16900), '16.9 Mbps');
  assert.equal(settings.ui.lang, 'ru');
});
