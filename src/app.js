/* Інтерфейс сторінки: вкладки, рівні, список приміщень, кошторис, 3D. */
(function () {
  'use strict';
  const M = window.BASE;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('citadel:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('citadel:' + k, JSON.stringify(v)); } catch (e) { /* без збереження */ } },
  };

  const state = {
    tab: store.get('tab', 'plan'),
    level: store.get('level', 'g'),
    items: true,
    labels: true,
    coords: store.get('coords', false),
    highlight: null,
  };
  let view = null;

  const { G, CAR, TOP } = M.heights;
  const ALL = 22; // зріз «уся база»
  const levelOf = (r) => (r.z0 < G ? 'g' : r.z0 < CAR ? 'u' : r.z0 < TOP ? 't' : 'r');
  const listed = (r) => r.group !== 'crown';
  const LEVEL_NAMES = { g: 'Рівень 0 · земля', u: 'Рівень +5 · ангари орні, перехід, другі поверхи', t: 'Рівень +9 · ангар грузових, вежі', r: 'Дах · балкони веж, місток' };
  const CAPTIONS = {
    g: '<span><strong>Рівень 0.</strong> Спереду заїзд і гаражі (заїзди 2 плити на рівні підлоги). У центрі Великий зал із фабрикаторами (витягнутий шестикутник), впритул обабіч — цех меланжу і рудний цех. На тилу головний склад із двома крилами, задній вхід заглиблено на 2 ряди. Пунктир — ангари орні над обривом, під ними порожньо. Стрілки — сходи вгору.</span>',
    u: '<span><strong>Рівень +5.</strong> Ангари орні на тилу під кутом звисають над обривом: скляні бокси, виліт назад, убік і вгору. Між ними задня галерея і круглий балкон над заднім входом. Спереду перехід над заїздом з круглим балконом, обабіч залу — водний блок і майстерня, звідки сходи у вежі. Штрихування — зали, що проходять крізь рівень.</span>',
    t: '<span><strong>Рівень +9.</strong> Широкий ангар грузових на 2 місця поруч: спереду виліт під містком, ззаду — на задній майданчик; над ангарами орні він не нависає, їхні світлики вільні. Вежі починаються тут, на дахах бічних блоків: двері на дах, звідти до порталу ангара грузових. Дахи ангарів орні у 2 яруси зі світликом.</span>',
    r: '<span><strong>Дах.</strong> Ступінчаста гора над переднім порталом ангара грузових (скрін 4), за нею 20 вітряків. Вежі з балконами і місток-брама на +15 над переходом, ліхтарі +17. Над пристроями нічого немає.</span>',
  };

  function press(ids, active) {
    for (const id of ids) $(id).setAttribute('aria-pressed', String(id === active));
  }

  function renderPlan() {
    $('plan').innerHTML = window.PLAN2D.render({
      level: state.level, items: state.items, labels: state.labels, coords: state.coords, highlight: state.highlight,
    });
    $('plan-caption').innerHTML = CAPTIONS[state.level];
    for (const g of $('plan').querySelectorAll('[data-room]')) g.addEventListener('click', () => select(g.dataset.room, false));
    press(['lvl-g', 'lvl-u', 'lvl-t', 'lvl-r'], 'lvl-' + state.level);
  }

  function setLevel(l) {
    state.level = l;
    store.set('level', l);
    renderPlan();
  }

  function roomName(r) {
    return r.name;
  }

  function renderRooms() {
    const box = $('rooms');
    box.innerHTML = '';
    for (const l of ['g', 'u', 't', 'r']) {
      const h = document.createElement('div');
      h.className = 'grp';
      h.textContent = LEVEL_NAMES[l];
      box.appendChild(h);
      for (const r of M.rooms.filter((x) => listed(x) && levelOf(x) === l)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(state.highlight === r.id));
        const meta = r.h > 0 ? `${Math.round(M.roomArea(r))} пл · +${r.z0}…${r.z0 + r.h}` : r.group === 'shield' ? 'пентащит' : `палуба +${r.z0}`;
        b.innerHTML = `<span></span><span>${meta}</span>`;
        b.firstChild.textContent = roomName(r);
        b.addEventListener('click', () => select(r.id, true));
        box.appendChild(b);
      }
    }
  }

  function select(id, fromList) {
    state.highlight = state.highlight === id && fromList ? null : id;
    const r = M.rooms.find((x) => x.id === id);
    if (state.highlight && r) {
      const lvl = levelOf(r);
      if (fromList && lvl !== state.level) state.level = lvl;
      const items = (r.items || []).filter((it) => it.kind !== 'light' && it.kind !== 'hatch');
      const counts = {};
      for (const it of items) {
        const n = it.kind === 'stairs' ? `${it.name} (+${it.from} → +${it.to})` : it.full || it.name;
        counts[n] = (counts[n] || 0) + 1;
      }
      const sq = r.tiles.filter((t) => t.k === 's').length, tr = r.tiles.length - sq;
      const note = r.note;
      $('detail').innerHTML = `<h3></h3><p></p><p>${sq} квадратів · ${tr} трикутників · ${r.h > 0 ? `від +${r.z0} до +${r.z0 + r.h}` : `на висоті +${r.z0}`}</p>` +
        (items.length ? '<ul>' + Object.entries(counts).map(([n, c]) => `<li>${n}${c > 1 ? ' ×' + c : ''}</li>`).join('') + '</ul>' : '');
      $('detail').querySelector('h3').textContent = roomName(r);
      $('detail').querySelector('p').textContent = note || '';
    } else {
      $('detail').innerHTML = '<p>Обери приміщення, щоб підсвітити його на плані й побачити, що в ньому.</p>';
    }
    if (state.tab !== 'plan' && fromList) setTab('plan');
    renderPlan();
    renderRooms();
  }

  function renderCounts() {
    const rows = window.PLAN2D.pieceCounts();
    let s = 0, t = 0;
    let html = '<thead><tr><th>Ярус</th><th><span class="dot" style="background:var(--sq)"></span>кв.</th><th><span class="dot" style="background:var(--tri);clip-path:polygon(50% 0,100% 100%,0 100%)"></span>тр.</th></tr></thead><tbody>';
    for (const r of rows) {
      s += r.s; t += r.t;
      html += `<tr><td>${r.name}</td><td>${r.s}</td><td>${r.t}</td></tr>`;
    }
    html += `</tbody><tfoot><tr><td>Разом</td><td>${s}</td><td>${t}</td></tr></tfoot>`;
    $('counts').innerHTML = html;
  }

  // ---------- план будівництва і кошторис ----------
  const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  function renderBuild() {
    const B = window.BUILD, res = B.compute();
    const short = { fsq: 'фунд. кв.', ftri: 'фунд. тр.', ramp: 'похилих', csq: 'перекр. кв.', ctri: 'перекр. тр.', wall: 'стін', window: 'вікон', door: 'дверей', shield: 'пентащитів', rail: 'парапетів' };
    let html = '';
    for (const st of res.stages) {
      const parts = B.KINDS.filter((k) => st.n[k.id]).map((k) => `<span>${short[k.id]} ${fmtN(st.n[k.id])}</span>`).join('');
      html += `<li><div><b>${st.name}.</b> <span class="what">${st.note}</span><div class="cnt">${parts}</div></div></li>`;
    }
    const eq = B.equipment().map(([n, c]) => `<span>${n}${c > 1 ? ' ×' + c : ''}</span>`).join('');
    html += `<li><div><b>Пристрої й обладнання.</b> <span class="what">Ставляться після стін і дахів; вітряки й вітропастки — на дахи, де над ними нічого немає.</span><div class="cnt">${eq}</div></div></li>`;
    $('steps').innerHTML = html;

    const prices = store.get('prices', {});
    let t = '<thead><tr><th>Деталь</th><th>К-сть</th><th>Ціна</th><th>Разом</th></tr></thead><tbody>';
    for (const k of B.KINDS) {
      const v = prices[k.id];
      t += `<tr><td>${k.name}</td><td>${fmtN(res.total[k.id])}</td><td><input type="number" min="0" step="1" inputmode="numeric" data-k="${k.id}" value="${v === undefined ? '' : v}" placeholder="?" aria-label="Ціна: ${k.name}"></td><td data-sum="${k.id}">—</td></tr>`;
    }
    t += '</tbody><tfoot><tr><td>Разом</td><td></td><td></td><td id="cost-total">—</td></tr></tfoot>';
    $('cost').innerHTML = t;
    const recalc = () => {
      let sum = 0, any = false;
      for (const k of B.KINDS) {
        const v = prices[k.id];
        const cell = $('cost').querySelector(`[data-sum="${k.id}"]`);
        if (v === undefined || v === '' || isNaN(v)) { cell.textContent = '—'; continue; }
        const x = res.total[k.id] * Number(v);
        sum += x; any = true;
        cell.textContent = fmtN(x);
      }
      $('cost-total').textContent = any ? fmtN(sum) + ' ' + ($('cost-res').value || '') : '—';
    };
    for (const inp of $('cost').querySelectorAll('input')) inp.addEventListener('input', (e) => {
      const k = e.target.dataset.k, v = e.target.value;
      if (v === '') delete prices[k]; else prices[k] = Number(v);
      store.set('prices', prices);
      recalc();
    });
    $('cost-res').value = store.get('resource', 'пластон');
    $('cost-res').addEventListener('input', (e) => { store.set('resource', e.target.value); recalc(); });
    recalc();
  }

  // ---------- 3D ----------
  // Поверхи в 3D: верхня межа зрізу і підлога поверху (для режиму «лише цей поверх»).
  const CUTS = { 'cut-g': [4.9, 0], 'cut-u': [8.95, G], 'cut-t': [12.55, CAR], 'cut-all': [ALL, 0] };
  function floorFor(v) {
    // «тільки плити» завжди показує один поверх (крім «уся база»)
    if ((!$('opt-iso').checked && !$('opt-found').checked) || v >= ALL) return -1;
    const lv = M.levels.filter((l) => l.z0 < v - 0.05);
    const z = (lv[lv.length - 1] || M.levels[0]).z0;
    return z > 0 ? z - 0.05 : -1;
  }
  function setCut(v) {
    $('cut').value = v;
    $('cut-val').textContent = v >= ALL ? 'усе' : '+' + Number(v).toFixed(2).replace(/\.?0+$/, '');
    press(Object.keys(CUTS), Object.keys(CUTS).find((k) => Math.abs(CUTS[k][0] - v) < 0.01) || '');
    if (view) view.setCut(v >= ALL ? 99 : v, floorFor(v));
  }
  function ensure3D() {
    if (view) return true;
    if (!window.THREE || !window.THREE.OrbitControls) {
      $('three').innerHTML = '<div class="three-msg">Не вдалося завантажити three.js. Перевір з\'єднання і онови сторінку — план у вкладці «План» працює без нього.</div>';
      return false;
    }
    view = window.VIEW3D.create($('three'), {});
    view.setInterior($('opt-interior').checked);
    view.setFoundation($('opt-found').checked);
    view.setTileColors($('opt-tiles').checked);
    view.setLabels($('opt-labels3d').checked);
    setCut(Number($('cut').value));
    return true;
  }

  function setTab(t) {
    state.tab = t;
    store.set('tab', t);
    press(['tab-plan', 'tab-3d'], 'tab-' + (t === 'plan' ? 'plan' : '3d'));
    $('plan-panel').hidden = t !== 'plan';
    $('three-panel').hidden = t === 'plan';
    if (t === 'plan') { if (view) view.stop(); }
    else if (ensure3D()) view.start();
  }

  // ---------- події ----------
  $('tab-plan').addEventListener('click', () => setTab('plan'));
  $('tab-3d').addEventListener('click', () => setTab('3d'));
  for (const l of ['g', 'u', 't', 'r']) $('lvl-' + l).addEventListener('click', () => setLevel(l));
  $('opt-interior').addEventListener('change', (e) => view && view.setInterior(e.target.checked));
  $('opt-found').addEventListener('change', (e) => { if (view) view.setFoundation(e.target.checked); setCut(Number($('cut').value)); });
  $('opt-items').addEventListener('change', (e) => { state.items = e.target.checked; renderPlan(); });
  $('opt-labels').addEventListener('change', (e) => { state.labels = e.target.checked; renderPlan(); });
  $('opt-coords').checked = state.coords;
  $('opt-coords').addEventListener('change', (e) => { state.coords = e.target.checked; store.set('coords', state.coords); renderPlan(); });
  for (const k of Object.keys(CUTS)) $(k).addEventListener('click', () => setCut(CUTS[k][0]));
  $('opt-iso').addEventListener('change', () => setCut(Number($('cut').value)));
  $('cut').addEventListener('input', (e) => setCut(Number(e.target.value)));
  $('opt-tiles').addEventListener('change', (e) => view && view.setTileColors(e.target.checked));
  $('opt-labels3d').addEventListener('change', (e) => view && view.setLabels(e.target.checked));
  for (const c of ['quarter', 'front', 'back', 'top'])
    $('cam-' + c).addEventListener('click', () => {
      press(['cam-quarter', 'cam-front', 'cam-back', 'cam-top'], 'cam-' + c);
      if (view) view.setView(c);
    });

  renderPlan();
  renderRooms();
  renderCounts();
  renderBuild();
  setTab(state.tab === '3d' ? '3d' : 'plan');

  // для знімків екрана
  window.CITADEL = { setTab, setLevel, setCut, select, view: () => view };
})();
