(function () {
  const cfg = window.APP_CONFIG;
  const api = window.PhotoApi;
  const $ = id => document.getElementById(id);

  const state = {
    items: [],
    filter: '',
    selecting: false,
    selected: new Set(),
    lbIndex: -1,
    lbVer: 'cheki',
    pendingOriginals: 0
  };

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /Android|Mobile/i.test(navigator.userAgent);

  /* ---------- header ---------- */
  (function initHeader() {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(cfg.EVENT_DATE || '');
    $('eventDate').textContent = m ? `${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}` : '';
    $('venue').textContent = cfg.VENUE || '';
  })();

  if (!api.hasToken) {
    document.querySelector('main').innerHTML =
      '<p class="locked-msg">このページは招待されたゲスト専用です。<br>テーブルのQRコードから開いてください。</p>';
    return;
  }

  /* ---------- helpers ---------- */
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  function hashRot(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return ((Math.abs(h) % 50) / 10 - 2.5).toFixed(2) + 'deg';
  }

  function visibleItems() {
    return state.filter === '__mine' ? state.items.filter(x => x.mine) : state.items;
  }

  function setImg(img, fileId, size) {
    img.onerror = () => {
      img.onerror = null;
      img.src = api.altThumbUrl(fileId, size);
    };
    img.src = api.thumbUrl(fileId, size);
  }

  // 一覧の画像は表示幅に合わせた大きさで取得する（大きすぎると読み込みが遅い）
  const THUMB = 400;

  /* ---------- 前回の一覧（開いた瞬間に表示するため端末に保存） ---------- */
  const LIST_KEY = 'wps_list_v2';
  function loadSavedList() {
    try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveList() {
    try { localStorage.setItem(LIST_KEY, JSON.stringify(state.items.slice(0, 300))); } catch (e) {}
  }

  /* ---------- gallery ---------- */
  const tiles = new Map();

  function buildTile(item) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tile';
    el.dataset.id = item.id;
    const wide = item.w && item.h && item.w > item.h;
    if (wide) el.classList.add('wide');
    el.style.setProperty('--r', hashRot(item.id));
    el.style.setProperty('--ar', item.w && item.h ? `${item.w} / ${item.h}` : '54 / 86');
    const img = document.createElement('img');
    img.alt = item.message || '写真';
    img.loading = 'lazy';
    img.decoding = 'async';
    setImg(img, item.id, wide ? THUMB * 2 : THUMB);
    el.appendChild(img);
    if (item.message) {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = item.message;
      el.appendChild(who);
    }
    const check = document.createElement('span');
    check.className = 'check';
    el.appendChild(check);
    el.addEventListener('click', () => onTileClick(item.id));
    return el;
  }

  function render() {
    const gallery = $('gallery');
    const list = visibleItems();
    const frag = document.createDocumentFragment();
    list.forEach(item => {
      let el = tiles.get(item.id);
      if (!el) {
        el = buildTile(item);
        tiles.set(item.id, el);
      }
      el.classList.toggle('selected', state.selected.has(item.id));
      frag.appendChild(el);
    });
    gallery.replaceChildren(frag);
    gallery.classList.toggle('selecting', state.selecting);
    $('empty').hidden = list.length > 0;
    $('count').textContent = state.items.length ? `${state.items.length}枚` : '';
    renderFilters();
    renderSelectBar();
  }

  function renderFilters() {
    const box = $('filters');
    const hasMine = state.items.some(x => x.mine);
    box.hidden = !hasMine;
    const opts = [['', 'すべて'], ['__mine', '自分の写真']];
    box.replaceChildren(...opts.map(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.filter === v ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => { state.filter = v; render(); });
      return b;
    }));
  }

  async function refresh() {
    try {
      const items = await api.list();
      const changed = items.length !== state.items.length ||
        items.some((x, i) => x.id !== state.items[i].id);
      state.items = items;
      saveList();
      const ids = new Set(items.map(x => x.id));
      [...tiles.keys()].forEach(id => { if (!ids.has(id)) tiles.delete(id); });
      [...state.selected].forEach(id => { if (!ids.has(id)) state.selected.delete(id); });
      if (changed || !$('gallery').children.length) render();
    } catch (e) {
      if (e.code === 'unauthorized') {
        document.querySelector('main').innerHTML =
          '<p class="locked-msg">合言葉が正しくありません。<br>テーブルのQRコードから開き直してください。</p>';
        clearInterval(refresh._timer);
      } else {
        console.warn(e);
      }
    }
  }

  /* ---------- upload ---------- */
  const messageInput = $('message');

  async function handleFiles(fileList) {
    const files = [...fileList].filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return;
    // 選んだ写真にだけメッセージを付け、次の写真用に欄を空にする
    const message = messageInput.value.trim();
    messageInput.value = '';
    const queue = $('queue');
    queue.hidden = false;
    const jobs = files.map(file => {
      const el = document.createElement('div');
      el.className = 'q-item';
      el.innerHTML = '<div class="q-photo"><div class="q-blank"></div></div><span class="q-state">現像中…</span>';
      queue.prepend(el);
      return { file, el, message };
    });
    for (const job of jobs) await runJob(job);
  }

  // チェキ版を送ったらすぐアルバムに出し、元写真は裏で順番に送る
  async function runJob(job) {
    const { file, el } = job;
    const stateEl = el.querySelector('.q-state');
    const photo = el.querySelector('.q-photo');
    el.classList.remove('error');
    el.onclick = null;
    try {
      if (!job.cheki) {
        stateEl.textContent = '現像中…';
        job.cheki = await window.ChekiFilter.makeCheki(file, { date: cfg.EVENT_DATE });
        photo.classList.toggle('wide', job.cheki.format === 'wide');
        photo.innerHTML = '';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(job.cheki.blob);
        photo.appendChild(img);
      }
      stateEl.textContent = '送信中…';
      job.item = await api.upload({
        processed: job.cheki.blob,
        message: job.message,
        w: job.cheki.width,
        h: job.cheki.height
      });
      if (!state.items.some(x => x.id === job.item.id)) {
        state.items.unshift(job.item);
        saveList();
        render();
      }
      queueOriginal(job);
    } catch (e) {
      console.error(e);
      el.classList.add('error');
      stateEl.textContent = '失敗・タップで再送';
      el.onclick = () => runJob(job);
    }
  }

  let originalChain = Promise.resolve();
  function queueOriginal(job) {
    const stateEl = job.el.querySelector('.q-state');
    job.el.classList.add('done');
    stateEl.textContent = '届きました';
    state.pendingOriginals++;
    originalChain = originalChain.then(async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const originalId = await api.uploadOriginal(job.item.id, job.file);
          state.items.concat(job.item).forEach(x => { if (x.id === job.item.id) x.originalId = originalId; });
          saveList();
          state.pendingOriginals--;
          return;
        } catch (e) {
          console.warn(e);
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      state.pendingOriginals--;
      job.el.classList.add('error');
      stateEl.textContent = '元写真が未送信・タップで再送';
      job.el.onclick = () => {
        job.el.onclick = null;
        job.el.classList.remove('error');
        queueOriginal(job);
      };
    });
  }

  // 元写真の送信中にページを閉じようとしたら確認する
  window.addEventListener('beforeunload', e => {
    if (state.pendingOriginals > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  $('pickFiles').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
  $('takePhoto').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });

  /* ---------- selection ---------- */
  function onTileClick(id) {
    if (state.selecting) {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      tiles.get(id).classList.toggle('selected', state.selected.has(id));
      renderSelectBar();
    } else {
      openLightbox(visibleItems().findIndex(x => x.id === id));
    }
  }

  function setSelecting(on) {
    state.selecting = on;
    if (!on) state.selected.clear();
    $('selectToggle').classList.toggle('on', on);
    $('selectToggle').textContent = on ? 'やめる' : '選んで保存';
    render();
  }

  function renderSelectBar() {
    $('selectBar').hidden = !state.selecting;
    $('selectedCount').textContent = `${state.selected.size}枚`;
    $('saveSelected').disabled = state.selected.size === 0;
  }

  $('selectToggle').addEventListener('click', () => setSelecting(!state.selecting));
  $('selectAll').addEventListener('click', () => {
    const list = visibleItems();
    const all = list.every(x => state.selected.has(x.id));
    list.forEach(x => (all ? state.selected.delete(x.id) : state.selected.add(x.id)));
    render();
  });
  $('saveSelected').addEventListener('click', () => {
    const list = state.items.filter(x => state.selected.has(x.id));
    askVersionThenSave(list);
  });

  function askVersionThenSave(list) {
    openSheet({
      title: `${list.length}枚を保存`,
      text: 'どちらの写真を保存しますか？',
      ok: 'チェキ版を保存',
      onOk: () => saveItems(list, 'cheki'),
      extra: { label: 'オリジナルを保存', onClick: () => saveItems(list, 'original') }
    });
  }

  /* ---------- download ---------- */
  async function fetchFiles(list, ver, onProgress) {
    const out = new Array(list.length);
    let done = 0, next = 0;
    async function worker() {
      while (next < list.length) {
        const i = next++;
        const item = list[i];
        const fileId = ver === 'original' ? (item.originalId || item.id) : item.id;
        const { blob, name } = await api.getBlob(fileId);
        out[i] = new File([blob], name || `photo_${i + 1}.jpg`, { type: blob.type || 'image/jpeg' });
        onProgress(++done / list.length);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return out;
  }

  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function saveItems(list, ver) {
    openSheet({ title: '準備しています', text: `${list.length}枚の写真を読み込んでいます…`, progress: true });
    let files;
    try {
      files = await fetchFiles(list, ver, p => setProgress(p));
    } catch (e) {
      console.error(e);
      openSheet({ title: '読み込めませんでした', text: '電波の良い場所でもう一度お試しください。' });
      return;
    }

    if (isIOS && navigator.canShare && navigator.canShare({ files })) {
      // iPhone: 共有シートの「画像を保存」で写真アプリに保存
      openSheet({
        title: '準備ができました',
        text: '次の画面で「画像を保存」を選ぶと\n写真アプリに保存されます。',
        ok: '写真に保存する',
        onOk: async () => {
          try {
            await navigator.share({ files });
            closeSheet();
          } catch (e) {
            if (e.name !== 'AbortError') toast('保存できませんでした');
          }
        }
      });
      return;
    }

    if (!isMobile && files.length > 1 && window.JSZip) {
      setProgress(1);
      const zip = new JSZip();
      files.forEach(f => zip.file(f.name, f));
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadFile(new File([blob], 'wedding_photos.zip', { type: 'application/zip' }));
    } else {
      for (const f of files) {
        downloadFile(f);
        await new Promise(r => setTimeout(r, 450));
      }
    }
    closeSheet();
    toast(isMobile ? '保存しました（ダウンロードフォルダ）' : '保存しました');
    if (state.selecting) setSelecting(false);
  }

  /* ---------- sheet ---------- */
  function openSheet({ title, text, progress, ok, onOk, extra }) {
    $('sheetTitle').textContent = title || '';
    $('sheetText').textContent = text || '';
    $('sheetProgress').hidden = !progress;
    setProgress(0);
    const okBtn = $('sheetOk');
    okBtn.hidden = !ok;
    okBtn.textContent = ok || '';
    okBtn.onclick = onOk || null;
    const old = document.getElementById('sheetExtra');
    if (old) old.remove();
    if (extra) {
      const b = document.createElement('button');
      b.id = 'sheetExtra';
      b.type = 'button';
      b.className = 'btn';
      b.textContent = extra.label;
      b.onclick = extra.onClick;
      okBtn.after(b);
    }
    $('sheet').hidden = false;
  }
  function closeSheet() { $('sheet').hidden = true; }
  function setProgress(p) { $('sheetProgress').firstElementChild.style.width = Math.round(p * 100) + '%'; }
  $('sheetCancel').addEventListener('click', closeSheet);

  /* ---------- lightbox ---------- */
  function openLightbox(i) {
    if (i < 0) return;
    state.lbIndex = i;
    state.lbVer = 'cheki';
    $('lightbox').hidden = false;
    document.body.classList.add('locked');
    showLightbox();
  }
  function closeLightbox() {
    $('lightbox').hidden = true;
    document.body.classList.remove('locked');
  }
  function showLightbox() {
    const list = visibleItems();
    const item = list[state.lbIndex];
    if (!item) return closeLightbox();
    const img = $('lbImg');
    const fileId = state.lbVer === 'original' ? (item.originalId || item.id) : item.id;
    // 一覧で読み込み済みの小さい画像をすぐ出し、大きい画像が届いたら差し替える
    const tile = tiles.get(item.id);
    const tileImg = state.lbVer === 'cheki' && tile && tile.querySelector('img');
    if (tileImg && tileImg.complete && tileImg.naturalWidth) img.src = tileImg.currentSrc || tileImg.src;
    else img.removeAttribute('src');
    const big = new Image();
    big.onload = () => {
      const cur = visibleItems()[state.lbIndex];
      if (cur && cur.id === item.id && big.dataset.ver === state.lbVer) img.src = big.src;
    };
    big.dataset.ver = state.lbVer;
    setImg(big, fileId, 1600);
    preloadNeighbors();
    $('lbCaption').textContent = state.lbVer === 'original' && !item.originalId
      ? '元写真はまだ届いていません（チェキ版を表示中）'
      : item.message || '';
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.ver === state.lbVer));
    $('lbDelete').hidden = !item.mine;
    $('lbPrev').hidden = state.lbIndex <= 0;
    $('lbNext').hidden = state.lbIndex >= list.length - 1;
  }
  function preloadNeighbors() {
    const list = visibleItems();
    [state.lbIndex + 1, state.lbIndex - 1].forEach(i => {
      if (list[i]) new Image().src = api.thumbUrl(list[i].id, 1600);
    });
  }
  function stepLightbox(d) {
    const n = state.lbIndex + d;
    if (n < 0 || n >= visibleItems().length) return;
    state.lbIndex = n;
    showLightbox();
  }

  $('lbClose').addEventListener('click', closeLightbox);
  $('lbPrev').addEventListener('click', () => stepLightbox(-1));
  $('lbNext').addEventListener('click', () => stepLightbox(1));
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    state.lbVer = b.dataset.ver;
    showLightbox();
  }));
  $('lbSave').addEventListener('click', () => {
    const item = visibleItems()[state.lbIndex];
    if (item) saveItems([item], state.lbVer);
  });
  $('lbDelete').addEventListener('click', async () => {
    const item = visibleItems()[state.lbIndex];
    if (!item || !confirm('この写真をアルバムから削除しますか？')) return;
    try {
      await api.remove(item.id);
      state.items = state.items.filter(x => x.id !== item.id);
      tiles.delete(item.id);
      render();
      if (!visibleItems().length) closeLightbox();
      else { state.lbIndex = Math.min(state.lbIndex, visibleItems().length - 1); showLightbox(); }
      toast('削除しました');
    } catch (e) {
      toast('削除できませんでした');
    }
  });

  // スワイプで前後へ
  let touchX = null;
  $('lightbox').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  $('lightbox').addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
    touchX = null;
  });
  document.addEventListener('keydown', e => {
    if ($('lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });

  /* ---------- start ---------- */
  if (api.mode === 'mock') toast('お試しモード（写真はこの端末内だけに保存されます）', 4000);
  if (api.mode === 'remote') {
    state.items = loadSavedList();
    if (state.items.length) render();
  }
  refresh();
  refresh._timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, (cfg.REFRESH_SEC || 20) * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
})();
