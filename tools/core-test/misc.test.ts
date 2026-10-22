import test from 'node:test';
import assert from 'node:assert/strict';
import { expandCandidates } from '../../src/main/ice';
import { parseLaunchArgs } from '../../src/main/args';
import { redact, scrub } from '../../src/main/redact';
import { mergeCatalog } from '../../src/main/catalog';
import { streamProfileFor } from '../../src/main/xhome-api';
import { isAllowedExternal } from '../../src/main/ipc';

// Teredo address for client 1.2.3.4:3074 (client IPv4 and port are stored bit-inverted).
const TEREDO = '2001:0:4136:e378:8000:f3fd:fefd:fcfb';

test('expandCandidates: Teredo → IPv4 host candidates, renumbered, end marker', () => {
  const out = expandCandidates([
    { candidate: `a=candidate:1 1 UDP 100 ${TEREDO} 9002 typ host`, sdpMLineIndex: 0, sdpMid: '0' },
    { candidate: 'a=candidate:2 1 UDP 50 192.168.1.20 9002 typ host', sdpMLineIndex: 0, sdpMid: '0' },
    { candidate: 'a=end-of-candidates' },
  ]);
  assert.deepEqual(out.map((c) => c.candidate), [
    'a=candidate:1 1 UDP 2130706431 1.2.3.4 9002 typ host',
    'a=candidate:2 1 UDP 1 1.2.3.4 3074 typ host',
    `a=candidate:3 1 UDP 1 ${TEREDO} 9002 typ host`,
    'a=candidate:4 1 UDP 1 192.168.1.20 9002 typ host',
    'a=end-of-candidates',
  ]);
  assert.ok(out.every((c) => c.messageType === 'iceCandidate' && c.sdpMid === '0' && c.sdpMLineIndex === '0'));
});

test('expandCandidates: duplicate Teredo ports collapse, non-Teredo 2001 ignored, junk skipped', () => {
  const teredo9002 = '2001:0:4136:e378:8000:dcd5:fefd:fcfb'; // port 9002 → derived pair is identical
  const out = expandCandidates([{ candidate: `candidate:7 1 UDP 1 ${teredo9002} 9002 typ host` }, { candidate: 'garbage' }, null, {}]);
  assert.deepEqual(out.map((c) => c.candidate), [
    'a=candidate:1 1 UDP 2130706431 1.2.3.4 9002 typ host',
    `a=candidate:2 1 UDP 1 ${teredo9002} 9002 typ host`,
    'a=end-of-candidates',
  ]);
  assert.deepEqual(expandCandidates(undefined as any).map((c) => c.candidate), ['a=end-of-candidates']);
});

test('expandCandidates: preferIPv6 puts IPv6 first', () => {
  const out = expandCandidates([
    { candidate: 'a=candidate:1 1 UDP 1 10.0.0.2 9002 typ host' },
    { candidate: 'a=candidate:2 1 UDP 1 fd00::5 9002 typ host' },
  ], true);
  assert.equal(out[0].candidate, 'a=candidate:1 1 UDP 2130706431 fd00::5 9002 typ host');
  assert.equal(out[1].candidate, 'a=candidate:2 1 UDP 1 10.0.0.2 9002 typ host');
});

test('parseLaunchArgs', () => {
  const exe = ['C:\\Xenith\\Xenith.exe', '.'];
  assert.deepEqual(parseLaunchArgs(exe), { kind: null, targetId: null });
  assert.deepEqual(parseLaunchArgs([...exe, '--xhome']), { kind: 'home', targetId: null });
  assert.deepEqual(parseLaunchArgs([...exe, '--xhome=F000000000000001']), { kind: 'home', targetId: 'F000000000000001' });
  assert.deepEqual(parseLaunchArgs([...exe, '--xcloud=FORTNITE']), { kind: 'cloud', targetId: 'FORTNITE' });
  assert.deepEqual(parseLaunchArgs([...exe, '--xcloud="HALO_INFINITE"']), { kind: 'cloud', targetId: 'HALO_INFINITE' });
  assert.deepEqual(parseLaunchArgs([...exe, '--xcloud=']), { kind: null, targetId: null });
  assert.deepEqual(parseLaunchArgs([...exe, '--xcloud=../../etc']), { kind: null, targetId: null });
  assert.deepEqual(parseLaunchArgs([...exe, '--xcloud=a b']), { kind: null, targetId: null });
  assert.deepEqual(parseLaunchArgs(['--allow-file-access', '--XCLOUD=Abc123']), { kind: 'cloud', targetId: 'Abc123' });
  assert.deepEqual(parseLaunchArgs([...exe, '--xhomeX']), { kind: null, targetId: null });
});

