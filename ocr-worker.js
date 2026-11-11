// Runs PaddleOCR off the main thread so the page stays responsive.
importScripts('vendor/ort.min.js', 'ocr-core.js');

const base = self.location.href.replace(/[^/]*$/, '');
ort.env.wasm.wasmPaths = base + 'vendor/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

let ready = null, det, rec, keys;

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('下載失敗：' + url);
  if (!res.body || !res.body.getReader) { const b = await res.arrayBuffer(); onBytes(b.byteLength); return b; }
  const reader = res.body.getReader(), chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length; onBytes(value.length);
  }
  const out = new Uint8Array(n);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

function init() {
  if (ready) return ready;
  ready = (async () => {
    const total = 4745517 + 10822323 + 11246032; // det + rec + wasm (bytes)
    let loaded = 0;
    const tick = n => { loaded += n; postMessage({ type: 'progress', stage: 'load', value: Math.min(1, loaded / total) }); };
    // warm the wasm file through the same progress counter (it is cached afterwards)
    const wasmPromise = fetchWithProgress(base + 'vendor/ort-wasm-simd-threaded.wasm', tick);
    const [detBuf, recBuf, keysTxt] = await Promise.all([
      fetchWithProgress(base + 'models/det.onnx', tick),
      fetchWithProgress(base + 'models/rec.onnx', tick),
      fetch(base + 'models/keys.txt').then(r => r.text()),
    ]);
    const wasmBuf = await wasmPromise;
    ort.env.wasm.wasmBinary = wasmBuf;
    det = await ort.InferenceSession.create(detBuf);
    rec = await ort.InferenceSession.create(recBuf);
    keys = PaddleLite.buildKeys(keysTxt);
    postMessage({ type: 'ready' });
  })().catch(e => { ready = null; throw e; });
  return ready;
}

self.onmessage = async e => {
  const msg = e.data;
  try {
    if (msg.type === 'init') { await init(); return; }
    if (msg.type === 'ocr') {
      await init();
      const img = { data: new Uint8ClampedArray(msg.buffer), width: msg.width, height: msg.height };
      const lines = await PaddleLite.ocr(ort, det, rec, keys, img, {
        onProgress: v => postMessage({ type: 'progress', stage: 'ocr', value: v, id: msg.id }),
      });
      postMessage({ type: 'result', id: msg.id, lines });
    }
  } catch (err) {
    postMessage({ type: 'error', id: msg.id, message: String(err && err.message || err) });
  }
};
