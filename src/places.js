/*
 * Вкладка «Ресурси»: де брати ресурси, які трапляються лише в певних місцях.
 * Записи спільні — у базі даних артефакту (capability `db`, колекція places);
 * поза артефактом (сторінка з диска) — лише в цьому браузері (localStorage).
 * Поля запису: res, place, area, zone ('hagga' | 'dd'), how, ok (перевірено в грі), t (час створення).
 */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const COL = 'places', LS = 'sw:places', ZONES = { hagga: 'Хагга', dd: 'Deep Desert' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  // «Промислові помпи (Industrial Pump)» → назва і англійська назва з гри дрібно
  const twoLine = (s) => {
    const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(s || '');
    return m && m[1] ? `${esc(m[1])}<span class="r-en">${esc(m[2])}</span>` : esc(s);
  };
  const pref = {
    get(k, d) { try { const v = localStorage.getItem('sw:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sw:' + k, JSON.stringify(v)); } catch (e) { /* без збереження */ } },
  };

  const st = { rows: [], mode: 'local', ready: true, writable: true, db: null, note: '', q: '', zone: pref.get('places:zone', 'all'), edit: null };
  const subs = [];
  const changed = () => { render(); for (const f of subs) f(); };

  // ---------- сховище ----------
  function loadLocal() {
    try { st.rows = JSON.parse(localStorage.getItem(LS)) || []; } catch (e) { st.rows = []; }
  }
  function saveLocal() {
    try { localStorage.setItem(LS, JSON.stringify(st.rows)); } catch (e) { st.note = 'Браузер не дає зберегти записи.'; }
  }
  async function connect() {
    const c = root.claude;
    if (!c || typeof c.use !== 'function') return;
    st.mode = 'db'; st.ready = false; st.rows = []; changed();
    let db = null;
    try { db = await c.use('db'); } catch (e) { db = null; }
    if (!db) { st.mode = 'local'; st.ready = true; loadLocal(); changed(); return; }
    st.db = db;
    try {
      const u = await c.use('user');
      if (u && (await u.can('data.write')) === false) st.writable = false;
    } catch (e) { /* невідомо — вирішить перший запис */ }
    db.collection(COL).onSnapshot((snap) => {
      st.rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      st.ready = true;
      changed();
    }, () => {
      st.ready = true;
      st.note = 'Спільні записи зараз недоступні — онови сторінку.';
      changed();
    });
  }
  // один запис за дію; помилки бази — у підказку під таблицею
  async function write(fn) {
    try { await fn(); st.note = ''; }
    catch (e) {
      const code = e && e.code;
      if (code === 'unavailable') {
        await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
        try { await fn(); st.note = ''; changed(); return true; } catch (e2) { /* нижче */ }
      }
      if (code === 'invalid_argument') st.writable = false;
      st.note = code === 'invalid_argument' ? 'Немає права змінювати записи — лише перегляд.'
        : code === 'quota_exceeded' ? 'Сховище записів заповнене — видали зайве.'
        : 'Не вдалося зберегти — спробуй ще раз.';
      changed();
      return false;
    }
    changed();
    return true;
  }
  function add(rec) {
    if (st.mode === 'db') return write(() => st.db.collection(COL).add(rec));
    st.rows.push({ id: 'l' + Date.now().toString(36), ...rec }); saveLocal(); changed(); return Promise.resolve(true);
  }
  function update(id, patch) {
    if (st.mode === 'db') return write(() => st.db.doc(COL + '/' + id).update(patch));
    const r = st.rows.find((x) => x.id === id); if (r) Object.assign(r, patch);
    saveLocal(); changed(); return Promise.resolve(true);
  }
  function remove(id) {
    if (st.mode === 'db') return write(() => st.db.doc(COL + '/' + id).delete());
    st.rows = st.rows.filter((x) => x.id !== id); saveLocal(); changed(); return Promise.resolve(true);
  }

  // ---------- вигляд ----------
  const canWrite = () => st.ready && st.writable;
  function visible() {
    const q = st.q.trim().toLowerCase();
    return st.rows
      .filter((r) => st.zone === 'all' || (r.zone || 'hagga') === st.zone)
      .filter((r) => !q || [r.res, r.place, r.area, r.how].some((x) => String(x || '').toLowerCase().includes(q)))
      .sort((a, b) => (a.zone === b.zone ? String(a.res).localeCompare(String(b.res), 'uk') : (a.zone === 'dd' ? 1 : -1)));
  }
  function render() {
    const box = $('res-table');
    if (!box) return;
    const rows = visible();
    let html = '<thead><tr><th>Ресурс</th><th>Де</th><th>Як дістати</th><th class="r-ok-h">Перевірено</th><th><span class="sr">Дії</span></th></tr></thead><tbody>';
    let zone = null;
    for (const r of rows) {
      const z = r.zone || 'hagga';
      if (z !== zone) { zone = z; html += `<tr class="zone"><td colspan="5">${ZONES[z] || esc(z)}</td></tr>`; }
      html += `<tr data-id="${esc(r.id)}"${st.edit === r.id ? ' class="editing"' : ''}>`
        + `<td class="r-res">${twoLine(r.res)}</td>`
        + `<td class="r-place">${twoLine(r.place)}${r.area ? `<span class="r-area">${esc(r.area)}</span>` : ''}</td>`
        + `<td class="r-how">${esc(r.how)}</td>`
        + `<td class="r-ok"><label class="chk"><input type="checkbox" data-ok="${esc(r.id)}"${r.ok ? ' checked' : ''}${canWrite() ? '' : ' disabled'}><span>перевірено</span></label></td>`
        + `<td class="r-act">${canWrite() ? `<button type="button" class="linkbtn" data-edit="${esc(r.id)}">Змінити</button> <button type="button" class="linkbtn" data-del="${esc(r.id)}">Видалити</button>` : ''}</td></tr>`;
    }
    box.innerHTML = html + '</tbody>';
    $('res-empty').hidden = !st.ready || rows.length > 0;
    $('res-empty').textContent = st.rows.length ? 'Нічого не знайдено — зміни пошук або регіон.' : 'Записів ще немає — додай перший нижче.';
    $('res-loading').hidden = st.ready;
    $('res-store').textContent = st.mode === 'db' ? (st.writable ? 'Записи спільні: їх бачать і правлять усі, з ким поділено сторінку' : 'Лише перегляд')
      : 'Записи зберігаються тільки в цьому браузері';
    $('res-note').textContent = st.note;
    $('res-note').hidden = !st.note;
    $('res-form').hidden = !canWrite();
    $('res-add').hidden = !canWrite();
    for (const b of document.querySelectorAll('#res-zone button')) b.setAttribute('aria-pressed', String(b.dataset.zone === st.zone));
    $('res-areas').innerHTML = [...new Set(st.rows.map((r) => r.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk')).map((a) => `<option value="${esc(a)}"></option>`).join('');
    for (const el of box.querySelectorAll('[data-ok]')) el.addEventListener('change', () => update(el.dataset.ok, { ok: el.checked }));
    for (const el of box.querySelectorAll('[data-edit]')) el.addEventListener('click', () => startEdit(el.dataset.edit));
    for (const el of box.querySelectorAll('[data-del]')) el.addEventListener('click', () => {
      const r = st.rows.find((x) => x.id === el.dataset.del);
      if (r && confirm(`Видалити запис «${r.res}» — ${r.place}?`)) { if (st.edit === r.id) stopEdit(); remove(r.id); }
    });
  }

  // ---------- форма: додати або змінити ----------
  const F = ['res', 'place', 'area', 'zone', 'how'];
  function startEdit(id) {
    const r = st.rows.find((x) => x.id === id);
    if (!r) return;
    st.edit = id;
    for (const k of F) $('rf-' + k).value = r[k] || (k === 'zone' ? 'hagga' : '');
    $('rf-title').textContent = 'Змінити запис';
    $('rf-submit').textContent = 'Зберегти';
    $('rf-cancel').hidden = false;
    render();
    $('res-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('rf-res').focus({ preventScroll: true });
  }
  function stopEdit() {
    st.edit = null;
    $('res-form').reset();
    $('rf-title').textContent = 'Додати запис';
    $('rf-submit').textContent = 'Додати';
    $('rf-cancel').hidden = true;
    render();
  }
  async function submit(e) {
    e.preventDefault();
    const rec = {};
    for (const k of F) rec[k] = $('rf-' + k).value.trim();
    if (!rec.res || !rec.place) return;
    const btn = $('rf-submit');
    btn.disabled = true;
    const ok = st.edit ? await update(st.edit, rec) : await add({ ...rec, ok: false, t: Date.now() });
    btn.disabled = false;
    if (ok) stopEdit();
  }

  // ---------- шапка вкладки ----------
  function facts() {
    const n = st.rows.length, dd = st.rows.filter((r) => r.zone === 'dd').length, ok = st.rows.filter((r) => r.ok).length;
    return [`<b>${fmtN(n)}</b> записів`, `<b>${fmtN(n - dd)}</b> у Хагга`, `<b>${fmtN(dd)}</b> у Deep Desert`, `<b>${fmtN(ok)}</b> перевірено`];
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    $('res-q').addEventListener('input', (e) => { st.q = e.target.value; render(); });
    for (const b of document.querySelectorAll('#res-zone button'))
      b.addEventListener('click', () => { st.zone = b.dataset.zone; pref.set('places:zone', st.zone); render(); });
    $('res-form').addEventListener('submit', submit);
    $('rf-cancel').addEventListener('click', stopEdit);
    $('res-add').addEventListener('click', () => { if (st.edit) stopEdit(); $('res-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('rf-res').focus({ preventScroll: true }); });
    loadLocal();
    changed();
    connect();
  }

  root.PLACES = { start, facts, onChange: (f) => subs.push(f) };
})(typeof window !== 'undefined' ? window : globalThis);
