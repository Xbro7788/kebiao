/* ============ importer.js — PDF/图片 → 网格切块 OCR → 解析成课程 ============ */

const Importer = (() => {
  let workerPromise = null;

  function getWorker(onProgress) {
    if (workerPromise) return workerPromise;
    workerPromise = Tesseract.createWorker('chi_sim+eng', 1, {
      workerPath: 'lib/worker.min.js',
      corePath: 'lib/tesseract-core-simd.wasm.js',
      langPath: 'lib/',
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress && onProgress(Math.round(m.progress * 100));
        }
      }
    });
    return workerPromise;
  }

  /* ---------- 渲染 ---------- */
  async function pdfToImages(file) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf, cMapUrl: 'lib/cmaps/', cMapPacked: true }).promise;
    const images = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const base = Math.min(2600 / page.view[2], 3);
      const viewport = page.getViewport({ scale: base });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push({ canvas, page: p });
    }
    return images;
  }

  async function imageToCanvas(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const maxW = 2400;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  /* ---------- 网格线检测 ---------- */
  function detectLines(imgData, W, H, isVertical, ratio) {
    const len = isVertical ? W : H;
    const other = isVertical ? H : W;
    const lines = [];
    for (let i = 0; i < len; i += 2) { // 隔行采样加速
      let dark = 0;
      if (isVertical) {
        for (let y = 0; y < H; y += 2) {
          const idx = (y * W + i) * 4;
          if ((imgData.data[idx] + imgData.data[idx + 1] + imgData.data[idx + 2]) / 3 < 190) dark++;
        }
      } else {
        for (let x = 0; x < W; x += 2) {
          const idx = (i * W + x) * 4;
          if ((imgData.data[idx] + imgData.data[idx + 1] + imgData.data[idx + 2]) / 3 < 190) dark++;
        }
      }
      if (dark / (other / 2) > ratio) lines.push(i);
    }
    // 合并相邻线（<6px）
    const merged = [];
    for (const l of lines) {
      const last = merged[merged.length - 1];
      if (last !== undefined && l - last <= 6) merged[merged.length - 1] = Math.round((last + l) / 2);
      else merged.push(l);
    }
    return merged;
  }

  // 从 canvas 检测列线/行线，返回列中心与行中心
  function detectGrid(canvas) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, W, H);
    const vLines = detectLines(imgData, W, H, true, 0.55);
    const hLines = detectLines(imgData, W, H, false, 0.55);
    // 列中心：vLines 相邻两线中点（需要 7 列 → 8 条线）；不足则均分
    let colXs = [];
    if (vLines.length >= 8) {
      const inner = vLines.slice(0, 8);
      for (let i = 0; i < 7; i++) colXs.push(Math.round((inner[i] + inner[i + 1]) / 2));
    } else {
      for (let i = 0; i < 7; i++) colXs.push(Math.round(W * (i + 0.5) / 7));
    }
    // 行中心：hLines 相邻两线中点
    let rowYs = [];
    if (hLines.length >= 2) {
      for (let i = 0; i < hLines.length - 1; i++) rowYs.push(Math.round((hLines[i] + hLines[i + 1]) / 2));
    }
    return { colXs, rowYs, vLines, hLines, W, H };
  }

  // 从左侧节次数字识别行号
  async function detectRowNumbers(worker, canvas, colXs) {
    const firstColX = colXs[0];
    const pad = Math.round(firstColX * 0.9);
    // 裁剪左侧区域
    const c = document.createElement('canvas');
    c.width = Math.round(firstColX);
    c.height = canvas.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const { data } = await worker.recognize(blob, {}, { text: false, blocks: true, words: true });
    const map = new Map(); // 行中心y -> 节次号
    for (const w of data.words || []) {
      const t = (w.text || '').trim();
      if (/^[1-9]$/.test(t)) {
        const cy = (w.bbox.y0 + w.bbox.y1) / 2;
        map.set(Math.round(cy), +t);
      }
    }
    return map;
  }

  /* ---------- 切块 OCR ---------- */
  async function cropToBlob(canvas, x0, y0, x1, y1, scale) {
    const w = Math.max(20, Math.round((x1 - x0) * scale));
    const h = Math.max(20, Math.round((y1 - y0) * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }

  /* ---------- 整页处理 ---------- */
  async function processPage(canvas, onProgress) {
    const worker = await getWorker(onProgress);
    const grid = detectGrid(canvas);
    const { colXs, rowYs, vLines, hLines } = grid;
    window.__dbgInfo = { w: canvas.width, h: canvas.height, vLines, hLines, colXs, rowYs };

    // 1) 整页 OCR 快速定位哪些格子有内容
    const fullBlob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const full = await worker.recognize(fullBlob, {}, { text: true, words: true });
    window.__dbgOcrText = (full.data.text || '').slice(0, 500);
    const wordCells = new Set();
    for (const w of full.data.words || []) {
      const cx = (w.bbox.x0 + w.bbox.x1) / 2, cy = (w.bbox.y0 + w.bbox.y1) / 2;
      if (cx < colXs[0]) continue; // 左侧节次列
      const col = nearestIndex(colXs, cx);
      if (col < 0 || col > 6) continue;
      if (!rowYs.length) continue;
      const row = nearestIndex(rowYs, cy);
      if (row < 0) continue;
      wordCells.add(col + ',' + row);
    }

    // 2) 行号映射：整页 OCR 中左侧数字
    const rowNumByY = new Map();
    for (const w of full.data.words || []) {
      const t = (w.text || '').trim();
      if (/^[1-9]$/.test(t) && w.bbox.x1 < colXs[0] * 0.85) {
        const cy = Math.round((w.bbox.y0 + w.bbox.y1) / 2);
        rowNumByY.set(cy, +t);
      }
    }

    // 3) 对每个非空格子切块 OCR
    const cellW = colXs.length >= 2 ? (colXs[1] - colXs[0]) : 0;
    const courses = [];
    let total = wordCells.size, done = 0;
    for (const key of wordCells) {
      const [col, row] = key.split(',').map(Number);
      const cx = colXs[col];
      const cy = rowYs[row];
      const padX = Math.max(2, Math.round(cellW * 0.06));
      const padY = rowYs.length >= 2 ? Math.max(2, Math.round((rowYs[1] - rowYs[0]) * 0.10)) : 4;
      const x0 = Math.max(0, Math.round(cx - cellW / 2) + padX);
      const x1 = Math.min(canvas.width, Math.round(cx + cellW / 2) - padX);
      const halfH = rowYs.length >= 2 ? Math.round((rowYs[1] - rowYs[0]) / 2) : 120;
      const y0 = Math.max(0, Math.round(cy - halfH) + padY);
      const y1 = Math.min(canvas.height, Math.round(cy + halfH) - padY);
      if (x1 - x0 < 15 || y1 - y0 < 15) continue;
      const blob = await cropToBlob(canvas, x0, y0, x1, y1, 2.2);
      const { data } = await worker.recognize(blob, {}, { text: true });
      done++;
      onProgress && onProgress(Math.round(done / total * 100));
      const parsed = window.__kb_parser.parseCourseText(data.text);
      if (!parsed) continue;
      // 行号：优先左侧数字映射；否则按行序推断
      let start = null, end = null;
      // 找最近的行中心 y 对应的节次号
      let bestRow = -1, bestD = Infinity;
      for (const [yy, n] of rowNumByY) {
        const d = Math.abs(yy - cy);
        if (d < bestD) { bestD = d; bestRow = n; }
      }
      if (bestRow >= 0 && bestD < halfH) {
        start = parsed.start || bestRow;
        end = parsed.end || (parsed.start != null ? parsed.start : bestRow);
      } else {
        start = parsed.start != null ? parsed.start : (row + 1);
        end = parsed.end != null ? parsed.end : start;
      }
      courses.push({
        name: parsed.name,
        day: col,
        start, end,
        weeks: parsed.weeks,
        weeksStr: parsed.weeksStr,
        location: parsed.location,
        teacher: parsed.teacher,
        note: parsed.note
      });
    }
    return courses;
  }

  function nearestIndex(arr, v) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs(arr[i] - v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* ---------- 入口 ---------- */
  async function importFile(file, onProgress, onPage) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const pages = isPdf ? await pdfToImages(file) : [{ canvas: await imageToCanvas(file), page: 1 }];
    const all = [];
    for (let i = 0; i < pages.length; i++) {
      onPage && onPage(i + 1, pages.length);
      const cs = await processPage(pages[i].canvas, onProgress);
      all.push(...cs);
    }
    const seen = new Set();
    const uniq = [];
    for (const c of all) {
      const k = `${c.day}-${c.start}-${c.end}-${c.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(c);
    }
    uniq.sort((a, b) => a.day - b.day || a.start - b.start);
    return uniq;
  }

  return { importFile, getWorker };
})();
