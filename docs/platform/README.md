# Platform layer

`src/main/platform/impl/` implements `PlatformLayer` (`src/main/platform/index.ts`).

| File | Purpose |
|---|---|
| `index.ts` | `createPlatformLayer(opts)`, `applyEarlySwitches(settings)` |
| `switches.ts` | Chromium switch plan (pure) + applying it to `app.commandLine` |
| `deck.ts` | Steam Deck / gamescope / SteamOS detection (pure, fixture-tested) |
| `gpu.ts`, `gpu-format.ts` | `gpuStatus()` — `getGPUInfo`, feature status, WebRTC decode probe |
| `haptics.ts`, `flydigi.ts` | Flydigi controller + Space Station detection |
| `vdf.ts`, `shortcuts.ts`, `crc32.ts`, `steam-ids.ts`, `steam-paths.ts`, `steam.ts` | Steam shortcuts + artwork |
| `sys.ts` | `reg query`, PowerShell JSON, process list (read-only) |

Docs: [steam.md](steam.md), [steam-deck.md](steam-deck.md). Tests: `node tools/platform-test/run-tests.mjs`.
Live probe on a machine: `node tools/platform-test/run-probe.mjs` (`XENITH_PROBE_MODE=fake-steam` for the
shortcut/artwork path against a temp Steam root; `XENITH_GPU_MODE`, `XENITH_PIPELINE` to try settings).

## Integration (core)

```ts
import { setPlatformLayer, platform } from './platform';
import { createPlatformLayer } from './platform/impl';
setPlatformLayer(createPlatformLayer({ getSettings: () => settings.get() }));
platform.applyEarlySwitches(settings.get());   // synchronously at module load, BEFORE app.whenReady()
```
- Remove core's unconditional `appendSwitch('force_high_performance_gpu')` — the platform layer now owns GPU
  selection; while core still sets it, `gpuMode = 'low-power'` is ignored (applySwitchPlan won't add both).
- If core also sets `enable-features`, call `applyEarlySwitches` *after* it: the lists are merged.
- `gpuStatus()` opens a hidden 64×64 `about:blank` window once (~150 ms) for the WebRTC probe; call it after `ready`.
- `hapticsDiagnostics()` spawns one PowerShell (2–5 s on this PC); call it on demand, not at start-up.

## Measured on the dev PC (Win 11 26200, RX 9070 XT driver 32.0.32015.7029, Electron 45.0.0 / Chrome 156.0.8078.48)

### gpuStatus() — defaults (gpuMode high-performance, pipeline auto)
```
gpu: AMD Radeon RX 9070 XT          angle: D3D11          videoDecode: hardware accelerated   hardwareH264: true
decodeProfiles (WebRTC, power-efficient = HW):
  h264 baseline/main/high up to 4096×2304   (7680×4320 supported but NOT power-efficient → software)
  hevc main, vp9, av1 up to 7680×4320
getGPUInfo profile: av1 main up to 8192×4352 (Electron keeps only the last profile; see below)
devices: AMD Radeon RX 9070 XT ×3 (active = first, gpuPreference 2), Microsoft Basic Render Driver
```
- **H.264 decode is hardware accelerated** (D3D11VA through ANGLE D3D11) for 1080p/1440p/4K.
- **Virtual display adapters**: DXGI lists the RX 9070 XT three times (the SudoMaker / Virtual Desktop / Sunshine
  virtual displays are attached to the same render adapter) plus the WARP "Basic Render Driver". Chromium picks the
  real RX 9070 XT (`active`, high-performance preference) in every mode tried, including `low-power`; the virtual
  displays do not steer it to WARP.
- Pipelines: `gl` → ANGLE OpenGL works for rendering but video decode drops to **software**; `vulkan` → the GPU
  process fails on this PC/driver (no ANGLE Vulkan) and everything falls back to software. Keep `auto` (D3D11) on
  Windows; the UI should flag gl/vulkan as "may disable hardware decoding".
- Pitfalls found: `app.getGPUFeatureStatus()` returns a placeholder (`disabled_software` everywhere) until the GPU
  process has reported — `gpuStatus()` therefore awaits `getGPUInfo('complete')` first (4/4 correct runs after the
  fix vs ~50 % wrong before). Electron's `getGPUInfo()` flattens `videoDecodeAcceleratorSupportedProfile` into one
  object (last profile wins), so the profile list comes from `navigator.mediaCapabilities.decodingInfo({type:'webrtc'})`,
  which reflects the actual WebRTC decoder factory and is resolution-aware.

### hapticsDiagnostics(null rumble, no audio label)
```
flydigiDevice: fail — no Flydigi device found (VID 37D7, 04B4:2412 or "Flydigi" name)
spaceStation:  fail — not installed (no uninstall entry, Start menu entry or Program Files folder), not running
gameAudio:     unknown — no game audio device selected
audioReachesEngine: unknown — cannot be verified without the controller and Space Station
```
(as expected: Apex 6 Pro not connected, Space Station not installed). Takes 2–5 s (PowerShell CIM query).

### steam.status()
`installed: true, running: true, userIds: [6 ids],
libraryShortcut: false`; active user <id> (registry). All 6 `shortcuts.vdf` round-trip byte-for-byte; the 5
UWPHook shortcuts' stored appids equal `crc32(Exe+AppName)|0x80000000`. Reversible add/remove test on the active
user's file: SHA-256 identical afterwards; timestamped backup `shortcuts.vdf.backup-2026-10-22T18-13-25-984Z` left
next to it.

## Flydigi identification (sources, unverified on hardware)
SDL `src/joystick/usb_ids.h`: `USB_VENDOR_FLYDIGI_V1 0x04b4` (`0x2412` Vader 2/Apex 2/3), `USB_VENDOR_FLYDIGI_V2
0x37d7` (`0x2401` Vader, `0x2501` Apex, `0x2502` Apex 6); Linux xpad patch "add ID for Flydigi Apex 5" (`37d7:2501`,
XInput mode). SDL's hidapi Flydigi driver reads wired/wireless from a vendor report, i.e. **cable and 2.4 GHz dongle
share VID/PID** — Xenith reports `usb` for both unless the device name says receiver/dongle. Bluetooth is derived from
the PnP path (`BTHENUM`/`BTHLEDEVICE`, HID-over-GATT/HIDP service GUIDs) or HID bus 0005 on Linux. Space Station:
Inno Setup uninstall key `{7BCA93D4-0551-4DC8-8F96-D0FF8D259C99}_is1` (silentinstallhq), winget id
`Flydigi.FlydigiSpaceStation`, publisher "Flydigi, Inc."; process names are not documented — matched by
`/flydigi|spacestation|fdspace/i` (UNVERIFIED).

## Packages built on the dev PC (2026-10-22, smoke main from `build.mjs`, not the integrated app)
| Artefact | Size | Notes |
|---|---|---|
| `release/Xenith-Setup-0.1.0.exe` | 99.0 MB | NSIS, per-user, ru/en, desktop + Start menu shortcut, unsigned |
| `release/Xenith-0.1.0-win-x64.zip` | 135.2 MB | portable |
| `release/Xenith-0.1.0-linux-x64.tar.gz` | 112.6 MB | built on Windows: exec bits missing, test-only (see build/linux/build-on-linux.md) |
| AppImage | — | fails on Windows (symlink EPERM); built by CI on ubuntu-latest |
| macOS dmg/zip | — | config only; built by CI on macos-latest, unsigned |

`app.asar` ≈ 1 MB (dist only, no node_modules). The installer was built but not executed on this PC.