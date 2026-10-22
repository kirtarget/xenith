# Xenith — test log

Categories: **[HW]** confirmed on real hardware · **[LOCAL]** local check only · **[TODO]** needs hardware.

## 2026-10-22

### T1 [HW] Auth + discovery
MSA device code → XSTS gssv → gsToken → `v6/servers/home`. Found 1 console: "Xbox", XboxSeriesX, ConnectedStandby, playPath v5/sessions/home/play. Refresh token stored with DPAPI.

### T2 [HW] First Xenith session — osName=windows, dims 1920x1080, codec default, 60 s
| Metric | Value |
|---|---|
| Console wake + provisioning | 12.0 s (ConnectedStandby → Provisioned, no ReadyToConnect step) |
| Play → WebRTC connected | 19.1 s |
| Inbound frame size (getStats) | **1920×1080**, 60 fps (max 65) |
| Negotiated codec | H.264 `profile-level-id=42001f` (Baseline) |
| Bitrate | 16.9 Mbps (max 18.0) |
| Decode time | 0.32 ms/frame |
| Jitter buffer | 2.6 ms; jitter 2 ms |
| RTT (ICE pair) | 1 ms (LAN) |
| Packet loss / dropped frames | 0 / 0 |
| Audio | 0 lost, 2400 concealed samples (start-up) |

