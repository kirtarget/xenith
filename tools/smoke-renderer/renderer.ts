// Stage-2 smoke renderer: real session, real video, real measurements. No mock data.
import xStreamingPlayer from '../../vendor/xstreaming-player/src/index';

const x = (window as any).xenith;
const hud = document.getElementById('hud')!;
const setHud = (s: string) => { hud.textContent = s; };

interface Sample { [k: string]: number | string | undefined }
let prev: { bytes: number; ts: number; decode: number; frames: number; jbd: number; jbe: number } | null = null;

async function collect(pc: RTCPeerConnection): Promise<Sample | null> {
  const rep = await pc.getStats();
  let v: any, codec: any, pair: any, a: any;
  rep.forEach((s: any) => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') v = s;
    if (s.type === 'inbound-rtp' && s.kind === 'audio') a = s;
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
  });
  if (!v) return null;
  if (v.codecId) codec = rep.get(v.codecId);
  const out: Sample = {
    frameWidth: v.frameWidth, frameHeight: v.frameHeight, fps: v.framesPerSecond,
    framesDecoded: v.framesDecoded, framesDropped: v.framesDropped, packetsLost: v.packetsLost,
    jitterMs: v.jitter != null ? +(v.jitter * 1000).toFixed(1) : undefined,
    decoder: v.decoderImplementation, powerEfficientDecoder: v.powerEfficientDecoder,
    codec: codec?.mimeType, fmtp: codec?.sdpFmtpLine,
    rttMs: pair?.currentRoundTripTime != null ? +(pair.currentRoundTripTime * 1000).toFixed(1) : undefined,
    audioPacketsLost: a?.packetsLost, audioConcealed: a?.concealedSamples,
  };
  if (prev) {
    const dt = (v.timestamp - prev.ts) / 1000;
    out.kbps = Math.round(((v.bytesReceived - prev.bytes) * 8) / 1000 / dt);
    const df = v.framesDecoded - prev.frames;
    if (df > 0) out.decodeMsPerFrame = +(((v.totalDecodeTime - prev.decode) * 1000) / df).toFixed(2);
    const de = v.jitterBufferEmittedCount - prev.jbe;
    if (de > 0) out.jitterBufferMs = +(((v.jitterBufferDelay - prev.jbd) * 1000) / de).toFixed(1);
  }
  prev = { bytes: v.bytesReceived, ts: v.timestamp, decode: v.totalDecodeTime, frames: v.framesDecoded, jbd: v.jitterBufferDelay, jbe: v.jitterBufferEmittedCount };
  return out;
}

function hudText(s: Sample, cfg: any) {
  return `Xenith · smoke ${cfg.osName} · запрос ${cfg.width}×${cfg.height}\n` +
    `Видео   <${s.frameWidth}×${s.frameHeight}> ${s.fps ?? '–'} fps  ${s.codec ?? ''}\n` +
    `Битрейт ${s.kbps ?? '–'} kbps   декод ${s.decodeMsPerFrame ?? '–'} ms/кадр (${s.decoder ?? '?'})\n` +
    `Буфер   ${s.jitterBufferMs ?? '–'} ms   jitter ${s.jitterMs ?? '–'} ms   RTT ${s.rttMs ?? '–'} ms\n` +
    `Потери  ${s.packetsLost ?? 0} пакетов   пропущено ${s.framesDropped ?? 0} кадров`;
}

async function main() {
  const cfg = await x.config();
  (globalThis as any).__xenithDims = { w: cfg.width, h: cfg.height };
  if (cfg.caps) (globalThis as any).__xenithCaps = { supportsCustomResolution: true, supportsHevc: false, supportsHdr: false, supportsFps: 60, maxWidth: cfg.width, maxHeight: cfg.height, maxBitrateKbps: cfg.maxKbps, video: { width: cfg.width, height: cfg.height, maxWidth: cfg.width, maxHeight: cfg.height, maxBitrateKbps: cfg.maxKbps } };
  setHud('Xenith · ищу консоль…');
  const consoles = await x.consoles();
  x.event('consoles', consoles.map((c: any) => ({ name: c.name, type: c.type, power: c.power })));
  if (!consoles.length) { setHud('Консоли не найдены'); return; }
  const target = consoles[0];
  setHud(`Xenith · запускаю сессию на «${target.name}» (${target.power})…`);
  const t0 = performance.now();
  await x.start(target.serverId);
  x.event('provisioned', Math.round(performance.now() - t0));
  setHud('Xenith · консоль готова, WebRTC…');

  const player: any = new xStreamingPlayer('videoHolder', { ui_touchenabled: false, input_mousekeyboard: false });
  player.setVibration(true);
  player.setVibrationMode('Webview');
  player.setGamepadDeadZone(0.1);
  if (cfg.codecProfiles?.length) player.setCodecPreferences('video/H264', { profiles: cfg.codecProfiles });
  player.bind();
  const pc: RTCPeerConnection = player._webrtcClient;

  player.getEventBus().on('connectionstate', (e: any) => {
    x.event('connectionstate', e.state);
    if (e.state === 'connected') {
      x.event('connected', Math.round(performance.now() - t0));
      if (cfg.resAlias) setTimeout(() => { player.getChannelProcessor('control')?._sendControlMessage({ message: 'userRequestedResolutionUpdate', resolutionAlias: cfg.resAlias }); x.event('resAlias.sent', cfg.resAlias); }, 3000);
    }
  });
  player.setMessageHandler((m: any) => { x.event('console.msg', { target: m?.target, content: String(m?.content ?? '').slice(0, 400) }); return false; });
  player.setSdpHandler(async (_c: any, offer: any) => { player.setRemoteOffer(await x.sdp(offer.sdp)); }); // chat renegotiation

  const offer: any = await player.createOffer();
  player.setRemoteOffer(await x.sdp(offer.sdp));
  await new Promise<void>((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const to = setTimeout(res, 3000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(to); res(); } });
  });
  const local = player.getIceCandidates().map((c: any) => ({ candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex, sdpMid: c.sdpMid }));
  player.setIceCandidates(await x.ice(local));

  const timer = setInterval(async () => {
    const s = await collect(pc).catch(() => null);
    if (s) { x.stats(s); setHud(hudText(s, cfg)); }
  }, 1000);

  if (cfg.smokeSeconds > 0) {
    setTimeout(async () => { clearInterval(timer); try { player.close(); } catch {} await x.stop(); x.smokeDone(); }, cfg.smokeSeconds * 1000);
  }
}

main().catch((e) => { setHud('Ошибка: ' + (e?.message || e)); x.event('error', String(e?.message || e)); setTimeout(() => x.smokeDone(), 3000); });
