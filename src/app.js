/* Інтерфейс сторінки: дві бази на вкладках, план, 3D, приміщення, ліміти, етапи й кошторис. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const BASES = window.BASES;
  const ORDER = Object.keys(BASES);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('sw:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sw:' + k, JSON.stringify(v)); } catch (e) { /* без збереження */ } },
  };
  const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fmtP = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
  const press = (ids, active) => { for (const id of ids) if ($(id)) $(id).setAttribute('aria-pressed', String(id === active)); };
  const listed = (r) => r.group !== 'crown';
  const LIM_DEF = { found: 4, decor: 10 };

  // ---------- база: модель, план, підрахунки і 3D для кожної — один раз ----------
  const ctx = {};
  function context(id) {
    if (ctx[id]) return ctx[id];
    const M = BASES[id], UI = M.ui;
    const { G, CAR, TOP } = M.heights;
    const B = window.BUILD.make(M);
    let level = store.get(id + ':level', 'g');
    if (!M.levels.some((l) => l.key === level)) level = 'g';
    return (ctx[id] = {
      id, M, UI, B, P: window.PLAN2D.make(M), res: B.compute(),
      levelOf: (r) => (r.z0 < G ? 'g' : r.z0 < CAR ? 'u' : r.z0 < TOP ? 't' : 'r'),
      cuts: { ...UI.cuts, 'cut-all': [UI.all, 0] },
      lim: Object.assign({}, LIM_DEF, store.get(id + ':limit', {})),
      level, cut: UI.all, view: null, box: null,
    });
  }
  let C = null;

  const state = {
    tab: store.get('tab', 'plan'),
    items: true,
    labels: true,
    coords: store.get('coords', false),
    highlight: null,
  };

  // ---------- план ----------
  function renderPlan() {
    $('plan').innerHTML = C.P.render({ level: C.level, items: state.items, labels: state.labels, coords: state.coords, highlight: state.highlight });
    $('plan-caption').innerHTML = C.UI.captions[C.level];
    for (const g of $('plan').querySelectorAll('[data-room]')) g.addEventListener('click', () => select(g.dataset.room, false));
    press(C.M.levels.map((l) => 'lvl-' + l.key), 'lvl-' + C.level);
  }

  function setLevel(l) {
    C.level = l;
    store.set(C.id + ':level', l);
    renderPlan();
  }

  function renderRooms() {
    const box = $('rooms');
    box.innerHTML = '';
    for (const l of ['g', 'u', 't', 'r']) {
      const rs = C.M.rooms.filter((x) => listed(x) && C.levelOf(x) === l);
      if (!rs.length) continue;
      const h = document.createElement('div');
      h.className = 'grp';
      h.textContent = C.UI.levelNames[l];
      box.appendChild(h);
      for (const r of rs) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(state.highlight === r.id));
        const meta = r.h > 0 ? `${Math.round(C.M.roomArea(r))} пл · +${r.z0}…${r.z0 + r.h}` : `палуба +${r.z0}`;
        b.innerHTML = `<span></span><span>${meta}</span>`;
        b.firstChild.textContent = r.name;
        b.addEventListener('click', () => select(r.id, true));
        box.appendChild(b);
      }
    }
  }

  function select(id, fromList) {
    state.highlight = state.highlight === id && fromList ? null : id;
    const r = C.M.rooms.find((x) => x.id === id);
    if (state.highlight && r) {
      const lvl = C.levelOf(r);
      if (fromList && lvl !== C.level) C.level = lvl;
      const items = (r.items || []).filter((it) => it.kind !== 'light' && it.kind !== 'hatch');
      const counts = {};
      for (const it of items) {
        const n = it.kind === 'stairs' ? `${it.name} (+${it.from} → +${it.to})` : it.full || it.name;
        counts[n] = (counts[n] || 0) + 1;
      }
      const sq = r.tiles.filter((t) => t.k === 's').length, tr = r.tiles.length - sq;
      $('detail').innerHTML = `<h3></h3><p></p><p>${sq} квадратів · ${tr} трикутників · ${r.h > 0 ? `від +${r.z0} до +${r.z0 + r.h}` : `на висоті +${r.z0}`}</p>` +
        (items.length ? '<ul>' + Object.entries(counts).map(([n, c]) => `<li>${n}${c > 1 ? ' ×' + c : ''}</li>`).join('') + '</ul>' : '');
      $('detail').querySelector('h3').textContent = r.name;
      $('detail').querySelector('p').textContent = r.note || '';
    } else {
      $('detail').innerHTML = '<p>Обери приміщення, щоб підсвітити його на плані.</p>';
    }
    if (state.tab !== 'plan' && fromList) setTab('plan');
    renderPlan();
    renderRooms();
  }

  function renderCounts() {
    let s = 0, t = 0;
    let html = '<thead><tr><th>Ярус</th><th><span class="dot" style="background:var(--sq)"></span>кв.</th><th><span class="dot" style="background:var(--tri);clip-path:polygon(50% 0,100% 100%,0 100%)"></span>тр.</th></tr></thead><tbody>';
    for (const r of C.P.pieceCounts()) {
      s += r.s; t += r.t;
      html += `<tr><td>${r.name}</td><td>${r.s}</td><td>${r.t}</td></tr>`;
    }
    $('counts').innerHTML = html + `</tbody><tfoot><tr><td>Разом</td><td>${s}</td><td>${t}</td></tr></tfoot>`;
  }

  // ---------- етапи, кошторис, ліміти ----------
  function renderSteps() {
    const B = C.B, bud = B.budget(C.res, C.lim);
    const short = { fsq: 'фунд. кв.', ftri: 'фунд. тр.', ramp: 'похилих', csq: 'перекр. кв.', ctri: 'перекр. тр.', wall: 'стін', door: 'дверей', shield: 'пентащитів', rail: 'парапетів', stairs: 'сходів', pillar: 'колон' };
    let html = '';
    for (const st of C.res.stages) {
      let parts = B.KINDS.filter((k) => st.n[k.id]).map((k) => `<span>${short[k.id]} ${fmtN(st.n[k.id])}</span>`).join('');
      if (st.id === 'found' && C.lim.found > 0) parts += `<span class="res">+ запас: кв. ${fmtN(bud.resSq)}, тр. ${fmtN(bud.resTri)}</span>`;
      html += `<li><div><b>${st.name}.</b> <span class="what">${st.note}</span><div class="cnt">${parts}</div></div></li>`;
    }
    const eq = B.equipment().map(([n, c]) => `<span>${n}${c > 1 ? ' ×' + c : ''}</span>`).join('');
    html += `<li><div><b>Пристрої й обладнання.</b><div class="cnt">${eq}</div></div></li>`;
    $('steps').innerHTML = html;
  }

  // Кошторис: кількість і ціну можна виправити прямо в комірці; правки зберігаються для кожної бази окремо.
  const num = (v) => Number(String(v).trim().replace(/\s/g, '').replace(',', '.'));
  function renderCost() {
    const c = C.B.cost(C.res, C.lim), ov = store.get(C.id + ':cost', {});
    const rows = c.rows.map((r) => ({ id: r.id, name: r.name, sub: r.sub, n: r.n, price: r.price }));
    if (c.shields) rows.push({ id: 'shield', name: 'Пентащит (секція)', n: c.shields, price: null });
    const cell = (r, f, v, label) => {
      const edited = ov[r.id] && ov[r.id][f] !== undefined;
      return `<input class="cell${edited ? ' edited' : ''}" type="text" inputmode="decimal" data-row="${r.id}" data-f="${f}" data-def="${r[f]}" value="${f === 'n' ? Math.round(edited ? ov[r.id][f] : v) : fmtP(edited ? ov[r.id][f] : v)}" aria-label="${label}: ${r.name}">`;
    };
    let t = '<thead><tr><th>Деталь</th><th>К-сть</th><th>Ціна</th><th>Каменю</th></tr></thead><tbody>';
    for (const r of rows)
      t += `<tr${r.sub ? ' class="sub"' : ''}><td>${r.name}</td><td>${cell(r, 'n', r.n, 'Кількість')}</td>`
        + `<td>${r.price === null ? '<span class="same">не камінь</span>' : cell(r, 'price', r.price, 'Ціна')}</td><td data-sum="${r.id}">—</td></tr>`;
    t += '</tbody><tfoot><tr><td>Разом гранітного каменю</td><td></td><td></td><td id="cost-total">—</td></tr></tfoot>';
    $('cost').innerHTML = t;
    for (const inp of $('cost').querySelectorAll('input.cell')) {
      inp.addEventListener('input', () => {
        const o = store.get(C.id + ':cost', {}), k = inp.dataset.row, f = inp.dataset.f, v = num(inp.value);
        o[k] = o[k] || {};
        if (inp.value.trim() === '' || !isFinite(v) || v < 0 || Math.abs(v - Number(inp.dataset.def)) < 1e-9) delete o[k][f];
        else o[k][f] = v;
        if (!Object.keys(o[k]).length) delete o[k];
        store.set(C.id + ':cost', o);
        inp.classList.toggle('edited', !!(o[k] && o[k][f] !== undefined));
        recalcCost(c);
      });
      // порожня або хибна комірка після виходу показує стандартне значення
      inp.addEventListener('change', () => { if (inp.value.trim() === '' || !isFinite(num(inp.value))) renderCost(); });
    }
    recalcCost(c);
  }
  function recalcCost(c) {
    const val = (k, f) => { const el = $('cost').querySelector(`input[data-row="${k}"][data-f="${f}"]`); const v = el ? num(el.value) : NaN; return isFinite(v) && v >= 0 ? v : Number(el && el.dataset.def); };
    let stone = 0;
    for (const td of $('cost').querySelectorAll('[data-sum]')) {
      const k = td.dataset.sum;
      if (k === 'shield') { td.textContent = '—'; continue; }
      const x = val(k, 'n') * val(k, 'price');
      stone += x;
      td.textContent = fmtN(x);
    }
    $('cost-total').textContent = fmtN(stone);
    const sh = c.shields ? val('shield', 'n') : 0;
    const edited = Object.keys(store.get(C.id + ':cost', {})).length > 0;
    $('cost-note').innerHTML = (c.factor !== 1 ? `Ціни вже зі знижкою Глибокої пустелі (×${fmtP(c.factor)}). ` : '')
      + (sh ? `На пентащити: ${c.shieldPer.map((m) => `<b>${fmtN(Math.ceil(sh * m.per))}</b> ${m.name}`).join(', ')}. ` : '')
      + 'Кількість і ціну можна виправити в комірці.'
      + (edited ? ' <button type="button" class="linkbtn" id="cost-reset">Скинути правки</button>' : '');
    if (edited) $('cost-reset').addEventListener('click', () => { store.set(C.id + ':cost', {}); renderCost(); });
  }

  // ---------- версії ----------
  const BASE_NAMES = { main: 'Sandwalkers Main', dd: 'Sandwalkers DD' };
  const REPO = 'https://github.com/stepanenko3/dune/commit/';
  function renderVersions() {
    const V = window.VERSIONS || [];
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const date = (d) => d.split('-').reverse().join('.');
    $('versions').innerHTML = ORDER.map((b) => `<section><h3>${BASE_NAMES[b] || b}</h3>` + V.filter((v) => v.base === b).map((v) =>
      `<details class="ver"><summary><b>${esc(v.n)}</b><span class="vt">${esc(v.title)}</span><time datetime="${v.date}">${date(v.date)}</time></summary>`
      + `<div class="vbody"><ul>${v.changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      + `<img src="${v.img}" alt="${esc(BASE_NAMES[b] || b)}, версія ${esc(v.n)}, вигляд 3D" width="960" height="655" loading="lazy">`
      + `<p class="vmeta">${v.commit ? `Коміт <a href="${REPO}${v.commit}" target="_blank" rel="noopener">${v.commit}</a>` : 'Поточна версія'}</p></div></details>`).join('') + '</section>').join('');
  }

  function renderLimit() {
    const B = C.B, bud = B.budget(C.res, C.lim);
    const cap = B.LIMITS[0].cap, over = bud.total - cap;
    $('lim-total').textContent = fmtN(bud.total);
    $('lim-cap').textContent = fmtN(cap);
    const st = $('lim-status');
    st.className = 'lim-status ' + (over > 0 ? 'bad' : 'ok');
    st.textContent = over > 0 ? `не влазить: більше на ${fmtN(over)}` : `влазить: лишається ${fmtN(-over)}`;
    const scale = Math.max(bud.total, cap) * 1.04;
    const pc = (n) => ((n / scale) * 100).toFixed(3) + '%';
    let bar = '';
    for (const g of bud.groups) if (g.n > 0) bar += `<span class="seg s-${g.id}" style="width:${pc(g.n)}" title="${g.name}: ${fmtN(g.n)}"></span>`;
    if (over > 0) bar += `<span class="over" style="left:${pc(cap)};width:${pc(over)}"></span>`;
    bar += `<span class="cap" style="left:${pc(cap)}"><span>ліміт ${fmtN(cap)}</span></span>`;
    $('lim-bar').innerHTML = bar;
    $('lim-legend').innerHTML = bud.groups.map((g) => `<li><span class="sw s-${g.id}"></span><span>${g.name}</span><b>${fmtN(g.n)}</b></li>`).join('');
    const room = cap - bud.base - bud.decor;
    const per = Math.floor((room / bud.bottom) * 10) / 10;
    $('lim-hint').innerHTML = room < 0
      ? `Навіть без запасу фундаментів конструкція з декором більша за ліміт на ${fmtN(-room)}.`
      : `У ліміт уміщається до <b>${fmtP(per)}</b> фундаменту запасу на кожну нижню плиту.`;
    let cats = '';
    for (const c of bud.cats.slice(1)) {
      const what = c.items.map(([n, k]) => `${n}${k > 1 ? ' ×' + k : ''}`).join(' · ');
      cats += `<li class="${c.n > c.cap ? 'bad' : ''}"><div class="lc-top"><span>${c.name}</span><b>${fmtN(c.n)} <i>/ ${fmtN(c.cap)}</i></b></div>`
        + `<div class="mini"><span style="width:${Math.min(100, (c.n / c.cap) * 100).toFixed(2)}%"></span></div><div class="lc-what">${what}</div></li>`;
    }
    $('lim-cats').innerHTML = cats;
  }

  function renderBuild() {
    for (const inp of document.querySelectorAll('[data-lim]')) inp.value = C.lim[inp.dataset.lim];
    const how = C.UI.howto;
    $('howto').hidden = !how;
    $('howto').innerHTML = how ? '<h3>Як будувати від кута ділянки</h3><ol>' + how.map((x) => `<li>${x}</li>`).join('') + '</ol>' : '';
    renderSteps();
    renderLimit();
    renderCost();
  }

  // ---------- 3D ----------
  function floorFor(v) {
    // «тільки плити» завжди показує один поверх (крім «уся база»)
    if ((!$('opt-iso').checked && !$('opt-found').checked) || v >= C.UI.all) return -1;
    const lv = C.M.levels.filter((l) => l.z0 < v - 0.05);
    const z = (lv[lv.length - 1] || C.M.levels[0]).z0;
    return z > 0 ? z - 0.009 : -1; // між карнизами (−0.02) і дахами (−0.004), не на плиті
  }
  function setCut(v) {
    C.cut = v;
    $('cut').value = v;
    $('cut-val').textContent = v >= C.UI.all ? 'усе' : '+' + Number(v).toFixed(2).replace(/\.?0+$/, '');
    press(Object.keys(C.cuts), Object.keys(C.cuts).find((k) => Math.abs(C.cuts[k][0] - v) < 0.01) || '');
    if (C.view) C.view.setCut(v >= C.UI.all ? 99 : v, floorFor(v));
  }
  function applyOptions(v) {
    v.setInterior($('opt-interior').checked);
    v.setFoundation($('opt-found').checked);
    v.setTileColors($('opt-tiles').checked);
    v.setLabels($('opt-labels3d').checked);
  }
  function ensure3D() {
    if (C.view) return true;
    if (!window.THREE || !window.THREE.OrbitControls) {
      $('three').innerHTML = '<div class="three-msg">Не вдалося завантажити three.js. Онови сторінку — план працює без нього.</div>';
      return false;
    }
    C.box = document.createElement('div');
    C.box.className = 'three-base';
    $('three').appendChild(C.box);
    C.view = window.VIEW3D.create(C.box, {}, C.M);
    return true;
  }
  function show3D() {
    for (const k of ORDER) if (ctx[k] && ctx[k] !== C && ctx[k].view) { ctx[k].view.stop(); ctx[k].box.hidden = true; }
    if (state.tab === 'plan') { if (C.view) C.view.stop(); return; }
    if (!ensure3D()) return;
    C.box.hidden = false;
    applyOptions(C.view);
    setCut(C.cut);
    C.view.start();
  }

  function setTab(t) {
    state.tab = t;
    store.set('tab', t);
    press(['tab-plan', 'tab-3d'], 'tab-' + (t === 'plan' ? 'plan' : '3d'));
    $('plan-panel').hidden = t !== 'plan';
    $('three-panel').hidden = t === 'plan';
    show3D();
  }

  // ---------- перемикання бази ----------
  // Третя вкладка — план розвитку: замість плану бази показує, що будувати далі і скільки коштує.
  const PLAN_HEAD = {
    name: 'План розвитку',
    lead: 'Що будувати далі і скільки це коштує. Ціни переробників — з гри, деталі техніки — з актуальної бази, решта — оцінка.',
    facts: ['<b>4</b> етапи', '≈ <b>2 000</b> пластану', '≈ <b>2 000</b> меланжу', 'указ Ландсрааду <b>−25%</b> на переробку'],
  };
  const TABS = [...ORDER, 'plan'];
  function setView(id) {
    const plan = id === 'plan';
    for (const el of document.querySelectorAll('[data-view]')) el.hidden = el.dataset.view !== (plan ? 'plan' : 'base');
    press(TABS.map((k) => 'base-' + k), 'base-' + id);
    store.set('base', id);
    try { history.replaceState(null, '', id === ORDER[0] ? location.pathname : '#' + id); } catch (e) { /* без адреси */ }
  }
  function showPlan() {
    setView('plan');
    $('base-title').textContent = PLAN_HEAD.name;
    $('base-lead').textContent = PLAN_HEAD.lead;
    $('base-facts').innerHTML = PLAN_HEAD.facts.map((f) => `<li>${f}</li>`).join('');
    for (const k of ORDER) if (ctx[k] && ctx[k].view) ctx[k].view.stop();
  }

  function setBase(id) {
    if (id === 'plan') return showPlan();
    if (!BASES[id]) id = ORDER[0];
    C = context(id);
    setView(id);
    const UI = C.UI;
    $('base-title').textContent = UI.name;
    $('base-lead').textContent = UI.lead;
    $('base-facts').innerHTML = UI.facts.map((f) => `<li>${f}</li>`).join('');
    // атрибут, а не el.hidden: у SVG такої властивості немає
    for (const el of document.querySelectorAll('[data-only]')) el.toggleAttribute('hidden', el.dataset.only !== id);

    $('lvl-seg').innerHTML = C.M.levels.map((l) => `<button id="lvl-${l.key}" type="button" aria-pressed="false">${UI.levelButtons[l.key]}</button>`).join('');
    for (const l of C.M.levels) $('lvl-' + l.key).addEventListener('click', () => setLevel(l.key));
    $('cut-seg').innerHTML = Object.keys(C.cuts).map((k) => `<button id="${k}" type="button" aria-pressed="false">${k === 'cut-all' ? 'Уся база' : UI.cutButtons[k]}</button>`).join('');
    for (const k of Object.keys(C.cuts)) $(k).addEventListener('click', () => setCut(C.cuts[k][0]));
    $('cut').max = UI.all;

    state.highlight = null;
    select(null, false);
    renderCounts();
    renderBuild();
    setCut(C.cut);
    show3D();
  }

  // ---------- події ----------
  for (const k of TABS) $('base-' + k).addEventListener('click', () => setBase(k));
  $('tab-plan').addEventListener('click', () => setTab('plan'));
  $('tab-3d').addEventListener('click', () => setTab('3d'));
  $('opt-interior').addEventListener('change', (e) => C.view && C.view.setInterior(e.target.checked));
  $('opt-found').addEventListener('change', (e) => { if (C.view) C.view.setFoundation(e.target.checked); setCut(Number($('cut').value)); });
  $('opt-items').addEventListener('change', (e) => { state.items = e.target.checked; renderPlan(); });
  $('opt-labels').addEventListener('change', (e) => { state.labels = e.target.checked; renderPlan(); });
  $('opt-coords').checked = state.coords;
  $('opt-coords').addEventListener('change', (e) => { state.coords = e.target.checked; store.set('coords', state.coords); renderPlan(); });
  $('opt-iso').addEventListener('change', () => setCut(Number($('cut').value)));
  $('cut').addEventListener('input', (e) => setCut(Number(e.target.value)));
  $('opt-tiles').addEventListener('change', (e) => C.view && C.view.setTileColors(e.target.checked));
  $('opt-labels3d').addEventListener('change', (e) => C.view && C.view.setLabels(e.target.checked));
  for (const c of ['quarter', 'front', 'back', 'top'])
    $('cam-' + c).addEventListener('click', () => {
      press(['cam-quarter', 'cam-front', 'cam-back', 'cam-top'], 'cam-' + c);
      if (C.view) C.view.setView(c);
    });
  for (const inp of document.querySelectorAll('[data-lim]'))
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      if (inp.value === '' || !isFinite(v) || v < 0) return;
      C.lim[inp.dataset.lim] = v;
      store.set(C.id + ':limit', C.lim);
      renderSteps();
      renderLimit();
      renderCost();
    });

  renderVersions();
  const fromHash = location.hash.replace('#', '');
  state.tab = state.tab === '3d' ? '3d' : 'plan';
  press(['tab-plan', 'tab-3d'], 'tab-' + state.tab);
  $('plan-panel').hidden = state.tab !== 'plan';
  $('three-panel').hidden = state.tab === 'plan';
  const first = TABS.includes(fromHash) ? fromHash : store.get('base', ORDER[0]);
  if (first === 'plan') setBase(ORDER[0]); // база готується наперед, щоб «назад» з плану був миттєвим
  setBase(TABS.includes(first) ? first : ORDER[0]);

  // для знімків екрана і перевірок
  window.SANDWALKERS = { setBase, setTab, setLevel, setCut, select, view: () => C.view };
})();
