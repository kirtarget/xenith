// node tools/stream-test/summarize.mjs <log.jsonl>  -> compact per-phase summary (stats + CPU/GPU from harness metrics)
import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ts = (l) => Date.parse(l.t);
const startAt = lines.find((l) => l.event === 'state' && l.data?.s === 'streaming');
const bounds = [{ label: 'initial', at: startAt ? ts(startAt) : ts(lines[0]) }];
for (const l of lines) if (l.event === 'action') bounds.push({ label: l.data.label || l.data.do, at: ts(l) });
const phaseOf = (t) => { let p = null; for (const b of bounds) if (t >= b.at + 3000) p = b.label; return p; };
const acc = {};
const add = (ph, k, v) => { if (typeof v !== 'number' || !ph) return; ((acc[ph] ||= {})[k] ||= []).push(v); };
const endAt = lines.find((l) => l.event === 'result');
for (const l of lines) {
  const t = ts(l);
  if (endAt && t > ts(endAt)) continue;
  const ph = phaseOf(t);
  if (l.event === 'metrics') {
    for (const p of l.data) { if (p.type === 'Tab') { add(ph, 'tabCpu', p.cpu); add(ph, 'tabWsMB', p.wsMB); } if (p.type === 'GPU') { add(ph, 'gpuProcCpu', p.cpu); add(ph, 'gpuWsMB', p.wsMB); } if (p.type === 'Browser') add(ph, 'mainCpu', p.cpu); }
  } else if (l.event === 'gpu') {
    const e = l.data.engines; add(ph, 'gpu3d', e['3d']); add(ph, 'gpuVideoCodec', e['video codec 0']); add(ph, 'gpuCopy', e['copy']);
  }
}
const avg = (a) => (a && a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
const res = lines.find((l) => l.event === 'result')?.data;
const out = { file: process.argv[2].split(/[\\/]/).pop(), phases: [] };
for (const p of res?.phases || []) {
  const a = acc[p.label] || {};
  out.phases.push({ ...p, cpuGpu: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, avg(v)])) });
}
const keep = ['dbg.control.sent', 'dbg.loss', 'dbg.iceRestart.ok', 'dbg.iceRestart.err', 'dbg.resession', 'dbg.resession.ok', 'dbg.resession.err', 'dbg.post.mode', 'dbg.post.err',
  'controllers', 'error', 'start.failed', 'fatal', 'renderer.console', 'sdp.exchange', 'ice.exchange', 'action', 'action.result', 'stop.ok', 'stop.err', 'session.provisioned', 'dbg.audio.sink.err', 'dbg.jbt.err', 'renderer.gone', 'harness.exit', 'dbg.pc.state', 'state'];
out.events = lines.filter((l) => keep.includes(l.event)).map((l) => `${l.t.slice(11, 19)} ${l.event} ${JSON.stringify(l.data).slice(0, 220)}`);
out.audio = lines.filter((l) => l.event === 'audio').map((l) => l.data);
out.mem = lines.filter((l) => l.event === 'mem').map((l) => `${l.data.t}s:${l.data.usedMB}MB/${l.data.dom}`).join(' ');
out.rumbles = res?.rumbles;
if (process.argv[3] === 'brief') {
  const f = (o) => (o ? `${o.avg}(${o.min}-${o.max})` : '-');
  console.log(out.file);
  for (const p of out.phases) {
    const c = p.cpuGpu;
    console.log(`  [${p.label}@${p.from}s n=${p.n}] ${p.frame} ${p.codec} post=${p.post} fps=${f(p.fps)} kbps=${f(p.kbps)} dec=${f(p.decodeMs)} proc=${f(p.procMs)} jb=${f(p.jitterBufferMs)} jbT=${f(p.jbTargetMs)} aJb=${f(p.audioJbMs)} rtt=${f(p.rttMs)} lost=${p.packetsLost} drop=${p.framesDropped} frz=${p.freezeCount} | tabCpu=${c.tabCpu} gpuProcCpu=${c.gpuProcCpu} mainCpu=${c.mainCpu} gpu3d=${c.gpu3d} vcodec=${c.gpuVideoCodec} gpuWs=${c.gpuWsMB} tabWs=${c.tabWsMB}`);
  }
  for (const e of out.events) if (!/ state |pc.state|session.provisioned|harness.exit/.test(e)) console.log('  ' + e);
  console.log('  mem ' + out.mem + ' rumbles=' + out.rumbles + ' audioMax=' + Math.max(0, ...out.audio.map((a) => a.max)));
} else console.log(JSON.stringify(out, null, 1));
