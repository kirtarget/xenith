import VideoComponent from '../../vendor/xstreaming-player/src/Component/Video';
import { PostProcessor, type PostConfig } from '../../src/renderer/stream/postprocess';
import type { VideoFit } from '../../src/shared/api';

interface CheckResult { status: 'passed' | 'failed'; checks: string[]; error?: string }
declare global { interface Window { __fsrResult?: CheckResult } }

const checks: string[] = [];
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

async function until(test: () => boolean, message: string) {
  const deadline = performance.now() + 5000;
  while (!test() && performance.now() < deadline) await wait(25);
  assert(test(), message);
}

async function run() {
  const holder = document.querySelector<HTMLElement>('#holder')!;
  const source = document.createElement('canvas');
  source.width = 320;
  source.height = 180;
  const paint = source.getContext('2d')!;
  let frame = 0;
  const draw = () => {
    paint.fillStyle = '#2277bb'; paint.fillRect(0, 0, 320, 180);
    paint.fillStyle = '#ff5522'; paint.fillRect(0, 0, 32, 180);
    paint.fillStyle = '#33ee77'; paint.fillRect(288, 0, 32, 180);
    paint.fillStyle = '#ffffff'; paint.fillRect((frame++ % 200) + 50, 70, 20, 40);
  };
  draw();
  const timer = setInterval(draw, 30);
  const media = source.captureStream(30);
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
  holder.appendChild(video);
  video.srcObject = media;
  const player = { _video_format: '', _fsr_sharpness: 0, _videoComponent: null as unknown as VideoComponent };
  const component = new VideoComponent(player as never);
  component._video = video;
  player._videoComponent = component;
  const processor = new PostProcessor(holder, video, player);
  const config: PostConfig = { sharpness: 3, fsr: true, brightness: 1, contrast: 1, saturation: 1, fit: 'contain', bridge: false };
  try {
    await video.play();
    await until(() => video.videoWidth === 320 && video.videoHeight === 180, 'Synthetic video did not decode');
    processor.apply(config);
    processor.setReady();

    const check = async (fit: VideoFit, width: number, height: number) => {
      config.fit = fit;
      processor.apply({ ...config });
      await wait(350);
      assert(processor.mode === 'fsr', `Expected actual FSR for ${fit}, got ${processor.mode}`);
      const canvas = holder.querySelector('canvas');
      assert(canvas, `No FSR canvas for ${fit}`);
      await until(() => component._fsr?.renderer.info.render.calls > 0, `FSR did not render ${fit}`);
      const rect = canvas.getBoundingClientRect();
      const parent = holder.getBoundingClientRect();
      assert(Math.abs(rect.width - width) < 2 && Math.abs(rect.height - height) < 2,
        `${fit}: expected ${width}x${height}, got ${rect.width}x${rect.height}`);
      assert(Math.abs(rect.left + rect.width / 2 - parent.left - parent.width / 2) < 2 &&
        Math.abs(rect.top + rect.height / 2 - parent.top - parent.height / 2) < 2, `${fit}: canvas is not centered`);
      const gl = component._fsr.renderer.getContext() as WebGL2RenderingContext;
      assert(gl.getError() === gl.NO_ERROR, `WebGL error for ${fit}`);
      checks.push(`${fit} rendered ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`);
    };

    await check('contain', 640, 360);
    await check('cover', 640 * 10 / 9, 400);
    await check('fill', 640, 400);
    await check('contain', 640, 360);
    holder.style.width = '800px';
    holder.style.height = '600px';
    await wait(450);
    await check('contain', 800, 450);
    await check('cover', 600 * 16 / 9, 600);
    await check('fill', 800, 600);
    processor.dispose();
    assert(holder.querySelector('canvas') === null && component._fsr === null, 'FSR resources remain after dispose');
    assert(video.style.opacity === '1', 'Original video remains hidden after dispose');
    checks.push('ResizeObserver and disposal passed');
  } finally {
    processor.dispose();
    clearInterval(timer);
    media.getTracks().forEach(track => track.stop());
    video.pause();
    video.srcObject = null;
  }
}

run().then(() => { window.__fsrResult = { status: 'passed', checks }; })
  .catch(error => { window.__fsrResult = { status: 'failed', checks, error: String(error?.stack ?? error) }; });
