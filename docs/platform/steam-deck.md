# Xenith on Steam Deck / SteamOS

Xenith ships a **native Linux build** (AppImage and tar.gz, x86-64). Do not run the Windows build through Proton:
the native build gets VA-API hardware decoding, gamescope integration and the right controller path.

## Install

1. Hold the power button → **Switch to Desktop**.
2. Download `Xenith-<version>-linux-x86_64.AppImage` from the Releases page (Firefox/Chrome in desktop mode), e.g. into `~/Applications`.
3. Make it executable: Dolphin → right click → Properties → Permissions → *Is executable*, or in Konsole:
   ```sh
   chmod +x ~/Applications/Xenith-*.AppImage
   ```
4. Add it to Steam, either:
   - start Xenith once and press **«Добавить в Steam»** in Settings → Steam (writes the shortcut for the logged-in Steam user, plus artwork for cloud titles), then **restart Steam** — Steam only reads `shortcuts.vdf` at start-up and may overwrite it on exit, so Xenith's message asks for a restart; or
   - Steam → *Games* → **Add a Non-Steam Game to My Library…** → browse to the AppImage.
5. In the shortcut's **Properties → Compatibility**, make sure **“Force the use of a specific Steam Play compatibility tool” is OFF**. Xenith is a Linux binary; Proton would run nothing (or the wrong build).
6. **Return to Gaming Mode** and start Xenith from the library (Xenith shortcuts carry the `Xenith` tag; cloud titles are named `Xenith: <game>` and start with `--xcloud=<titleId>`).

The AppImage needs FUSE 2 (`libfuse.so.2`), which SteamOS 3 includes. If an AppImage refuses to start on another distro,
use the tar.gz (`./xenith` inside the extracted folder) or `--appimage-extract-and-run`.

## Controller: keep Steam Input ON (Gamepad template)

Keep **Steam Input enabled** for the Xenith shortcut with the default **Gamepad** controller layout.

Why: with Steam Input on, Steam exposes the Deck controls as a *Steam Virtual Gamepad* (USB id `28de:11ff`), which
Chromium's gamepad id list classifies as an Xbox 360 XInput pad (`{{0x28de, 0x11ff}, kXInputTypeXbox360}` in
`device/gamepad/gamepad_id_list.cc`, Chromium main, checked 2026-10-22). Chromium therefore applies the **standard
mapping**, which is exactly what the Xbox stream expects. With Steam Input disabled, Chromium would see the raw Deck
controller (`28de:1205`), which is listed as `kXInputTypeNone` and has no entry in
`gamepad_standard_mappings_linux.cc` — it would show up as a non-standard gamepad with unusable button indices, and
in gaming mode Steam keeps grabbing the device anyway.

Notes:
- The Steam/⋯ buttons stay with Steam (overlay / Quick Access). Xenith's own menu is *View + Menu held 0.6 s*; the
  Xbox button is *View + Menu short press* (see Settings → Controllers).
- Back grips / trackpads: map them in the Steam Input layout if wanted; they are not part of the Xbox pad.
- Rumble works through the virtual pad (Steam forwards it to the Deck haptics).

## Gaming mode (gamescope) specifics

Xenith detects gamescope (`GAMESCOPE_WAYLAND_DISPLAY`, `XDG_CURRENT_DESKTOP=gamescope`) and the Deck hardware
(`/sys/devices/virtual/dmi/id/board_vendor` = `Valve`, `product_name` = `Jupiter` (LCD) or `Galileo` (OLED)) and then:
- runs on **X11 via Xwayland** (`--ozone-platform=x11`) — gamescope's Wayland socket is not a desktop compositor;
- forces `--force-device-scale-factor=1` (1280×800 panel);
- the UI switches to the Deck layout and should start fullscreen.

## Hardware video decoding (VA-API)

On Linux Xenith enables VA-API before start-up (see `src/main/platform/impl/switches.ts`), using the Chromium 156
names from `docs/gpu/vaapi.md` in the Chromium tree:

| Render pipeline (Settings → Advanced) | Switches |
|---|---|
| auto / gl (default) | `--use-gl=angle --use-angle=gl --enable-features=AcceleratedVideoDecodeLinuxGL[,AcceleratedVideoDecodeLinuxZeroCopyGL] --ignore-gpu-blocklist` |
| vulkan | `--use-gl=angle --use-angle=vulkan --enable-features=VaapiIgnoreDriverChecks,Vulkan,DefaultANGLEVulkan,VulkanFromANGLE --ignore-gpu-blocklist` |

`ZeroCopyGL` is added on Wayland desktops and in gamescope. The old names `VaapiVideoDecoder` /
`VaapiVideoDecodeLinuxGL` no longer exist in Chromium 156 and are not used. Set `XENITH_NO_VAAPI=1` in the
shortcut's launch options (`XENITH_NO_VAAPI=1 %command%`) to fall back to software decoding when debugging.

Settings → Diagnostics shows the result: `videoDecode`, the WebRTC decode profiles (hardware = "power efficient"
according to Chromium's WebRTC decoder factory) and `vaapi: true/false`. The Deck's Van Gogh APU (Mesa radeonsi)
decodes H.264 up to 4K in hardware.

## Known limits

- **Not verified on a real Deck yet** (no device in the build environment): VA-API flags, gamescope detection and
  the X11 choice are implemented from documentation and unit-tested with fixtures only.
- Flydigi Space Station (audio haptics) is Windows-only; on the Deck the haptics diagnostics report it as
  "unknown".
- Steam rewrites `shortcuts.vdf` when it exits; add shortcuts while Steam is closed or restart it immediately after.
- The AppImage does not self-update.
