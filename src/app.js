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
    variant: store.get('variant', 'terrace'),
    items: true,
    labels: true,
    highlight: null,
  };
  let view = null;

  const levelOf = (r) => (r.z0 === 0 ? 'g' : r.z0 < 8 ? 'u' : 'r');
  const LEVEL_NAMES = { g: 'Рівень 0 · земля', u: 'Рівень +4 · ангари, тераса', r: 'Дах і башти' };
  const CAPTIONS = {
    g: '<span><strong>Рівень 0.</strong> Заїзд, гаражі, цоколі крил, Великий зал і переробка. Висота ярусу 4 стіни.</span>',
    u: '<span><strong>Рівень +4.</strong> Ангари на крилах, тераса з пентащитом над краулером, наскрізний ангар над Великим залом. Штрихування — зал меланжу і башти, що проходять наскрізь.</span>',
    r: '<span><strong>Дах.</strong> Вітряки на +7, вітропастки на +8, ліхтарі башт до +11. Над пристроями нічого немає.</span>',
  };

  function press(ids, active) {
    for (const id of ids) $(id).setAttribute('aria-pressed', String(id === active));
  }

  function renderPlan() {
    $('plan').innerHTML = window.PLAN2D.render({
      level: state.level, items: state.items, labels: state.labels, variant: state.variant, highlight: state.highlight,
    });
    const v = M.variants[state.variant];
    $('plan-caption').innerHTML = CAPTIONS[state.level] + (state.level === 'u' ? `<span><strong>${v.label}:</strong> ${v.note}</span>` : '');
    for (const g of $('plan').querySelectorAll('[data-room]')) g.addEventListener('click', () => select(g.dataset.room, false));
    press(['lvl-g', 'lvl-u', 'lvl-r'], 'lvl-' + state.level);
  }

  function setLevel(l) {
    state.level = l;
    store.set('level', l);
    renderPlan();
  }

  function setVariant(k) {
    state.variant = k;
    store.set('variant', k);
    press(['var-terrace', 'var-entrance'], 'var-' + k);
    renderPlan();
    renderRooms();
    if (view) view.setVariant(k);
  }

  function roomName(r) {
    return r.id === 'terrace' ? M.variants[state.variant].label : r.name;
  }

  function renderRooms() {
    const box = $('rooms');
    box.innerHTML = '';
    for (const l of ['g', 'u', 'r']) {
      const h = document.createElement('div');
      h.className = 'grp';
      h.textContent = LEVEL_NAMES[l];
      box.appendChild(h);
      for (const r of M.rooms.filter((x) => levelOf(x) === l)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(state.highlight === r.id));
        const meta = r.h > 0 ? `${Math.round(M.roomArea(r))} пл · h${r.h}` : r.group === 'shield' ? 'пентащит' : 'палуба';
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
      const items = (r.items || []).filter((it) => it.kind !== 'light');
      const counts = {};
      for (const it of items) counts[it.name] = (counts[it.name] || 0) + 1;
      const sq = r.tiles.filter((t) => t.k === 's').length, tr = r.tiles.length - sq;
      const note = r.id === 'terrace' ? `${r.note} ${M.variants[state.variant].note}` : r.note;
      $('detail').innerHTML = `<h3></h3><p></p><p>${sq} квадратів · ${tr} трикутників · ${r.h > 0 ? `висота ${r.h} рівні від +${r.z0}` : `на висоті +${r.z0}`}</p>` +
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

  // ---------- 3D ----------
  const CUTS = { 'cut-g': 3.75, 'cut-u': 7.95, 'cut-all': 14 };
  function setCut(v) {
    $('cut').value = v;
    $('cut-val').textContent = v >= 14 ? 'усе' : '+' + Number(v).toFixed(2).replace(/\.?0+$/, '');
    press(Object.keys(CUTS), Object.keys(CUTS).find((k) => Math.abs(CUTS[k] - v) < 0.01) || '');
    if (view) view.setCut(v >= 14 ? 99 : v);
  }
  function ensure3D() {
    if (view) return true;
    if (!window.THREE || !window.THREE.OrbitControls) {
      $('three').innerHTML = '<div class="three-msg">Не вдалося завантажити three.js. Перевір з\'єднання і онови сторінку — план у вкладці «План» працює без нього.</div>';
      return false;
    }
    view = window.VIEW3D.create($('three'), { variant: state.variant });
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
  for (const l of ['g', 'u', 'r']) $('lvl-' + l).addEventListener('click', () => setLevel(l));
  $('var-terrace').addEventListener('click', () => setVariant('terrace'));
  $('var-entrance').addEventListener('click', () => setVariant('entrance'));
  $('opt-items').addEventListener('change', (e) => { state.items = e.target.checked; renderPlan(); });
  $('opt-labels').addEventListener('change', (e) => { state.labels = e.target.checked; renderPlan(); });
  for (const k of Object.keys(CUTS)) $(k).addEventListener('click', () => setCut(CUTS[k]));
  $('cut').addEventListener('input', (e) => setCut(Number(e.target.value)));
  $('opt-tiles').addEventListener('change', (e) => view && view.setTileColors(e.target.checked));
  $('opt-labels3d').addEventListener('change', (e) => view && view.setLabels(e.target.checked));
  for (const c of ['quarter', 'front', 'back', 'top'])
    $('cam-' + c).addEventListener('click', () => {
      press(['cam-quarter', 'cam-front', 'cam-back', 'cam-top'], 'cam-' + c);
      if (view) view.setView(c);
    });

  press(['var-terrace', 'var-entrance'], 'var-' + state.variant);
  renderPlan();
  renderRooms();
  renderCounts();
  setTab(state.tab === '3d' ? '3d' : 'plan');

  // для знімків екрана
  window.CITADEL = { setTab, setLevel, setVariant, setCut, select, view: () => view };
})();