Console SDP answer offers only H.264: `42002a`, `42e02a`, `4d002a` (Baseline/Constrained Baseline/Main, level 4.2). No High (64), no HEVC/AV1. Electron 45.0.0 / Chromium 156.
Note: `decoderImplementation` not exposed by getStats in this build → HW-decode confirmation pending (see chrome://gpu / media-internals).

### T3 [HW] 1440p request matrix (45 s each, H.264 Main `4d` preferred)
| # | osName | X-MS-Device-Info dims | dimensionschanged | clientdevicecapabilities | resolutionAlias | Result |
|---|---|---|---|---|---|---|
| 3a | windows | 2560x1440 | 1920x1080 (patch bug) | {} | – | 1920×1080 60 fps, ≤17.8 Mbps |
| 3b | tizen | 2560x1440 | 1920x1080 (patch bug) | {} | – | 1920×1080 60 fps, ≤17.7 Mbps |
| 3c | tizen | 1920x1080 | 1920x1080 | {} | – | 1920×1080 60 fps, ≤17.9 Mbps |
| 3d | windows | 2560x1440 | **2560x1440** | 2560x1440, 40 Mbps | 1440 | 1920×1080 60 fps, ≤17.9 Mbps |
| 3e | windows | 2560x1440 | **2560x1440** | {} | – | 1920×1080 60 fps, ≤17.6 Mbps |
| 3f | windows | 2560x1440 | **2560x1440** | 2560x1440, 40 Mbps | – | 1920×1080 60 fps, ≤17.9 Mbps |

Findings:
- Preferring Main profile works: negotiated `4d001f` (T2 default negotiated Baseline `42001f`).
- `tizen` ("1080p HQ") gives no measurable bitrate gain on xHome vs `windows`.
- No client-side signal tested so far raises xHome above 1080p. Open precondition: console **Display resolution must be 1440p/4K** (Microsoft, 2026-09-09) — not yet confirmed by user. Next candidate: client identity of the official Xbox PC app (clientAppId/version) if the preview is gated by app.
- Bug found & fixed: first dims patch to vendored Message.ts was not persisted; rows 3a/3b did not actually send 2560x1440 in-stream.

### T4 [HW] Official web-client identity (console Display resolution = 1440p, confirmed by user)
Read from the public xbox.com/play JS bundle (2026-10-22): `clientAppVersion 29.21.3`, web SDK `10.6.65`; device info `hw.platformType`, `os.ver`, displayInfo = window outer size; play body adds `magnifier`, `enableOptionalDataCollection`. In-stream the official client sends control message `{message:"userRequestedResolutionUpdate", resolutionAlias}` right after input starts; on desktop the Remote Play setting **Auto resolves to alias `1440`** (mobile → `720HQ`). It also has `rateControlBitrateUpdate {bitratebps}` and SDP channel versions input 1–10, unreliableinput 9–10, control 1–3, message 1, chat 1.

Xenith updated to that identity. Runs (windows, dims 2560x1440, Main): with alias 1440 and without → **1920×1080** both.
Conclusion so far: Xenith now sends everything the official web client sends for resolution; console still encodes 1080p. Next: verify whether the official client itself gets 1440p on this console (decisive control experiment).

### T5 [HW] Control experiment — official xbox.com/play Remote Play (user-run, 2026-10-22 20:23)
Official client, same console (Display resolution 1440p, Insider Alpha ring per user): **1080p (Full HD)** per its stream statistics.
**Conclusion:** the 1440p Remote Play preview is not active for this console/account yet; no client can receive 1440p today. Xenith's 1080p is the confirmed maximum. Xenith keeps the official signalling (Auto → alias `1440`, dims 2560x1440) so it upgrades automatically when the server enables it; HUD always shows the real inbound frame size.

### T6 [HW] Core main process — read-only endpoints (no /play), 2026-10-22
`node tools/core-test/live.mjs` (Electron, shared `%APPDATA%\xenith\secure`):
- Account: signed in, gamertag + avatar via XSTS `http://xboxlive.com` + profile settings; **hasCloud = true** (xgpuweb login OK).
- Consoles: 1 (Xbox, XboxSeriesX, On, Remote Play ready). xHome regions: WestUS2, EastUs, UkSouth (default).
- xCloud: 19 regions (default WESTEUROPE); `v2/titles` 2762 results, **588 entitled** → 588 titles with names/art (ru-RU), 69 with MKB. Catalog (`RemoteLowJade0`) exposes only `Image_Tile` + `Image_Poster` → hero falls back to tile.
- `GET v5/sessions/home/active` → `[]` when idle.
- Token cache: second process run made **0** refresh-token uses (cached user/XSTS/gs tokens in `token_cache.bin`).
- Device-code start (`oauth20_connect.srf`) returns code, `expires_in` 900; cancelled immediately.
[LOCAL] `node tools/core-test/run.mjs` 31/31 (settings, history, ICE, args, redaction, catalog merge, allow-list, SessionManager with fake API); app + `tools/core-test/index.html` IPC self-test 20/20 (`XENITH_CORE_SELFTEST=1`); exported log has no JWT/MSA/Bearer/ice-pwd.

## 2026-10-22 — stream engine (STREAM agent)

Test ids S6–S17 (stream engine; harness log names use the lowercase `t<n>-…` labels). T1–T5: earlier stages; T6: core.

All runs: `src/renderer/stream` StreamController in `tools/stream-test` harness (Electron 45.0.0 / Chromium 156.0.8078.48), Xbox Series X on LAN,
window 1600×900 shown inactive on the 2560×1440 display, PC = i5-12400F + RX 9070 XT. S6–S12 used the first harness (old smoke REST code),
S13–S17 the real core (`XenithCore` + `registerIpc`). Numbers are averages over the phase (first 3 s after a change skipped), getStats() deltas at 1 Hz.
CPU = Electron process `percentCPUUsage` (100 % = one core); GPU = Windows `GPU Engine` counters of the Electron GPU process (`3d`, `video codec`).
Logs: `%APPDATA%\xenith\logs\stream-test-*.jsonl`, summarised with `node tools/stream-test/summarize.mjs <log> brief`.

### S6 [HW] Profiles in one session (low-latency → quality → battery, live `apply()`)
| Phase | Frame | fps | Mbps | decode ms | video jitter buffer ms | audio JB ms | renderer CPU | GPU 3D / video codec |
|---|---|---|---|---|---|---|---|---|
| low-latency (`jitterBufferTarget=0`) | 1920×1080 | 59.8 | 16.0 | 0.40 | **2.8** | 65 | 1.9 % | 1.4 % / 8.9 % |
| quality (`jitterBufferTarget=40`, CAS 3) | 1920×1080 | 60.0 | 16.0 | 0.48 | **23.5** | 66 | 2.2 % | 2.9 % / 9.3 % |
| battery (alias `720`, no post-processing) | **1280×720** | 59.6 | 3.0 | 0.38 | 1.2 | 58 | 1.6 % | 2.2 % / 5.1 % |

- `jitterBufferTarget` works live: 2.8 → 23.5 ms (processing delay 3.2 → 24 ms per frame). Chromium caps the effective target below 40 ms (reported target ≈ 29 ms).
- **`userRequestedResolutionUpdate` is honoured live by the console**: alias `720` switched the inbound stream to 1280×720 within seconds. (Upwards beyond 1080p still blocked server-side, T5.)
- Codec string now comes from the console's answer fmtp (`4d002a` → "H.264 Main 4.2"); Chromium's local fmtp says `4d001f` (3.1) and is not what the console encodes.
- `decoderImplementation` / `powerEfficientDecoder` are still not exposed → `decoder`/`hardwareDecode` = null. Indirect evidence of HW decode: the GPU process `video codec` engine is busy 8–9 % at 1080p60 (5 % at 720p) while renderer CPU stays ≈ 2 %.

### S7 [HW] Codec baseline (`profiles ['42e','420']`)
1920×1080, "H.264 Constrained Baseline 4.2" (`42e0`), 60 fps, 16.1 Mbps (max 17.5), decode 0.36 ms, JB 2.6 ms, 0 loss. No measurable difference to Main except codec name.

### S8 / S13 [HW] Bitrate request (`rateControlBitrateUpdate`)
| Request | Result |
|---|---|
| none (auto) | 16.0–16.2 Mbps avg, max 17.9 |
| 30 Mbps ('high') | 16.2 avg, max 17.8 — **no change** |
| 40 Mbps ('custom', live) | 16.2 avg, max 17.9 — **no change** |
| 8 Mbps ('custom', live, S13) | 16.4 avg, max 18.0 — **no change** |

**Conclusion:** the xHome console ignores `rateControlBitrateUpdate` in both directions (sent on the control channel exactly like the official client). >18 Mbps is **not achievable** for Remote Play 1080p today. 'high' only selects `1080HQ`/`720HQ` aliases.

### S9 [HW] Bitrate cap 'balanced' (b=AS:12000 in the offer)
1920×1080 60 fps, **10.4 Mbps avg, max 11.9** (vs 16.1 uncapped), decode 0.35 ms, 0 loss → the console honours `b=AS`. Needs a new session to change (no SDP renegotiation on xHome, see S12).

### S10 / S14 / S14b [HW] Sharpening / FSR cost and correctness
| Stream | Mode | GPU 3D | GPU-process CPU | renderer CPU |
|---|---|---|---|---|
| 1080p | none | 1.1 % | 1.0 % | 2.0 % |
| 1080p | CAS 5 (vendored WebGL2Player) | 1.6 % | 1.5 % | 2.2 % |
| 1080p | CAS 10 | 1.7 % | 1.5 % | 2.2 % |
| 720p → 1484×835 | FSR (EASU+RCAS, sharp 5) | 3.5 % | 1.2 % | 1.4 % |
| 720p | CAS 5 | 3.0 % | 1.2 % | 1.4 % |
| 720p | none | 2.0 % | 0.9 % | 1.5 % |

fps stayed 60, decode unchanged. Off at 0 = no canvas at all. **S14b pixel probe** (luminance profile of the WebGL output vs the decoded video, 16 rows): FSR canvas 1484×835 corr **0.998** upright (−0.34 flipped); CAS canvas 1280×720 corr **0.998** (−0.57 flipped) → real, correctly oriented picture.

### S11 [HW] Controller Bridge (`haptics.bridgeMode`, live)
Video hidden (`display:none`, no canvas): GPU 3D **0.97 % → 0.02 %**, GPU-process CPU 0.87 → 0.56 %; the stream keeps decoding (60 fps, video codec engine 9 %), audio keeps playing (audio level events continue). Not saving decode work: stopping decode needs SDP renegotiation, which xHome does not support.

### S12 / S15 [HW] Reconnect
- **ICE restart is not supported by xHome**: an ICE-restart re-offer made the console close the input data channel within 0.4 s; GET `/sdp` returned the previous answer (`setRemoteDescription` "wrong state: stable"); never recovered (15 s timeout). Removed from the engine.
- **Full re-session works**: forced `pc.close()` → loss detected (input channel close / pc state poll) → `sessionStop(old,'replaced')` → new `sessionStart` → first frame **8.9 s** after the loss (S15, real core; S12: 8.1 s and 9.1 s). Up to 2 re-sessions per `start()`; budget refills after 60 s stable.

### S16 [HW] 10-minute stability (defaults, real core)
594 s streamed: 1920×1080, 59.99 fps (58–62), 16.1 Mbps, decode 0.39 ms (max 0.93), JB 2.45 ms, RTT 1.7 ms, **0 packets lost, 0 frames dropped, 0 freezes**.
Memory: renderer private 51 → 55 MB (working set 138 → 143 MB; min/max over run 30/59 MB, no trend), GPU process 444 → 444 MB, browser 79 → 77 MB, JS heap flat 9.5 MB, DOM 13 nodes.
CPU: renderer 1.8 %, GPU process 0.9 %, main 0.5 %; GPU 3D 1.5 %, video codec 8.8 %.
**Finding for CORE:** from 9:00 after start every `POST …/keepalive` returned **400 SessionInUnexpectedState** while video was flowing normally; after 3 failures core declared `stream_lost` and DELETEd the session at 9:54. The engine re-sessioned immediately, but the console answered play() twice with `WNSError … WaitingForServerToRegister` → `stream_lost`. Engine now backs off 1.5 s / 6 s between re-session attempts. Keepalive handling should not kill a healthy stream on 400 (check `/state` or the renderer's stats first).

### S17 [LOCAL] Input logic (offline, fake Gamepad API: `node tools/stream-test/run-input-test.mjs`)
All pass: lone View tap → `hudToggle` (View still forwarded); View+Menu short → Nexus pulse 150 ms, View/Menu swallowed incl. staggered release; hold ≥ 600 ms → `overlayRequest`, no Nexus; `setOverlayOpen(true)` → neutral pad state; on close a held button is gated until released; `pressGuide()`; rumble report parsing + trigger-rumble zeroing; remap; Flydigi/XInput id parsing.
Live sanity (HW, 40 s): `setOverlayOpen(true/false)` and `requestKeyframe()` mid-stream — stream unaffected (60 fps, 0 loss).
[TODO HW] Gamepads are not visible to the inactive harness window (Chromium exposes pads only to a focused page after a button press): combos, Guide, controller list and pad rumble playback still need a focused hands-on test.


### E1 [HW] Integrated app end-to-end (main @ merge of core/ui/stream/platform, 2026-10-22 21:38)
`electron . --xhome` → auto-connect → first frame **9.45 s** (console On) → real dashboard rendered in the Xenith window (screenshot verified) → 59 s at 1920×1080 60 fps, avg 16.1 Mbps → window close → session DELETE ok → history entry written (58-point bitrate trace). Packaged `release\win-unpacked\Xenith.exe` (0.2.0) starts and responds.
Fixed during integration: keepalive no longer kills a healthy stream on `400 SessionInUnexpectedState` (stream agent S17); verifies via renderer health and `/state`. 10-minute run with the fix: not yet repeated.

### D1 [HW] Steam Deck OLED, launch from Gaming Mode (2026-10-22)
- Direct AppImage from the Steam shortcut: FAIL, `GPU process launch failed: error_code=1002`, exit.
- `--no-sandbox`: FAIL, no fatal error but no GPU process/renderer, no window.
- `steam-launch.sh` (systemd-run --user unit, generated by `writeSteamLauncher`): PASS, gpu-process 1, renderer 1, window on `:1`, Steam reaper alive (game shown as running), sign-in screen reached.
- User report: endless Steam loading screen. Cause: gamescope `GAMESCOPE_FOCUSABLE_APPS` held only Steam (769); the window outside the reaper process tree had no appid. Fix: set the `STEAM_GAME` window property (app: `tagSteamGameWindow`; launcher: xprop loop). Pending re-test on the Deck.
