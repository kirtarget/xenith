// ~1 Hz sampler over RTCPeerConnection.getStats(). Only real values; anything not exposed is null.
import type { StreamStats } from '../../shared/api';
import { describeCodec } from './sdp';

interface Prev { ts: number; bytes: number; decode: number; frames: number; jbd: number; jbe: number; jbt: number; jbm: number; proc: number; aJbd: number; aJbe: number }

export interface StatsSample { stats: StreamStats; extra: Record<string, unknown> }

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** a=fmtp line for a payload type in an SDP blob. */
export function fmtpFor(sdp: string | null, pt: number | undefined): string | null {
  if (!sdp || pt == null) return null;
  const m = new RegExp(`^a=fmtp:${pt} (.*)$`, 'm').exec(sdp);
  return m ? m[1].trim() : null;
}

export class StatsSampler {
  private prev: Prev | null = null;
  /** remoteSdp: the console's answer; its fmtp states what the console encodes (local fmtp is Chromium's receive default). */
  constructor(private pc: RTCPeerConnection, private remoteSdp: () => string | null = () => null) {}

  async sample(): Promise<StatsSample | null> {
    if (this.pc.connectionState === 'closed') return null;
    const rep = await this.pc.getStats();
    let v: any = null, a: any = null, transport: any = null, nominated: any = null;
    rep.forEach((s: any) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') v = s;
      else if (s.type === 'inbound-rtp' && s.kind === 'audio') a = s;
      else if (s.type === 'transport') transport = s;
      else if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') nominated = s;
    });
    const pair: any = (transport?.selectedCandidatePairId && rep.get(transport.selectedCandidatePairId)) || nominated;
    if (!v) return null;
    const codec: any = v.codecId ? rep.get(v.codecId) : null;
    const local: any = pair?.localCandidateId ? rep.get(pair.localCandidateId) : null;
    const remote: any = pair?.remoteCandidateId ? rep.get(pair.remoteCandidateId) : null;

    let kbps: number | null = null, decodeMs: number | null = null, jbMs: number | null = null, procMs: number | null = null, aJbMs: number | null = null;
    let jbTargetMs: number | null = null, jbMinMs: number | null = null;
    const p = this.prev;
    if (p) {
      const dt = (v.timestamp - p.ts) / 1000;
      if (dt > 0 && v.bytesReceived != null) kbps = Math.round(((v.bytesReceived - p.bytes) * 8) / 1000 / dt);
      const df = (v.framesDecoded ?? 0) - p.frames;
      if (df > 0 && v.totalDecodeTime != null) decodeMs = r2(((v.totalDecodeTime - p.decode) * 1000) / df);
      if (df > 0 && v.totalProcessingDelay != null) procMs = r2(((v.totalProcessingDelay - p.proc) * 1000) / df);
      const de = (v.jitterBufferEmittedCount ?? 0) - p.jbe;
      if (de > 0 && v.jitterBufferDelay != null) jbMs = r1(((v.jitterBufferDelay - p.jbd) * 1000) / de);
      if (de > 0 && v.jitterBufferTargetDelay != null) jbTargetMs = r1(((v.jitterBufferTargetDelay - p.jbt) * 1000) / de);
      if (de > 0 && v.jitterBufferMinimumDelay != null) jbMinMs = r1(((v.jitterBufferMinimumDelay - p.jbm) * 1000) / de);
      const ade = (a?.jitterBufferEmittedCount ?? 0) - p.aJbe;
      if (a && ade > 0) aJbMs = r1(((a.jitterBufferDelay - p.aJbd) * 1000) / ade);
    }
    this.prev = {
      ts: v.timestamp, bytes: v.bytesReceived ?? 0, decode: v.totalDecodeTime ?? 0, frames: v.framesDecoded ?? 0,
      jbd: v.jitterBufferDelay ?? 0, jbe: v.jitterBufferEmittedCount ?? 0, jbt: v.jitterBufferTargetDelay ?? 0, jbm: v.jitterBufferMinimumDelay ?? 0, proc: v.totalProcessingDelay ?? 0,
      aJbd: a?.jitterBufferDelay ?? 0, aJbe: a?.jitterBufferEmittedCount ?? 0,
    };

    const stats: StreamStats = {
      at: Date.now(),
      frameWidth: v.frameWidth ?? null,
      frameHeight: v.frameHeight ?? null,
      fps: v.framesPerSecond ?? null,
      kbps,
      rttMs: pair?.currentRoundTripTime != null ? r1(pair.currentRoundTripTime * 1000) : null,
      jitterMs: v.jitter != null ? r1(v.jitter * 1000) : null,
      jitterBufferMs: jbMs,
      decodeMsPerFrame: decodeMs,
      packetsLost: v.packetsLost ?? 0,
      framesDropped: v.framesDropped ?? 0,
      codec: describeCodec(codec?.mimeType, fmtpFor(this.remoteSdp(), codec?.payloadType) ?? codec?.sdpFmtpLine),
      decoder: typeof v.decoderImplementation === 'string' ? v.decoderImplementation : null,
      hardwareDecode: typeof v.powerEfficientDecoder === 'boolean' ? v.powerEfficientDecoder : null,
    };
    const extra = {
      fmtp: codec?.sdpFmtpLine ?? null, remoteFmtp: fmtpFor(this.remoteSdp(), codec?.payloadType), payloadType: codec?.payloadType, mime: codec?.mimeType ?? null,
      framesDecoded: v.framesDecoded, framesReceived: v.framesReceived, keyFramesDecoded: v.keyFramesDecoded,
      freezeCount: v.freezeCount, totalFreezesDuration: v.totalFreezesDuration, pauseCount: v.pauseCount,
      nackCount: v.nackCount, pliCount: v.pliCount, firCount: v.firCount, packetsReceived: v.packetsReceived,
      jitterBufferTargetMs: jbTargetMs, jitterBufferMinimumMs: jbMinMs,
      processingMsPerFrame: procMs,
      audioPacketsLost: a?.packetsLost, audioConcealed: a?.concealedSamples, audioJitterBufferMs: aJbMs,
      candidate: local ? `${local.candidateType}/${local.protocol} -> ${remote?.candidateType}` : null,
      availableIncomingKbps: pair?.availableIncomingBitrate != null ? Math.round(pair.availableIncomingBitrate / 1000) : null,
    };
    return { stats, extra };
  }
}
