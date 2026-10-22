# Open-source Xbox streaming clients — research (2026-10-22)

Method: shallow clones of default branches, licences read from LICENSE / package.json. GitHub API was unavailable, so issue/PR activity was not reviewed.

## Licences
| Repo | Licence | Last activity | xHome | Reuse in Xenith (MIT) |
|---|---|---|---|---|
| unknownskl/greenlight (main-v2) | MIT | 2026-10-19, v2.4.2 (2026-05) | yes | allowed |
| unknownskl/xbox-xcloud-player | MIT (package.json) | 2025-11 | yes | allowed |
| unknownskl/xal-node | MIT | 2026-10 | tokens | allowed |
| redphx/better-xcloud | MIT | v6.7.12 (2026-07) | yes | allowed |
| Geocld/XStreaming-desktop | MIT | v1.10.2 (2026-06) | yes | allowed |
| Geocld/xstreaming-player | MIT (package.json) | 2026-06 | yes | **vendored** (vendor/xstreaming-player) |
| Geocld/XStreaming (Android) | **AGPL-3.0** | v2.11.0 (2026-10) | yes | do not copy |
| rmrf404/green-nx (Switch) | **GPL-3.0** | 2026-09 | yes | do not copy; facts only |
| Day-OS/green-vita | MPL-2.0 | 2026-07 | untested | file-level copyleft |

## Protocol (verified in source)
- Tokens: XSTS for RP `http://gssv.xboxlive.com/` → `POST xhome.gssv-play-prod.xboxlive.com/v2/login/user {offeringId:"xhome", token}` with `x-gssv-client: XboxComBrowser`.
- `/connect` user token: MSA refresh with scope `service::http://Passport.NET/purpose::PURPOSE_XBOX_CLOUD_CONSOLE_TRANSFER_TOKEN`.
- Flow: `GET v6/servers/home` → `POST v5/sessions/home/play` (+`X-MS-Device-Info`) → poll `/state` → (`ReadyToConnect` → `/connect`) → `Provisioned` → `/sdp` → `/ice` → keepalive 30 s → `DELETE`.
- Resolution tier is selected by `osName` (body + `X-MS-Device-Info.dev.os.name`): `android`=720p, `windows`=1080p, `tizen`=1080p HQ. Green-NX claims the console agent only accepts `android` — **contradicted by our test (windows → 1080p works)**.
- In-stream: message channel `/streaming/characteristics/dimensionschanged` (horizontal/vertical/preferred*), `clientdevicecapabilities`; Green-NX reports a control message `userRequestedResolutionUpdate {resolutionAlias: Auto|720|720HQ|1080|1080HQ|1440}` (xCloud, unverified for xHome).
- SDP: clients reorder H.264 profiles (`4d` Main, `42e` constrained baseline, `420` baseline); `b=AS` only lowers bitrate. No HEVC/AV1 implementations.
- Data channels: `input` (1.0), `chat` (chatV1), `control` (controlV1), `message` (messageV1). Rumble: input report type 128 with left/right/leftTrigger/rightTrigger %, duration, delay, repeat.

## XBPlay (public sources)
Proprietary Electron app, Clarity Boost filters, mouse/keyboard, Steam shortcuts. Flathub listing EOL since 2025-09-29.

## Open questions
1440p on xHome: which request field the console honours; bitrate of HQ tiers; whether `userRequestedResolutionUpdate` works on xHome.
