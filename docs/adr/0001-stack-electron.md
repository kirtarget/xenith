# ADR-0001 — Application stack: Electron

Status: accepted (2026-10-22). Revisit if Stage 3 measurements show Chromium decode/render adds measurable latency vs. a native path.

## Context
Xenith needs WebRTC (Xbox xHome is WebRTC), hardware video decode on AMD RX 9070 XT, Gamepad/XInput access, control of audio output device (X-Haptics listens to game audio), Windows 11 first, SteamOS second.

## Options
| Criterion | Electron | Tauri | Native (C++/libwebrtc or .NET) |
|---|---|---|---|
| WebRTC | Full Chromium stack, same as XBPlay (confirmed Electron 36/Chromium 136) | Windows: WebView2 (Chromium) OK. **Linux/SteamOS: WebKitGTK, weak WebRTC/H.264 HW decode** | Must build/embed libwebrtc — months of work |
| HW decode | Chromium D3D11VA/MF on Windows, VA-API on Linux (flags) | WebView2 = Chromium on Win; not controllable via flags as freely | Full control (D3D11VA/AMF) |
| Gamepad | Gamepad API (XInput on Windows), vibrationActuator incl. trigger-rumble | Same on WebView2; poor on WebKitGTK | XInput/SDL direct |
| Audio routing | `HTMLMediaElement.setSinkId` → any WASAPI endpoint | WebView2 yes; WebKitGTK no | WASAPI direct |
| Command-line/feature flags (low-latency, decode) | Yes (`app.commandLine.appendSwitch`) | Limited | n/a |
| SteamOS | AppImage/Flatpak, proven by Greenlight | Risky | Possible but expensive |
| Cost to working product | Lowest | Medium, risk on Linux | Highest |

## Decision
Electron (current stable), TypeScript, Vite renderer, React for UI components only (no app logic in UI). Protocol layer is a framework-free TypeScript package so UI and transport stay decoupled (prompt §8).

## Strategy (prompt §3.3)
- A (patch XBPlay): **rejected** — proprietary, Steam-updated, redistribution of modified commercial code.
- C (fork Greenlight wholesale): only if license and code quality allow; preferred is **B with reuse**: own app, reusing open-source protocol pieces under compatible licenses (final choice after license review in research report).

## Consequences
- Bundle ~150 MB. Acceptable for a desktop gaming utility.
- Decode latency must be measured, not assumed (getStats `totalDecodeTime`, `jitterBufferDelay`, `framesDropped`).
