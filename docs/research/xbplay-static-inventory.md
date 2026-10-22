# XBPlay 2.2.55 — static inventory (Stage 1, part 1)

Method: file listing, PE version info, asar **header** (file table only), Electron/Chrome version strings, userData layout, config keys with secrets redacted.
No decompilation, no code copied, no proprietary assets reused.

## Confirmed facts
| Area | Finding | Evidence |
|---|---|---|
| Stack | Electron **36.2.0** / Chromium **136.0.7103.49** | version strings in main exe |
| UI | Plain HTML + jQuery + Bootstrap + AlertifyJS + js-spatial-navigation (gamepad focus) | asar file table `bower_components/` |
| Auth | Custom XAL flow (`js/backend/login/xal_login.js`, `login_window.js`), MSAL data in config | asar table, config key `msal` |
| Streaming | Own JS client `pc_play/clients/pc_play_binary_client.js` + `pc_play_render.js`; **no** xbox-xcloud-player / greenlight dependency in node_modules | asar table |
| Video decode | Chromium built-in WebRTC pipeline (profile has `WebrtcVideoStats`, `GPUCache`, `DawnWebGPUCache`); settings `render_pipeline=auto`, `gpu_mode=auto` | userData, config |
| Hosts | Console list cached as `availableConsoles` (1 console) | config |
| Regions | gssv-play-prod region list, default SWEDENCENTRAL | config |
| Steam | steamworks.js native addon (overlay, rich presence, artwork) | `app.asar.unpacked` |
| Security | **gsToken / xCloudToken / msal stored in plaintext `config.json`** (electron-store) | config keys |
| Resolution / bitrate | No persisted resolution or bitrate keys in config at capture time | config |

## Implications for Xenith
1. XBPlay quality is not from a custom native decoder — it is Chromium WebRTC with tuned SDP/settings. An Electron/Chromium client can match it; the difference is in negotiation parameters and render path, which dynamic analysis must pin down.
2. Xenith must store tokens in OS secure storage (Electron `safeStorage`/DPAPI), unlike XBPlay.
3. Strategy A (patching XBPlay) is rejected: proprietary, Steam-updated, would require redistributing modified commercial code.

## Still to verify (dynamic, needs a live session)
- SDP offer/answer: codecs (H.264 profiles, HEVC?), max resolution, fmtp.
- Actual inbound frame size via `getStats()` (frameWidth/frameHeight) on the Alpha-ring console.
- Bitrate ceiling, jitter-buffer behaviour, input channel format, rumble channel.
