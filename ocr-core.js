// Lean PaddleOCR (PP-OCRv4) pipeline for onnxruntime-web. Works in browser and Node.
// img = { data: Uint8ClampedArray RGBA, width, height }
(function (root) {
  function resizeRGBA(img, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    const sx = img.width / w, sy = img.height / h;
    for (let y = 0; y < h; y++) {
      const fy = Math.min(img.height - 1, (y + 0.5) * sy - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(img.height - 1, y0 + 1), dy = Math.max(0, fy - y0);
      for (let x = 0; x < w; x++) {
        const fx = Math.min(img.width - 1, (x + 0.5) * sx - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(img.width - 1, x0 + 1), dx = Math.max(0, fx - x0);
        const i00 = (y0 * img.width + x0) * 4, i01 = (y0 * img.width + x1) * 4, i10 = (y1 * img.width + x0) * 4, i11 = (y1 * img.width + x1) * 4, o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          out[o + c] = (img.data[i00 + c] * (1 - dx) + img.data[i01 + c] * dx) * (1 - dy) + (img.data[i10 + c] * (1 - dx) + img.data[i11 + c] * dx) * dy;
        }
        out[o + 3] = 255;
      }
    }
    return { data: out, width: w, height: h };
  }

  function crop(img, x, y, w, h) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.min(img.width - x, Math.round(w)); h = Math.min(img.height - y, Math.round(h));
    const out = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
    return { data: out, width: w, height: h };
  }

  async function detect(ort, sess, img, maxSide) {
    maxSide = maxSide || 960;
    let r = Math.min(1, maxSide / Math.max(img.width, img.height));
    let w = Math.max(32, Math.round(img.width * r / 32) * 32), h = Math.max(32, Math.round(img.height * r / 32) * 32);
    const rs = resizeRGBA(img, w, h);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    const t = new Float32Array(3 * w * h);
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) t[c * w * h + i] = (rs.data[i * 4 + c] / 255 - mean[c]) / std[c];
    const out = await sess.run({ x: new ort.Tensor('float32', t, [1, 3, h, w]) });
    const prob = out[Object.keys(out)[0]].data;
    // connected components on binary map
    const bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bin[i] = prob[i] > 0.3 ? 1 : 0;
    const seen = new Uint8Array(w * h), boxes = [], stack = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!bin[i] || seen[i]) continue;
      let sp = 0, minx = w, miny = h, maxx = 0, maxy = 0, n = 0, score = 0;
      stack[sp++] = i; seen[i] = 1;
      while (sp) {
        const p = stack[--sp], px = p % w, py = (p / w) | 0;
        n++; score += prob[p];
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        const nb = [p - 1, p + 1, p - w, p + w];
        for (let k = 0; k < 4; k++) {
          const q = nb[k];
          if (q < 0 || q >= w * h) continue;
          if ((k === 0 && px === 0) || (k === 1 && px === w - 1)) continue;
          if (bin[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      if (Math.min(bw, bh) < 3 || score / n < 0.6) continue;
      const d = (bw * bh * 1.6) / (2 * (bw + bh)); // unclip
      const sx = img.width / w, sy = img.height / h;
      boxes.push({ x: (minx - d) * sx, y: (miny - d) * sy, w: (bw + 2 * d) * sx, h: (bh + 2 * d) * sy });
    }
    return boxes;
  }

  async function recognize(ort, sess, keys, img) {
    const H = 48, W = Math.max(16, Math.min(2000, Math.ceil(H * img.width / img.height)));
    const rs = resizeRGBA(img, W, H), t = new Float32Array(3 * W * H);
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) t[c * W * H + i] = (rs.data[i * 4 + c] / 255 - 0.5) / 0.5;
    const out = await sess.run({ x: new ort.Tensor('float32', t, [1, 3, H, W]) });
    const o = out[Object.keys(out)[0]], [, T, C] = o.dims, d = o.data;
    let s = '', last = -1, conf = 0, cnt = 0;
    for (let i = 0; i < T; i++) {
      let mi = 0, mv = -1;
      for (let j = 0; j < C; j++) if (d[i * C + j] > mv) { mv = d[i * C + j]; mi = j; }
      if (mi !== 0 && mi !== last) { s += keys[mi] || ''; conf += mv; cnt++; }
      last = mi;
    }
    return { text: s, conf: cnt ? conf / cnt : 0 };
  }

  // Group boxes into rows and return lines of text
  async function ocr(ort, det, rec, keys, img, opts) {
    opts = opts || {};
    const boxes = await detect(ort, det, img, opts.maxSide);
    const items = [];
    for (const b of boxes) {
      const c = crop(img, b.x, b.y, b.w, b.h);
      if (c.width < 4 || c.height < 4) continue;
      let r = await recognize(ort, rec, keys, c);
      if (c.height > c.width * 1.5) continue; // skip vertical noise
      if (r.text.trim() && r.conf > 0.5) items.push({ ...b, text: r.text.trim(), conf: r.conf });
      if (opts.onProgress) opts.onProgress(items.length / boxes.length);
    }
    items.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
    const rows = [];
    for (const it of items) {
      const cy = it.y + it.h / 2;
      const row = rows.find(r => Math.abs(r.cy - cy) < Math.min(r.h, it.h) * 0.5);
      if (row) { row.items.push(it); row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length; }
      else rows.push({ cy, h: it.h, items: [it] });
    }
    rows.sort((a, b) => a.cy - b.cy);
    return rows.map(r => r.items.sort((a, b) => a.x - b.x).map(i => i.text).join('  '));
  }

  function buildKeys(txt) { return [''].concat(txt.replace(/\r/g, '').split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')), [' ']); }

  const api = { ocr, buildKeys, resizeRGBA, crop };
  if (typeof module !== 'undefined') module.exports = api; else root.PaddleLite = api;
})(typeof self !== 'undefined' ? self : this);
