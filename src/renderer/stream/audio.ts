// RMS level of the remote audio track (~10 Hz) for X-Haptics diagnostics. Analyser only: not routed to the speakers
// (the vendored <audio> element plays the sound), so it never changes what the user hears.
export class AudioTap {
  private ctx: AudioContext;
  private src: MediaStreamAudioSourceNode;
  private an: AnalyserNode;
  private buf: Float32Array<ArrayBuffer>;
  private timer: number;

  constructor(track: MediaStreamTrack, onLevel: (rms: number) => void, hz = 10) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 2048;
    this.src.connect(this.an);
    this.buf = new Float32Array(this.an.fftSize);
    this.ctx.resume().catch(() => {});
    this.timer = window.setInterval(() => {
      this.an.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      onLevel(Math.min(1, Math.sqrt(sum / this.buf.length)));
    }, 1000 / hz);
  }

  close() {
    clearInterval(this.timer);
    try { this.src.disconnect(); } catch { /* ignore */ }
    this.ctx.close().catch(() => {});
  }
}
