# Steam integration (implementation notes)

Code: `src/main/platform/impl/{vdf,shortcuts,steam-ids,steam-paths,steam}.ts`. Written from Steam's file formats only.

## Locating Steam
| OS | Order |
|---|---|
| Windows | `HKCU\Software\Valve\Steam\SteamPath` → `HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath` → `%ProgramFiles(x86)%\Steam` |
| Linux | `~/.steam/steam` (symlink) → `~/.local/share/Steam` → `~/.steam/root` → Flatpak `~/.var/app/com.valvesoftware.Steam/.local/share/Steam` |
| macOS | `~/Library/Application Support/Steam` |

`XENITH_STEAM_ROOT` overrides it (tests). Users = numeric folders in `userdata/`. Shortcuts are written for the
**active user** (`HKCU\...\Steam\ActiveProcess\ActiveUser` on Windows, `~/.steam/registry.vdf` on Linux, else the
`MostRecent` entry in `config/loginusers.vdf`), or for every user when none can be determined. Running = a `steam`
/ `steamwebhelper` process.

## shortcuts.vdf
Binary KeyValues: `00 "shortcuts" 00 { 00 "<n>" 00 { fields… 08 } … 08 } 08`. Types 0x00 map, 0x01 string,
0x02 int32, 0x03 float, 0x04 ptr, 0x05 wstring, 0x06 colour, 0x07 uint64, 0x0A int64, 0x08/0x0B end. The codec keeps
order, key casing and raw bytes, so unchanged files round-trip **byte-for-byte** (verified on all 6 real
`shortcuts.vdf` files on the dev PC, and an add→remove cycle on the active user's file restored the identical SHA-256).
New entries use the field order of the current Steam client: `appid, AppName, Exe, StartDir, icon, ShortcutPath,
LaunchOptions, IsHidden, AllowDesktopConfig, AllowOverlay, OpenVR, Devkit, DevkitGameID, DevkitOverrideAppID,
LastPlayTime, FlatpakAppID, tags`. Before the first modification Xenith copies the file to
`shortcuts.vdf.xenith-backup` and writes atomically (temp file + rename).

## appid
`appid = crc32(Exe + AppName) | 0x80000000` (unsigned; stored as int32). `Exe` is the stored string *including*
quotes. Steam honours the stored value, so artwork names are deterministic. Verified: all 5 existing shortcuts on the
dev PC (created by UWPHook) have exactly this appid. `steam://rungameid/` uses `(appid << 32) | 0x02000000`.

## Entries Xenith writes
| | AppName | Exe / StartDir | LaunchOptions | tags |
|---|---|---|---|---|
| library | `Xenith` | `"<Xenith.exe or AppImage>"` / its folder | (empty) | `Xenith` |
| cloud title | `Xenith: <name>` | same | `--xcloud=<titleId>` | `Xenith`, `Xbox Cloud` |

Packaged Windows → `process.execPath` (or `PORTABLE_EXECUTABLE_FILE`), Linux → `$APPIMAGE`; in development the
Electron binary plus the app path as first launch option.

## Artwork (`userdata/<id>/config/grid/`)
| file | size | source |
|---|---|---|
| `<appid>p.jpg` | 600×900 portrait capsule | `coverUrl` (fallback `heroUrl`) |
| `<appid>_hero.jpg` | 1920×620 hero | `heroUrl` (fallback `coverUrl`) |
| `<appid>.jpg` | 920×430 wide capsule | `heroUrl` (fallback `coverUrl`) |

Downloaded with Electron `net.fetch`, centre-cropped to the aspect ratio and resized with `nativeImage`, JPEG q90.
Skipped when `settings.steam.artworkSource === 'none'`. `resyncArtwork(titles)` rewrites art for every existing
`Xenith:` shortcut whose `--xcloud=` id is in `titles`.

## Messages (returned to the UI as-is)
- «Готово. Перезапустите Steam, чтобы увидеть ярлык.» (Steam running)
- «Готово. Ярлык появится при следующем запуске Steam.» (Steam not running)
- «Steam не найден.» / «В Steam нет ни одного пользователя. Войдите в Steam и повторите.» / «Не удалось записать ярлык: …»
