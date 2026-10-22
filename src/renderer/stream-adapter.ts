// The only place the UI touches the stream engine. The STREAM agent owns src/renderer/stream/index.ts
// and exports `createStreamController: CreateStreamController` from it.
// Preview builds (tools/ui-preview) alias './stream/index' to a fake engine; the real app build imports the real one.
import type { CreateStreamController, StreamController } from '../shared/stream-controller';
// @ts-ignore -- resolved at bundle time; the module is written by the STREAM agent.
import * as engine from './stream/index';

/** Optional engine extensions the UI uses when present (requested as contract additions). */
export interface StreamControllerExt extends StreamController {
  /** UI overlay is open: engine should stop forwarding pad input to the console while true. */
  setOverlayOpen?(open: boolean): void;
}

let instance: StreamControllerExt | null = null;

export function getStreamController(): StreamControllerExt {
  if (!instance) {
    const create = (engine as { createStreamController?: CreateStreamController }).createStreamController;
    if (typeof create !== 'function') throw new Error('stream engine missing: src/renderer/stream/index.ts must export createStreamController');
    instance = create() as StreamControllerExt;
  }
  return instance;
}
