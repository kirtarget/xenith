# Vendored: xstreaming-player

- Upstream: https://github.com/Geocld/XStreaming-player
- Commit: 8e178ae (2026-06-22)
- License: MIT (declared in upstream package.json; author Geocld <lijiahao5372@gmail.com>)

## Local patches
Every patch is marked in the source with a `Xenith patch:` comment.

1. `src/Channel/Message.ts` — `dimensionschanged` uses `globalThis.__xenithDims` instead of hard-coded 1920x1080 (needed to request 1440p).
2. `src/Channel/Message.ts` — `clientdevicecapabilities` sends `globalThis.__xenithCaps` (default `{}` as upstream).
3. `src/index.ts` — `setIceCandidates()` no longer calls `window.alert()` on an empty candidate list (it blocked the renderer); logs a warning.
4. `src/Component/Video.ts` — the uncleared 4 ms `setInterval(play)` loop is now 500 ms, only calls `play()` when paused, and is cleared in `destroy()` (leaked one interval per session upstream).
5. `src/Component/Video.ts` — window `keydown`/`keyup` listeners keep references and are removed in `destroy()` (leaked per session upstream).
6. `src/Component/Video.ts` — FSR (`startFSR`):
   - takes the output canvas as an argument (upstream looked up a global `#canvas`) and the RCAS sharpness in stops (0 = strongest);
     upstream passed `value/10`, which inverted the slider;
   - RCAS now samples the EASU render target (correct FSR 1.0 chain); upstream sampled the raw video, so EASU was computed and discarded;
   - renders once per decoded frame via `requestVideoFrameCallback` instead of `setAnimationLoop` (rAF ran at display refresh, e.g. 240 Hz, for a 60 fps stream);
   - `antialias: false`, `powerPreference: 'high-performance'`; EASU `iResolution` initialised with devicePixelRatio (upstream fixed it only on resize);
   - ResizeObserver watches the canvas parent instead of `document.body`;
   - new `stopFSR()` releases the loop, observer, render target, textures, materials, geometry and the GL context; `destroy()` calls it;
   - new `setRcasStops(n)` for live sharpness changes.
7. `src/Driver/Gamepad.ts` — `run()`'s self-rescheduling `setTimeout` loop stops after `stop()` (upstream kept polling forever, one extra loop per session).
8. `src/Driver/Gamepad.ts` — the built-in View+Menu → Nexus mapping can be disabled with `player._xenith_nexus_combo = false`
   (Xenith handles View+Menu itself: short press = Nexus, hold 600 ms = Xenith overlay).
9. `src/Fsr/WebGL2Player.ts` — the CAS/USM canvas follows stream resolution changes (upstream sized it once at creation).

Known upstream behaviours left as-is (worked around in `src/renderer/stream/`):
- `Driver/Keyboard.ts` looks keys up on the config object instead of `_keymapping`, so legacy keyboard→gamepad mapping never fires.
- `BaseStreamPlayer` options divide brightness/contrast/saturation by 100 although defaults are 1.0 — Xenith passes 100 and does picture
  adjustments with a CSS filter instead.
- `index.ts` calls `restartIce()` on `failed` without renegotiating; harmless because xHome does not support ICE restart (TESTLOG S12).
