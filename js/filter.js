// 写ルンです風の加工 ＋ チェキ（instax）風フレーム
(function () {
  // instax の実寸（mm）。縦写真は mini、横写真は wide
  const SPEC = {
    mini: { cardW: 54, cardH: 86, imgW: 46, imgH: 62, left: 4, top: 6, imgPx: 880 },
    wide: { cardW: 108, cardH: 86, imgW: 99, imgH: 62, left: 4.5, top: 6, imgPx: 1360 }
  };

  // 7セグメント表示の点灯パターン
  const SEG = {
    0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
    5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg'
  };

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function rng(seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  async function loadImage(file) {
    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) { /* Safari の一部バージョンはオプション非対応 → img 要素で読み込む */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像形式は読み込めませんでした')); };
      img.src = url;
    });
  }

  // フィルムっぽいトーンカーブ（黒浮き・ハイライトは暖色、シャドウはわずかに青緑）
  function buildLuts() {
    const r = new Uint8ClampedArray(256);
    const g = new Uint8ClampedArray(256);
    const b = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const x = v / 255;
      const s = x < 0.5 ? 0.5 * Math.pow(2 * x, 1.18) : 1 - 0.5 * Math.pow(2 * (1 - x), 1.18);
      const f = 0.075 + s * 0.875;
      r[v] = (f + 0.03 * x + 0.008) * 255;
      g[v] = (f + 0.012) * 255;
      b[v] = (f * 0.92 + 0.04 * (1 - x)) * 255;
    }
    return { r, g, b };
  }
  const LUT = buildLuts();

  function gradePixels(ctx, w, h, rand) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const sat = 0.84;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      // 緑を少し黄色寄りに（フィルムらしい発色）
      if (g > r && g > b) r += (g - Math.max(r, b)) * 0.28;
      // 彩度を少し落とす
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
      r = LUT.r[r < 0 ? 0 : r > 255 ? 255 : r | 0];
      g = LUT.g[g < 0 ? 0 : g > 255 ? 255 : g | 0];
      b = LUT.b[b < 0 ? 0 : b > 255 ? 255 : b | 0];
      // 細かい粒子（暗部ほど強く）
      const amt = 9 + (1 - l / 255) * 9;
      const n = (rand() - 0.5) * amt;
      d[i] = r + n + (rand() - 0.5) * 4;
      d[i + 1] = g + n;
      d[i + 2] = b + n + (rand() - 0.5) * 4;
    }
    ctx.putImageData(img, 0, 0);
  }

  // ざらっとした大きめの粒状感
  function overlayGrain(ctx, w, h, rand) {
    const gw = Math.ceil(w / 2), gh = Math.ceil(h / 2);
    const gc = makeCanvas(gw, gh);
    const gctx = gc.getContext('2d');
    const img = gctx.createImageData(gw, gh);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = 128 + ((rand() + rand() + rand()) - 1.5) * 70;
      d[i] = d[i + 1] = d[i + 2] = n;
      d[i + 3] = 255;
    }
    gctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.32;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(gc, 0, 0, w, h);
    ctx.restore();
  }

  function vignette(ctx, w, h) {
    const diag = Math.hypot(w, h) / 2;
    const grad = ctx.createRadialGradient(w / 2, h / 2, diag * 0.42, w / 2, h / 2, diag * 1.02);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(40,22,8,0.55)');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // ときどき入る、ふんわりした光漏れ
  function lightLeak(ctx, w, h, rand) {
    if (rand() > 0.4) return;
    const fromLeft = rand() < 0.5;
    const x = fromLeft ? -w * 0.1 : w * 1.1;
    const y = h * (0.1 + rand() * 0.6);
    const r = Math.max(w, h) * (0.45 + rand() * 0.25);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,130,50,0.42)');
    grad.addColorStop(0.5, 'rgba(255,90,40,0.14)');
    grad.addColorStop(1, 'rgba(255,90,40,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawDigit(ctx, x, y, w, h, t, digit) {
    const on = SEG[digit] || '';
    const gap = t * 0.12;
    const hh = h / 2;
    const v = hh - t / 2 - t - gap * 2; // 縦セグメントの長さ
    const seg = {
      a: [x + t + gap, y, w - 2 * t - 2 * gap, t],
      b: [x + w - t, y + t / 2 + gap + t / 2, t, v],
      c: [x + w - t, y + hh + t / 2 + gap, t, v],
      d: [x + t + gap, y + h - t, w - 2 * t - 2 * gap, t],
      e: [x, y + hh + t / 2 + gap, t, v],
      f: [x, y + t / 2 + gap + t / 2, t, v],
      g: [x + t + gap, y + hh - t / 2, w - 2 * t - 2 * gap, t]
    };
    for (const k of on) ctx.fillRect(...seg[k]);
  }

  function parseDate(str) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str || '');
    const dt = m ? { y: +m[1], mo: +m[2], d: +m[3] } : (() => {
      const n = new Date();
      return { y: n.getFullYear(), mo: n.getMonth() + 1, d: n.getDate() };
    })();
    return { yy: String(dt.y).slice(-2), mo: String(dt.mo), d: String(dt.d) };
  }

  // 写ルンです風のオレンジ色の日付（例: '26 10 12）
  function dateStamp(ctx, w, h, dateStr) {
    const { yy, mo, d } = parseDate(dateStr);
    const tokens = ["'", ...yy, ' ', ...mo, ' ', ...d];
    const dh = Math.round(h * 0.05);
    const dw = dh * 0.6;
    const t = Math.max(2, dh * 0.11);
    const sp = dh * 0.2;
    const widths = tokens.map(c => (c === "'" ? dh * 0.18 : c === ' ' ? dh * 0.42 : c === '1' ? t * 1.6 : dw));
    const total = widths.reduce((a, b) => a + b, 0) + sp * (tokens.length - 1);
    const x0 = w - w * 0.06 - total;
    const y0 = h - h * 0.05 - dh;

    const paint = () => {
      let x = 0;
      tokens.forEach((c, i) => {
        if (c === "'") ctx.fillRect(x, 0, t * 0.9, dh * 0.3);
        else if (c !== ' ') drawDigit(ctx, x, 0, widths[i], dh, t, c);
        x += widths[i] + sp;
      });
    };

    ctx.save();
    ctx.translate(x0, y0);
    ctx.transform(1, 0, -0.1, 1, 0, 0);
    ctx.globalCompositeOperation = 'screen';
    ctx.shadowColor = 'rgba(255,80,10,0.95)';
    ctx.shadowBlur = dh * 0.45;
    ctx.fillStyle = 'rgba(255,120,40,0.85)';
    paint();
    ctx.shadowBlur = dh * 0.12;
    ctx.fillStyle = 'rgba(255,185,110,0.75)';
    paint();
    ctx.restore();
  }

  function paperTexture(ctx, w, h, rand) {
    const size = 160;
    const pc = makeCanvas(size, size);
    const pctx = pc.getContext('2d');
    const img = pctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = rand() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
      img.data[i + 3] = 10;
    }
    pctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.fillStyle = ctx.createPattern(pc, 'repeat');
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function toBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('画像の書き出しに失敗しました'))), 'image/jpeg', quality);
    });
  }

  /**
   * 写真ファイルをチェキ風に加工する
   * @returns {Promise<{blob: Blob, width: number, height: number, format: string}>}
   */
  async function makeCheki(file, opts = {}) {
    const src = await loadImage(file);
    const sw = src.width || src.naturalWidth;
    const sh = src.height || src.naturalHeight;
    const format = sw > sh * 1.05 ? 'wide' : 'mini';
    const spec = SPEC[format];
    const rand = rng((Date.now() ^ (sw * 7919 + sh)) >>> 0);

    const pxPerMm = spec.imgPx / spec.imgW;
    const iw = spec.imgPx;
    const ih = Math.round(spec.imgH * pxPerMm);

    // 中央でトリミング
    const ratio = spec.imgW / spec.imgH;
    let cw = sw, ch = sh;
    if (sw / sh > ratio) cw = sh * ratio; else ch = sw / ratio;
    const cx = (sw - cw) / 2, cy = (sh - ch) / 2;

    // 一度小さくしてから拡大し、写ルンですくらいの柔らかい解像感に
    const soft = makeCanvas(Math.round(iw * 0.66), Math.round(ih * 0.66));
    const sctx = soft.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, cx, cy, cw, ch, 0, 0, soft.width, soft.height);
    if (src.close) src.close();

    const photo = makeCanvas(iw, ih);
    const pctx = photo.getContext('2d', { willReadFrequently: true });
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(soft, 0, 0, iw, ih);

    gradePixels(pctx, iw, ih, rand);
    overlayGrain(pctx, iw, ih, rand);
    lightLeak(pctx, iw, ih, rand);
    vignette(pctx, iw, ih);
    dateStamp(pctx, iw, ih, opts.date);

    // チェキの台紙
    const cardW = Math.round(spec.cardW * pxPerMm);
    const cardH = Math.round(spec.cardH * pxPerMm);
    const card = makeCanvas(cardW, cardH);
    const c = card.getContext('2d');
    c.fillStyle = '#fbf8f1';
    c.fillRect(0, 0, cardW, cardH);
    paperTexture(c, cardW, cardH, rand);

    const ix = Math.round(spec.left * pxPerMm);
    const iy = Math.round(spec.top * pxPerMm);
    c.drawImage(photo, ix, iy);
    // 写真の窓のわずかな段差
    c.strokeStyle = 'rgba(60,40,20,0.18)';
    c.lineWidth = Math.max(1, pxPerMm * 0.12);
    c.strokeRect(ix, iy, iw, ih);

    const blob = await toBlob(card, 0.86);
    return { blob, width: cardW, height: cardH, format };
  }

  window.ChekiFilter = { makeCheki };
})();