test('redact strips tokens, auth headers and ice-pwd', () => {
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlX2hlcmU';
  const s = redact(`Authorization: Bearer abc.def-123 XBL3.0 x=123;tok "gsToken":"zzz" ${jwt} M.C522_BAY.0.U.-Cg!x*y$z a=ice-pwd:Abc+/123xyz\\r\\na=ice-ufrag:u1 ${'A'.repeat(60)} serverId F000000000000001`);
  for (const bad of ['abc.def-123', 'x=123;tok', 'zzz', jwt, 'M.C522', 'Abc+/123xyz', 'A'.repeat(60)]) assert.ok(!s.includes(bad), `leaked ${bad}: ${s}`);
  assert.ok(s.includes('a=ice-ufrag:u1'));
  assert.ok(s.includes('F000000000000001'));
  const o: any = scrub({ refresh_token: 'r', nested: { userToken: 'u', sdp: 'v=0', ok: 'fine' }, err: new Error('Bearer qqq') });
  assert.equal(o.refresh_token, '[redacted]');
  assert.equal(o.nested.userToken, '[redacted]');
  assert.equal(o.nested.sdp, '[redacted]');
  assert.equal(o.nested.ok, 'fine');
  assert.equal(o.err.message, 'Bearer [redacted]');
});

test('mergeCatalog joins titles with catalog products', () => {
  const titles = [
    { titleId: 'HALO', details: { productId: '9NP1P1WFS0LB', hasEntitlement: true, supportedInputTypes: ['Controller', 'MKB'] } },
    { titleId: 'NOENT', details: { productId: 'X1', hasEntitlement: false } },
    { titleId: 'NOCAT', details: { productId: 'X2' } },
    { titleId: 'HALO', details: { productId: '9NP1P1WFS0LB' } },
  ];
  const products = { '9NP1P1WFS0LB': { ProductTitle: 'Halo', PublisherName: 'Xbox Game Studios', Image_Poster: { URL: '//store-images.example/p.jpg' }, Image_Tile: { URL: 'https://x/t.jpg' } }, X1: { ProductTitle: 'n' } };
  const out = mergeCatalog(titles, products);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { titleId: 'HALO', productId: '9NP1P1WFS0LB', name: 'Halo', publisher: 'Xbox Game Studios', coverUrl: 'https://store-images.example/p.jpg', heroUrl: 'https://x/t.jpg', supportsMouseKeyboard: true });
});

test('stream profile per resolution setting', () => {
  assert.deepEqual(streamProfileFor('auto'), { osName: 'windows', width: 2560, height: 1440 });
  assert.deepEqual(streamProfileFor('1440'), { osName: 'windows', width: 2560, height: 1440 });
  assert.deepEqual(streamProfileFor('1080'), { osName: 'windows', width: 1920, height: 1080 });
  assert.deepEqual(streamProfileFor('720'), { osName: 'android', width: 1280, height: 720 });
});

test('openExternal allow-list', () => {
  assert.ok(isAllowedExternal('https://www.microsoft.com/link'));
  assert.ok(isAllowedExternal('https://www.microsoft.com/link?otc=ABCD'));
  assert.ok(isAllowedExternal('https://www.flydigi.com/download/space-station'));
  assert.ok(!isAllowedExternal('https://www.microsoft.com/linked-evil'));
  assert.ok(!isAllowedExternal('http://www.microsoft.com/link'));
  assert.ok(!isAllowedExternal('https://www.flydigi.com.evil.io/'));
  assert.ok(!isAllowedExternal('file:///C:/Windows/system32/calc.exe'));
  assert.ok(!isAllowedExternal(42));
});
