(() => {
  'use strict';

  const MB = 1024 * 1024;
  const RATIOS = { free: null, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9 };
  const $ = (s) => document.querySelector(s);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const items = [];
  let uid = 0;
  let ed = null;
  let drag = null;
  let busy = false;
  let pending = null;   // 預覽中、尚未確認的動作：{ label, snaps: Map<item, 原狀態> }
  let progress = '';    // 處理進度文字
  const locked = () => busy || !!pending;

  function loadSettings() {
    const d = { target: 1.5, format: 'image/jpeg' };
    try { return Object.assign({}, d, JSON.parse(localStorage.getItem('imgtool-settings') || '{}')); }
    catch (e) { return d; }
  }
  const settings = loadSettings();
  function saveSettings() {
    try { localStorage.setItem('imgtool-settings', JSON.stringify(settings)); } catch (e) {}
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    $('#toasts').appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2600);
  }

  const fmtSize = (b) => (b >= MB ? (b / MB).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB');

  function setMenu(open) { $('#drawer').hidden = !open; }

  function syncSheet() {
    $('#targetRange').value = settings.target;
    $('#targetVal').textContent = settings.target.toFixed(1) + ' MB';
    $('#fmtSelect').value = settings.format;
  }
  function openSheet(open) {
    $('#sheet').hidden = !open;
    if (open) syncSheet();
  }

  function download(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function outName(it) {
    if (it.result === it.file) return it.file.name;
    const base = it.file.name.replace(/\.[^.]+$/, '');
    const ext = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }[it.result.type] || 'jpg';
    return base + '_small.' + ext;
  }

  const isHeic = (f) => /^image\/heic|^image\/heif/.test(f.type) || /\.(heic|heif)$/i.test(f.name);
  const isImage = (f) => f.type.startsWith('image/') || isHeic(f);

  async function prepareFile(file) {
    if (!isHeic(file)) return file;
    if (typeof heic2any === 'undefined') throw new Error('HEIC converter not loaded');
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(out) ? out[0] : out;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }

  async function addFiles(list) {
    const files = [...list].filter(isImage);
    if (!files.length) return toast('沒有找到圖片檔');
    const heicCount = files.filter(isHeic).length;
    if (heicCount) toast('正在轉換 ' + heicCount + ' 張 HEIC 圖片…');
    let added = 0;
    for (const raw of files) {
      try {
        const file = await prepareFile(raw);
        items.push({
          id: ++uid, file, url: URL.createObjectURL(file),
          rot: 0, fh: false, fv: false, crop: null, bitmap: null, small: null, thumb: null,
          sel: false, result: null, status: '待處理',
        });
        added++;
      } catch (err) {
        console.error(err);
        toast('無法讀取：' + raw.name);
      }
      renderGrid();
    }
    if (added) toast('已加入 ' + added + ' 張圖片');
  }

  function removeItem(id) {
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return;
    const it = items.splice(i, 1)[0];
    if (ed && ed.it === it) closeEditor();
    freeItem(it);
    renderGrid();
  }

  function freeItem(it) {
    URL.revokeObjectURL(it.url);
    if (it.bitmap && it.bitmap.close) it.bitmap.close();
    it.bitmap = null;
    it.small = null;
  }

  async function clearAll() {
    setMenu(false);
    if (!items.length || guardLocked()) return;
    if (!await askConfirm('清除全部圖片', '將移除全部 ' + items.length + ' 張圖片，此動作無法復原。', '清除', true)) return;
    if (ed) closeEditor();
    items.forEach(freeItem);
    items.length = 0;
    setMenu(false);
    renderGrid();
  }

  function makeBtn(label, onClick, disabled, extra) {
    const b = document.createElement('button');
    b.className = 'btn sm ' + (extra || '');
    b.textContent = label;
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderGrid() {
    const g = $('#grid');
    g.innerHTML = '';
    $('#countLabel').textContent = items.length + ' 張';
    $('#dropzone').hidden = items.length > 0;
    syncBulkbar();

    for (const it of items) {
      const card = document.createElement('div');
      const isPend = !!(pending && pending.snaps.has(it));
      card.className = 'card' + (it.sel ? ' sel' : '') + (isPend ? ' pend' : '') + (locked() ? ' locked' : '');

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.title = locked() ? '' : '點縮圖可勾選／取消';
      thumb.addEventListener('click', () => { if (!locked()) toggleSel(it); });
      const img = document.createElement('img');
      img.src = it.thumb || it.url;
      img.alt = '';

      const pick = document.createElement('label');
      pick.className = 'pick';
      pick.addEventListener('click', (e) => e.stopPropagation());
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = it.sel;
      cb.disabled = locked();
      cb.setAttribute('aria-label', '勾選 ' + it.file.name);
      cb.addEventListener('change', () => toggleSel(it, cb.checked));
      pick.appendChild(cb);

      const tt = document.createElement('div');
      tt.className = 'thumb-tools';
      tt.addEventListener('click', (e) => e.stopPropagation());
      [['↺', 'rotL', '左旋'], ['↻', 'rotR', '右旋'], ['⇋', 'flipH', '水平翻轉']].forEach(([t, op, label]) => {
        const b = document.createElement('button');
        b.textContent = t;
        b.title = label;
        b.setAttribute('aria-label', label);
        b.disabled = locked();
        b.addEventListener('click', () => applyOp([it], op));
        tt.appendChild(b);
      });

      thumb.append(img, pick, tt);
      const tag = (isPend ? '預覽 ' : '') + transformLabel(it);
      if (tag) {
        const bd = document.createElement('span');
        bd.className = 'badge';
        bd.textContent = tag;
        thumb.appendChild(bd);
      }

      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('b');
      name.textContent = it.file.name;
      const info = document.createElement('small');
      info.textContent = fmtSize(it.file.size) + (it.result ? ' → ' + fmtSize(it.result.size) : '') + ' · ' + it.status;
      meta.append(name, info);

      const acts = document.createElement('div');
      acts.className = 'card-actions';
      acts.append(
        makeBtn('編輯', () => openEditor(it.id), locked()),
        makeBtn('壓縮', () => runOne(it), locked()),
        makeBtn('下載', () => download(it.result, outName(it)), !it.result || locked()),
        makeBtn('✕', () => confirmRemove([it]), locked(), 'danger')
      );

      card.append(thumb, meta, acts);
      g.appendChild(card);
    }
  }

  async function loadBitmap(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { return await createImageBitmap(file); }
  }

  async function getBitmap(it) {
    if (!it.bitmap) it.bitmap = await loadBitmap(it.file);
    return it.bitmap;
  }

  // 轉換順序：先旋轉 rot，再於「畫面方向」做水平 fh／垂直 fv 翻轉，最後裁切
  function drawTransformed(src, t) {
    const rot = t.rot || 0;
    const swap = rot % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = swap ? src.height : src.width;
    c.height = swap ? src.width : src.height;
    const x = c.getContext('2d');
    x.translate(c.width / 2, c.height / 2);
    x.scale(t.fh ? -1 : 1, t.fv ? -1 : 1);
    x.rotate((rot * Math.PI) / 180);
    x.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  // 對 t（{rot,fh,fv,crop}）套用一個操作；裁切框跟著一起轉，不會被清掉
  function transformState(t, op) {
    const c = t.crop;
    if (op === 'rotR' || op === 'rotL') {
      const d = op === 'rotR' ? 90 : -90;
      t.rot = (t.rot + d + 360) % 360;
      const f = t.fh; t.fh = t.fv; t.fv = f;
      if (c) {
        t.crop = d > 0
          ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w }
          : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w };
      }
    } else if (op === 'flipH') {
      t.fh = !t.fh;
      if (c) t.crop = Object.assign({}, c, { x: 1 - (c.x + c.w) });
    } else if (op === 'flipV') {
      t.fv = !t.fv;
      if (c) t.crop = Object.assign({}, c, { y: 1 - (c.y + c.h) });
    } else if (op === 'reset') {
      t.rot = 0; t.fh = false; t.fv = false; t.crop = null;
    }
  }

  // 正規化：水平+垂直翻轉 = 旋轉 180°
  function normalize(t) {
    if (t.fh && t.fv) { t.fh = false; t.fv = false; t.rot = (t.rot + 180) % 360; }
  }

  const isEdited = (it) => it.rot !== 0 || it.fh || it.fv || !!it.crop;

  function transformLabel(it) {
    const p = [];
    if (it.rot) p.push(it.rot + '°');
    if (it.fh) p.push('⇋');
    if (it.fv) p.push('⇅');
    if (it.crop) p.push('裁');
    return p.join(' ');
  }

  function cropCanvas(c, crop) {
    if (!crop) return c;
    const sx = Math.round(crop.x * c.width);
    const sy = Math.round(crop.y * c.height);
    const sw = Math.max(1, Math.round(crop.w * c.width));
    const sh = Math.max(1, Math.round(crop.h * c.height));
    const o = document.createElement('canvas');
    o.width = sw;
    o.height = sh;
    o.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
    return o;
  }

  function scaleCanvas(c, s) {
    const o = document.createElement('canvas');
    o.width = Math.max(1, Math.round(c.width * s));
    o.height = Math.max(1, Math.round(c.height * s));
    const x = o.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, o.width, o.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, o.width, o.height);
    return o;
  }

  const encode = (c, mime, q) => new Promise((resolve) => c.toBlob(resolve, mime, q));

  async function compressTo(canvas, target, mime) {
    let src = canvas;
    for (let pass = 0; pass < 6; pass++) {
      const top = await encode(src, mime, 0.95);
      if (top.size <= target) return top;

      let lo = 0.2;
      let hi = 0.95;
      const bottom = await encode(src, mime, lo);
      if (bottom.size <= target) {
        let found = bottom;
        for (let i = 0; i < 7; i++) {
          const m = (lo + hi) / 2;
          const b = await encode(src, mime, m);
          if (b.size <= target) { found = b; lo = m; } else { hi = m; }
        }
        return found;
      }
      src = scaleCanvas(src, 0.8);
    }
    return encode(src, mime, 0.2);
  }

  async function processItem(it) {
    const target = settings.target * MB;
    const edited = isEdited(it);
    if (!edited && it.file.size <= target) {
      it.result = it.file;
      it.status = '已小於目標，保留原檔';
      return;
    }
    const bmp = await getBitmap(it);
    const canvas = cropCanvas(drawTransformed(bmp, it), it.crop);
    it.result = await compressTo(canvas, target, settings.format);
    it.status = '完成';
  }

  async function runOne(it) {
    if (guardLocked()) return;
    busy = true;
    it.status = '處理中…';
    renderGrid();
    try {
      await processItem(it);
      toast(it.file.name + ' 完成');
    } catch (err) {
      console.error(err);
      it.status = '失敗';
      toast('處理失敗：' + it.file.name);
    }
    busy = false;
    renderGrid();
  }

  async function batchProcess() {
    if (!items.length) return toast('請先加入圖片');
    setMenu(false);
    if (guardLocked()) return;
    if (!await askConfirm('全部壓縮', '共 ' + items.length + ' 張，每張不超過 ' + settings.target.toFixed(1) + ' MB', '開始壓縮')) return;
    openSheet(false);
    await processList(items.slice());
    toast('批次處理完成');
  }

  async function downloadZip() {
    const done = items.filter((i) => i.result);
    setMenu(false);
    if (!done.length) return toast('請先執行壓縮');
    if (typeof JSZip === 'undefined') return toast('ZIP 元件載入失敗，請檢查網路');
    const zip = new JSZip();
    const used = new Set();
    for (const it of done) {
      let n = outName(it);
      while (used.has(n)) n = '_' + n;
      used.add(n);
      zip.file(n, it.result);
    }
    download(await zip.generateAsync({ type: 'blob' }), 'compressed_images.zip');
  }

  // ---------- 即時縮圖 ----------
  async function getSmall(it) {
    if (it.small) return it.small;
    const own = !it.bitmap;
    const bmp = await getBitmap(it);
    const s = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    it.small = scaleCanvas(bmp, s);
    if (own && it.bitmap && it.bitmap.close) { it.bitmap.close(); it.bitmap = null; } // 省記憶體
    return it.small;
  }

  async function refreshThumb(it) {
    if (!isEdited(it)) { it.thumb = null; return; }
    const sm = await getSmall(it);
    it.thumb = cropCanvas(drawTransformed(sm, it), it.crop).toDataURL('image/jpeg', 0.85);
  }

  // ---------- 勾選 ----------
  const selected = () => items.filter((i) => i.sel);

  function toggleSel(it, v) {
    it.sel = v === undefined ? !it.sel : v;
    renderGrid();
  }

  function selectAll(v) {
    items.forEach((i) => { i.sel = v; });
    renderGrid();
  }

  function syncBulkbar() {
    const bar = $('#bulkbar');
    bar.hidden = items.length === 0;
    const n = selected().length;
    const all = $('#selAll');
    all.checked = n > 0 && n === items.length;
    all.indeterminate = n > 0 && n < items.length;
    all.disabled = locked();
    $('#selLabel').textContent = progress || (n ? '已選 ' + n + ' / ' + items.length : '全選');
    bar.querySelectorAll('[data-op]').forEach((b) => { b.disabled = n === 0 || locked(); });

    const pb = $('#pendbar');
    pb.hidden = !pending;
    if (pending) {
      $('#pendText').textContent = '預覽中：' + pending.label + '，請確認後才能進行下一個動作';
      pb.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
    }
  }

  function guardLocked() {
    if (pending) { toast('請先「確認套用」或「取消還原」目前的預覽'); return true; }
    if (busy) { toast('處理中，請稍候'); return true; }
    return false;
  }

  // ---------- 確認視窗 ----------
  function askConfirm(title, body, okLabel, danger) {
    return new Promise((resolve) => {
      const m = $('#modal');
      const ok = $('#mOk');
      const cancel = $('#mCancel');
      $('#mTitle').textContent = title;
      $('#mBody').textContent = body;
      ok.textContent = okLabel || '確定';
      ok.className = 'btn ' + (danger ? 'danger' : 'primary');
      m.hidden = false;
      ok.focus();
      const done = (v) => {
        m.hidden = true;
        ok.onclick = cancel.onclick = m.querySelector('.modal-backdrop').onclick = null;
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); }
        else if (e.key === 'Enter') { e.preventDefault(); done(true); }
      };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      m.querySelector('.modal-backdrop').onclick = () => done(false);
      document.addEventListener('keydown', onKey, true);
    });
  }

  // ---------- 預覽 → 確認／取消 ----------
  const SNAP_KEYS = ['rot', 'fh', 'fv', 'crop', 'thumb', 'result', 'status'];
  const OP_NAMES = { rotL: '左旋 90°', rotR: '右旋 90°', flipH: '水平翻轉', flipV: '垂直翻轉', reset: '還原原圖' };

  function confirmPending() {
    if (!pending || busy) return;
    for (const it of pending.snaps.keys()) {
      it.result = null;
      it.status = isEdited(it) ? '已編輯，待壓縮' : '待處理';
    }
    toast('已套用：' + pending.label);
    pending = null;
    renderGrid();
  }

  function cancelPending() {
    if (!pending || busy) return;
    for (const [it, snap] of pending.snaps) Object.assign(it, snap);
    toast('已取消，恢復原狀');
    pending = null;
    renderGrid();
  }

  async function confirmRemove(list) {
    if (guardLocked()) return;
    const body = list.length === 1 ? '將移除「' + list[0].file.name + '」。' : '將移除勾選的 ' + list.length + ' 張圖片。';
    if (!await askConfirm('移除圖片', body, '移除', true)) return;
    if (ed && list.includes(ed.it)) closeEditor();
    list.forEach((it) => { const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); freeItem(it); });
    toast('已移除 ' + list.length + ' 張');
    renderGrid();
  }

  // ---------- 單張／批次操作 ----------
  // 套用轉換只產生「預覽」，要按「確認套用」才算數，「取消還原」會回到原狀
  async function applyOp(list, op) {
    if (guardLocked()) return;
    const snaps = new Map();
    for (const it of list) {
      const snap = {};
      SNAP_KEYS.forEach((k) => { snap[k] = it[k] && typeof it[k] === 'object' && !(it[k] instanceof Blob) ? Object.assign({}, it[k]) : it[k]; });
      snaps.set(it, snap);
      transformState(it, op);
      normalize(it);
      it.status = '預覽中，待確認';
    }
    pending = { label: (list.length > 1 ? list.length + ' 張' : '「' + list[0].file.name + '」') + OP_NAMES[op], snaps };
    busy = true;
    let i = 0;
    try {
      for (const it of list) {
        progress = '產生預覽 ' + (++i) + ' / ' + list.length;
        await refreshThumb(it);
        if (i % 4 === 0 || i === list.length) renderGrid();
      }
    } catch (err) {
      console.error(err);
      toast('縮圖更新失敗');
    }
    progress = '';
    busy = false;
    renderGrid();
  }

  async function processList(list) {
    busy = true;
    let i = 0;
    for (const it of list) {
      progress = '壓縮中 ' + (++i) + ' / ' + list.length;
      it.status = '處理中…';
      renderGrid();
      try { await processItem(it); }
      catch (err) { console.error(err); it.status = '失敗'; }
      renderGrid();
    }
    progress = '';
    busy = false;
    renderGrid();
  }

  async function downloadList(list, zipName) {
    const todo = list.filter((i) => !i.result);
    if (todo.length) {
      toast('先壓縮 ' + todo.length + ' 張未處理的圖片…');
      await processList(todo);
    }
    const done = list.filter((i) => i.result);
    if (!done.length) return toast('沒有可下載的圖片');
    if (done.length === 1) return download(done[0].result, outName(done[0]));
    if (typeof JSZip === 'undefined') return toast('ZIP 元件載入失敗，請檢查網路');
    const zip = new JSZip();
    const used = new Set();
    for (const it of done) {
      let n = outName(it);
      while (used.has(n)) n = '_' + n;
      used.add(n);
      zip.file(n, it.result);
    }
    download(await zip.generateAsync({ type: 'blob' }), zipName);
    toast('已下載 ' + done.length + ' 張（ZIP）');
  }

  async function bulk(op) {
    const list = selected();
    if (!list.length) return toast('請先勾選圖片');
    if (guardLocked()) return;
    const fmtName = { 'image/jpeg': 'JPG', 'image/webp': 'WebP', 'image/png': 'PNG' }[settings.format];
    if (OP_NAMES[op]) {
      await applyOp(list, op);
    } else if (op === 'compress') {
      const ok = await askConfirm('壓縮勾選的圖片',
        '共 ' + list.length + ' 張\n每張不超過 ' + settings.target.toFixed(1) + ' MB，輸出 ' + fmtName, '開始壓縮');
      if (!ok) return;
      await processList(list);
      toast(list.length + ' 張壓縮完成');
    } else if (op === 'download') {
      const todo = list.filter((i) => !i.result).length;
      const ok = await askConfirm('下載勾選的圖片',
        '共 ' + list.length + ' 張' + (list.length > 1 ? '，打包成一個 ZIP' : '') +
        (todo ? '\n其中 ' + todo + ' 張尚未壓縮，會先自動壓縮' : ''), '下載');
      if (!ok) return;
      await downloadList(list, 'selected_images.zip');
    } else if (op === 'remove') {
      await confirmRemove(list);
    }
  }

  function getCrop() {
    return ed.crop || { x: 0, y: 0, w: 1, h: 1 };
  }

  function drawCropBox() {
    const c = getCrop();
    const box = $('#cropBox');
    box.style.left = c.x * 100 + '%';
    box.style.top = c.y * 100 + '%';
    box.style.width = c.w * 100 + '%';
    box.style.height = c.h * 100 + '%';
  }

  function drawEditor() {
    const full = drawTransformed(ed.bmp, ed);
    const s = Math.min(1, 1600 / Math.max(full.width, full.height));
    ed.preview = scaleCanvas(full, s);
    const cv = $('#prevCanvas');
    cv.width = ed.preview.width;
    cv.height = ed.preview.height;
    cv.getContext('2d').drawImage(ed.preview, 0, 0);
    drawCropBox();
  }

  async function openEditor(id) {
    const it = items.find((x) => x.id === id);
    if (!it || guardLocked()) return;
    ed = { it, rot: it.rot, fh: it.fh, fv: it.fv, crop: it.crop ? Object.assign({}, it.crop) : null, bmp: null, preview: null };
    $('#editorName').textContent = it.file.name;
    $('#ratio').value = 'free';
    $('#editor').hidden = false;
    try {
      ed.bmp = await getBitmap(it);
    } catch (err) {
      console.error(err);
      toast('無法開啟這張圖片');
      closeEditor();
      return;
    }
    drawEditor();
  }

  function closeEditor() {
    ed = null;
    drag = null;
    $('#editor').hidden = true;
    renderGrid();
  }

  function editorOp(op) {
    if (!ed || !ed.bmp) return;
    transformState(ed, op);
    normalize(ed);
    drawEditor();
    presetRatio();
  }

  function presetRatio() {
    if (!ed) return;
    const a = RATIOS[$('#ratio').value];
    if (!a) return;
    const c = getCrop();
    const pW = ed.preview.width;
    const pH = ed.preview.height;
    let w = 1;
    let h = (w * pW) / (a * pH);
    if (h > 1) { h = 1; w = (h * a * pH) / pW; }
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    ed.crop = { w: w, h: h, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) };
    drawCropBox();
  }

  function saveEdit() {
    if (!ed) return;
    const c = ed.crop;
    const full = !c || (c.w > 0.995 && c.h > 0.995);
    const it = ed.it;
    it.rot = ed.rot;
    it.fh = ed.fh;
    it.fv = ed.fv;
    it.crop = full ? null : Object.assign({}, c);
    it.result = null;
    it.status = isEdited(it) ? '已編輯，待壓縮' : '待處理';
    toast('已套用編輯');
    closeEditor();
    refreshThumb(it).then(renderGrid).catch(console.error);
  }

  const box = $('#cropBox');
  box.addEventListener('pointerdown', (e) => {
    if (!ed) return;
    e.preventDefault();
    drag = { mode: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, start: Object.assign({}, getCrop()) };
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || !ed) return;
    const r = $('#prevCanvas').getBoundingClientRect();
    const dx = (e.clientX - drag.sx) / r.width;
    const dy = (e.clientY - drag.sy) / r.height;
    const s = drag.start;
    let x = s.x, y = s.y, w = s.w, h = s.h;
    if (drag.mode === 'move') {
      x = clamp(s.x + dx, 0, 1 - s.w);
      y = clamp(s.y + dy, 0, 1 - s.h);
    } else {
      const MIN = 0.05;
      if (drag.mode.indexOf('e') >= 0) w = clamp(s.w + dx, MIN, 1 - s.x);
      if (drag.mode.indexOf('w') >= 0) { w = clamp(s.w - dx, MIN, s.x + s.w); x = s.x + s.w - w; }
      if (drag.mode.indexOf('s') >= 0) h = clamp(s.h + dy, MIN, 1 - s.y);
      if (drag.mode.indexOf('n') >= 0) { h = clamp(s.h - dy, MIN, s.y + s.h); y = s.y + s.h - h; }
    }
    ed.crop = { x: x, y: y, w: w, h: h };
    drawCropBox();
  });
  const endDrag = () => { drag = null; };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  $('#menuBtn').addEventListener('click', () => setMenu(true));
  $('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#folderInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#ratio').addEventListener('change', presetRatio);
  $('#selAll').addEventListener('change', (e) => selectAll(e.target.checked));

  $('#targetRange').addEventListener('input', (e) => {
    settings.target = Number(e.target.value);
    $('#targetVal').textContent = settings.target.toFixed(1) + ' MB';
    saveSettings();
  });
  $('#fmtSelect').addEventListener('change', (e) => {
    settings.format = e.target.value;
    saveSettings();
  });

  const dz = $('#dropzone');
  dz.addEventListener('click', () => $('#fileInput').click());
  dz.addEventListener('dragenter', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragover', (e) => e.preventDefault());
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const map = {
      pickFiles: () => { setMenu(false); $('#fileInput').click(); },
      pickFolder: () => { setMenu(false); $('#folderInput').click(); },
      openSettings: () => { setMenu(false); openSheet(true); },
      closeSheet: () => openSheet(false),
      closeMenu: () => setMenu(false),
      clearAll: () => clearAll(),
      batch: () => batchProcess(),
      zip: () => downloadZip(),
      closeEditor: () => closeEditor(),
      saveEdit: () => saveEdit(),
      rotate: () => editorOp(Number(el.dataset.dir) > 0 ? 'rotR' : 'rotL'),
      flip: () => editorOp(el.dataset.axis === 'h' ? 'flipH' : 'flipV'),
      bulk: () => bulk(el.dataset.op),
      pendOk: () => confirmPending(),
      pendCancel: () => cancelPending(),
      resetCrop: () => { if (ed) { ed.crop = null; $('#ratio').value = 'free'; drawCropBox(); } },
    };
    if (map[el.dataset.action]) map[el.dataset.action]();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ed) closeEditor();
    else if (pending) cancelPending();
    else if (!$('#sheet').hidden) openSheet(false);
    else setMenu(false);
  });

  renderGrid();
  syncSheet();
})();
