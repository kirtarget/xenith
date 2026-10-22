import test from 'node:test';
import assert from 'node:assert/strict';
import { angleBackendOf, decodeProfilesOf, formatProfiles, formatWebrtcProbe, parseAngleRenderer, videoDecodeText } from '../../../src/main/platform/impl/gpu-format';

test('ANGLE renderer string (measured on RX 9070 XT)', () => {
  const r = parseAngleRenderer('ANGLE (AMD, AMD Radeon RX 9070 XT (0x00007550) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.32015.7029)');
  assert.deepEqual(r, { backend: 'D3D11', gpu: 'AMD Radeon RX 9070 XT' });
  assert.equal(parseAngleRenderer('ANGLE (ATI Technologies Inc., AMD Radeon RX 9070 XT, OpenGL 4.5.0 Core Profile Context 26.10.1.261008)').gpu, 'AMD Radeon RX 9070 XT');
  assert.equal(angleBackendOf({ auxAttributes: { glImplementationParts: '(gl=egl-angle,angle=d3d11)' } }), 'D3D11');
  assert.equal(angleBackendOf({ auxAttributes: { glImplementationParts: '(gl=egl-angle,angle=vulkan)' } }), 'Vulkan');
});

test('getGPUInfo profile (single object in Electron 45)', () => {
  const info = { auxAttributes: { videoDecodeAcceleratorSupportedProfile: { profile: 24, maxResolutionWidth: 8192, maxResolutionHeight: 4352 } } };
  assert.deepEqual(formatProfiles(decodeProfilesOf(info)), ['av1 main up to 8192×4352']);
  assert.deepEqual(formatProfiles([{ profile: 1, maxResolutionWidth: 4096, maxResolutionHeight: 2304 }]), ['h264 main up to 4096×2304']);
});

test('WebRTC probe formatting', () => {
  const r = formatWebrtcProbe({
    'h264 main': [[1920, 1080, true, true], [3840, 2160, true, true], [7680, 4320, true, false]],
    'vp9': [[1920, 1080, true, false]],
  });
  assert.deepEqual(r, { profiles: ['h264 main up to 3840×2160', 'vp9 (software)'], hardwareH264: true });
  assert.equal(videoDecodeText('enabled'), 'hardware accelerated');
  assert.equal(videoDecodeText('disabled_software'), 'software only');
});
