# Building the Linux (Steam Deck) packages

**Release builds must be made on Linux** — CI does it (`.github/workflows/build.yml`, job `ubuntu-latest`).
Locally on any x86-64 Linux (Ubuntu 22.04+/Debian 12/Arch, or SteamOS desktop mode inside distrobox):

```sh
# Node 24 + npm
npm ci
node build.mjs
npx electron-builder --linux AppImage tar.gz --publish never
ls release/   # Xenith-<ver>-linux-x86_64.AppImage, Xenith-<ver>-linux-x64.tar.gz
```

Requirements: `libfuse2` (to run the AppImage). electron-builder downloads the Linux Electron zip and the AppImage
tooling itself; no native modules are used, so no compiler is needed.

## What happens on Windows (tested 2026-10-22, electron-builder 26.15.3)

`npx electron-builder --linux AppImage tar.gz` on Windows:
- **tar.gz: produced** (≈113 MB) — but every file has mode `0644`: `xenith`, `chrome_crashpad_handler` and
  `chrome-sandbox` lose their executable bits. It works only after
  `chmod +x xenith chrome_crashpad_handler` (and `--no-sandbox`, or `chown root:root chrome-sandbox && chmod 4755
  chrome-sandbox`). Good enough for a quick test on the Deck, not for a release.
- **AppImage: fails** with `EPERM: operation not permitted, symlink 'usr\share\icons\hicolor\…'` — creating
  symlinks needs Windows Developer Mode or an elevated shell. (Not attempted: we do not change system settings.)
  Even with symlinks, the same permission problem as the tar.gz would apply.

## Desktop entry
electron-builder generates `xenith.desktop` from `linux.desktop.entry` in `electron-builder.yml`
(`Categories=Game;`, `StartupWMClass=Xenith`; `desktopName` is injected via `extraMetadata` for the Wayland app_id).
`build/linux/xenith.desktop` is the same entry for manual installs of the tar.gz (copy to
`~/.local/share/applications/` and fix `Exec=`).
