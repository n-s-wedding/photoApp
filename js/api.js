// Google Apps Script との通信（GAS_URL 未設定時はお試しモード）
(function () {
  const cfg = window.APP_CONFIG;

  function getToken() {
    const k = new URLSearchParams(location.search).get('k');
    try {
      if (k) localStorage.setItem('wps_token', k);
      return k || localStorage.getItem('wps_token') || '';
    } catch (e) {
      return k || '';
    }
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem('wps_device');
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        localStorage.setItem('wps_device', id);
      }
      return id;
    } catch (e) {
      return 'anon';
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type });
  }

  const token = getToken();
  const deviceId = getDeviceId();

  async function call(action, payload) {
    const res = await fetch(cfg.GAS_URL, {
      method: 'POST',
      // text/plain にすることで CORS のプリフライトを回避
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, token, deviceId }, payload || {}))
    });
    if (!res.ok) throw new Error('通信エラー (' + res.status + ')');
    const json = await res.json();
    if (!json.ok) {
      const err = new Error(json.error || 'error');
      err.code = json.error;
      throw err;
    }
    return json;
  }

  /* ---------- 本番（GAS） ---------- */
  const remote = {
    mode: 'remote',
    async list() {
      return (await call('list')).items;
    },
    async upload({ processed, original, author, w, h }) {
      const [p, o] = await Promise.all([blobToBase64(processed), blobToBase64(original)]);
      const res = await call('upload', {
        processed: p,
        original: o,
        originalMime: original.type || 'image/jpeg',
        author, w, h
      });
      return res.item;
    },
    async getBlob(fileId) {
      const res = await call('get', { id: fileId });
      return { blob: base64ToBlob(res.data, res.mimeType), name: res.name };
    },
    async remove(id) {
      await call('delete', { id });
    },
    thumbUrl(fileId, size) {
      return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w' + (size || 800);
    },
    altThumbUrl(fileId, size) {
      return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(fileId) + '=w' + (size || 800);
    }
  };

  /* ---------- お試しモード（端末内のみ） ---------- */
  const store = new Map();
  let seq = 0;
  const mock = {
    mode: 'mock',
    async list() {
      return [...store.values()].filter(x => x.item).map(x => x.item).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    },
    async upload({ processed, original, author, w, h }) {
      await new Promise(r => setTimeout(r, 400));
      const id = 'mock' + (++seq);
      const originalId = id + '_o';
      const item = { id, originalId, author, w, h, uploadedAt: new Date().toISOString(), mine: true };
      store.set(id, { item, blob: processed });
      store.set(originalId, { blob: original });
      return item;
    },
    async getBlob(fileId) {
      const x = store.get(fileId);
      const ext = fileId.endsWith('_o') ? 'original.jpg' : 'cheki.jpg';
      return { blob: x.blob, name: fileId + '_' + ext };
    },
    async remove(id) {
      const x = store.get(id);
      if (x) store.delete(x.item.originalId);
      store.delete(id);
    },
    thumbUrl(fileId) {
      const x = store.get(fileId);
      if (!x) return '';
      if (!x.url) x.url = URL.createObjectURL(x.blob);
      return x.url;
    },
    altThumbUrl(fileId) {
      return mock.thumbUrl(fileId);
    }
  };

  window.PhotoApi = Object.assign(cfg.GAS_URL ? remote : mock, {
    hasToken: !!token || !cfg.GAS_URL,
    ping: () => (cfg.GAS_URL ? call('ping') : Promise.resolve({ ok: true }))
  });
})();
