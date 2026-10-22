# Xenith — design system and UX spec

Direction: **Premium Gaming Utility**. Dark, quiet and precise. The interface steps aside for the game; the one place it spends boldness is the **connection rail**, a live, honest account of what the console is doing right now (wake, preparation, WebRTC, video), with real timings.

## 1. Information architecture

```
Xenith
├── Консоль (home)              ← default; gamepad LB/RB cycles top-level
│   ├── Hero: my console, state, «Подключиться», connection rail
│   ├── Last session: real resolution / fps / bitrate + bitrate trace
│   ├── Controller: detected pads, mode
│   ├── Quality: active profile → opens Settings › Стриминг
│   └── History: recent sessions, one-press reconnect
├── Облако (xCloud)              ← Game Pass library; honest empty state if no subscription
│   ├── Search, recent, all games (cover grid)
│   └── Game sheet: play, add to Steam
├── Настройки
│   ├── Стриминг   profile, resolution, bitrate, codec
│   ├── Видео      sharpening/FSR, picture (brightness/contrast/saturation), scaling, HUD
│   ├── Звук       output device, volume
│   ├── Контроллеры vibration, trigger rumble, dead zone, remap, Guide combo, mouse & keyboard
│   ├── X-Haptics  diagnostics + Controller Bridge
│   ├── Сеть       region, IPv6, live network check
│   ├── Steam      library shortcut, cloud shortcuts, artwork
│   ├── Интерфейс  language, size, start fullscreen, auto-connect, tips
│   └── Дополнительно GPU mode, render pipeline, GPU status, logs, launch arguments, reset
├── Аккаунт (sheet)              sign-in by code, gamertag, sign out
└── Stream (full screen)         video only; overlay on demand (Esc / F1 / hold View+Menu)
    ├── HUD (corner, optional)   resolution · fps · bitrate · latency · loss
    └── Side panel               session controls, quick quality, controller, disconnect
```

## 2. Tokens (src/renderer/styles/tokens.css)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0B1018` | app background |
| `--surface-1` | `#121C29` | panels |
| `--surface-2` | `#1A2635` | raised controls, hover |
| `--surface-3` | `#22324A` | pressed / selected |
| `--line` | `rgba(145,161,180,.14)` | hairlines that separate groups |
| `--text` | `#F2F6FA` | primary text |
| `--text-2` | `#91A1B4` | secondary text |
| `--text-3` | `#62728A` | tertiary, disabled |
| `--accent` | `#57E36F` | the one call to action per screen, focus ring, live data; also the "ok" state |
| `--accent-ink` | `#062A10` | text on accent |
| `--warn` `--bad` | `#FFC266` `#FF6B7A` | state only, never decoration |

Type: **Onest** (Cyrillic-first geometric sans, variable 400–700), tabular figures for every number.
Scale (1.25): 12 · 14 · 16 · 20 · 25 · 31 · 39 px; body 14/22; titles 25/30 at 600; hero 39/44 at 600, tracking −0.01em.
Spacing: 4-pt grid — 4 8 12 16 24 32 48 64. Radius by hierarchy: controls 10, panels 16, hero 24 — not one radius everywhere.
Motion: 120 ms for state feedback, 220 ms for panels, `cubic-bezier(.2,.8,.2,1)`. One orchestrated moment only: the connection rail. `prefers-reduced-motion` disables slides.
Elevation: no drop-shadow kit. Depth comes from surface steps; overlays over video use `rgba(11,16,24,.78)` + 16 px blur.

## 3. Components

Button (primary / secondary / ghost / danger; sizes M, L) · IconButton · Toggle · Segmented · Slider (with live value) · ListSelect (gamepad-friendly select that opens a sheet) · SettingRow (label, description, control on the right) · Section · Rail (connection stages) · Sparkline · StatusDot · Badge (state only) · Skeleton · Toast · Sheet (side) · Modal (confirm) · EmptyState · CoverCard (cloud) · KeyHint (shows A/B/LB/RB or keyboard keys depending on last input).

## 4. Screens — wireframes

Home (1440p and 1080p; content max-width 1280, left nav 88 px collapsed / 232 px expanded ≥1600 px):
```
┌─nav─┬───────────────────────────────────────────────────────────────┐
│ ◉   │  Xbox                                       [Kirill ◯]        │
│ ☁   │  Xbox Series X · В режиме ожидания                            │
│ ⚙   │                                                               │
│     │  [  Подключиться  ]   Remote Play доступен                    │
│     │  ── rail: Пробуждение ─ Подготовка ─ Соединение ─ Видео ──    │
│     │                                                               │
│     │  Последняя сессия            │ Контроллер     │ Качество       │
│     │  1920×1080 · 60 к/с          │ Xbox Wireless  │ Баланс         │
│     │  ~~~~~~~ bitrate trace ~~~~~ │ Bluetooth      │ Авто · H.264   │
│     │  16,9 Мбит/с · 0 потерь      │                │                │
│     │                                                               │
│     │  История                                                      │
│     │  Сегодня 19:12   1080p60   12 мин   [Подключиться снова]      │
└─────┴───────────────────────────────────────────────────────────────┘
```
Left-aligned content, ragged right. Numbers right-aligned in tables.

Stream: edge-to-edge video, nothing else. HUD in a corner (user picks). Side panel slides from the right edge (never covers centre), 360 px.

Settings: two-pane — section list (left, 240 px) + rows (right, max 720 px). Every row: title, one-line plain description, control. Values that need restart say so in the row.

## 5. States

Loading = skeletons in the exact shape of content (no spinners except the connection rail). Empty and error states say what happened and offer the one action that fixes it:
- Not signed in → «Войдите в аккаунт Microsoft, к которому привязана Xbox» + «Войти».
- No console → «Консоль не найдена» + how to enable *Remote features* + «Обновить».
- Console off/unreachable, provisioning failed, ICE failed, session taken over, token expired — each has its own message and action.
- Cloud without Game Pass Ultimate → explains requirement; Remote Play remains available.

## 6. Gamepad navigation model

- Focusable elements carry `data-nav`; regions carry `data-nav-region`. D-pad/left stick move to the nearest focusable in that direction (geometry-based), preferring the current region; A = activate, B = back/close, LB/RB = previous/next top-level page (or settings section), Y = account, Menu = settings, View = toggle HUD while streaming.
- Focus ring: 2 px `--accent` outside + 4 px `rgba(73,216,255,.18)` halo, always visible for keyboard/gamepad; hidden for mouse clicks (`:focus-visible`).
- Hints in the footer switch between gamepad glyphs and keyboard keys based on last input device.
- During streaming the UI gamepad loop is suspended; pads go to the console. Overlay opens by holding View+Menu 0.6 s (XBPlay-compatible Guide combo is separate: press View+Menu briefly = Xbox button) or Esc/F1 on keyboard.

## 7. Copy rules

Russian first, English second. Sentence case, plain verbs, buttons say what happens («Подключиться», «Отключиться», «Войти», «Добавить в Steam»). No ALL-CAPS labels, no arrows in buttons, errors never apologise and always say what to do. Numbers: Russian formatting (16,9 Мбит/с, 60 к/с, 2560×1440).
