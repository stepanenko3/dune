/*
 * 2D-план у стилі скріна 1: сині квадрати, помаранчеві трикутники, білі шви,
 * світла сітка, рамки ділянок 10x10 з точками на кутах.
 */
(function (root) {
  'use strict';
  // тексти плану мовою сайту: у браузері — перекладач сайту (root.BASE_T ставить lib/engine.ts, ключі — у
  // components/base/tr.ts), підписи станцій рушія (BASE_LAB), числа (BASE_NUM: 7,5) і «N ділянок» (BASE_CLAIMS);
  // у Node — українською як є
  const fill = (k, v) => String(k).replace(/\{(\w+)\}/g, (m, x) => (v && x in v ? v[x] : m));
  const T = (k, v) => (root.BASE_T ? root.BASE_T(k, v) : fill(k, v));
  const LAB = (s) => (root.BASE_LAB ? root.BASE_LAB(s) : s);
  const NUM = (v) => (root.BASE_NUM ? root.BASE_NUM(v) : String(Math.round(v * 100) / 100));
  // Усе нижче будується для однієї бази: make(M) повертає її екземпляр. pad — додаткове поле навколо ділянок
  // у плитках (редактор, інструмент «Ділянки»: щоб було куди навести нову ділянку)
  function make(M, pad = 0) {
    const B = M.bounds, UI = M.ui || {};
    const S = UI.planScale || 26; // пікселів на плиту
    const X0 = B.x0 - 1.6 - pad, X1 = B.x1 + 1.6 + pad, Y0 = B.y0 - 2.6 - pad, Y1 = B.y1 + 1.2 + pad;
    const W = (X1 - X0) * S, H = (Y1 - Y0) * S;
    const px = (x) => ((x - X0) * S).toFixed(1);
    const py = (y) => ((Y1 - y) * S).toFixed(1);
    const pts = (arr) => arr.map((p) => px(p.x) + ',' + py(p.y)).join(' ');
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const top = (r) => r.z0 + r.h;
    const roofTop = (r) => top(r) + (r.crown ? r.crown.h : 0); // з верхнім ярусом даху
    const levelOf = (key) => M.levels.find((l) => l.key === key) || M.levels[0];
    const tileKey = (t) => M.centroid(t.p).x.toFixed(3) + ',' + M.centroid(t.p).y.toFixed(3);

    function itemCorners(it) {
      const a = (it.ang * Math.PI) / 180;
      const u = M.V(Math.cos(a), Math.sin(a)), v = M.V(-Math.sin(a), Math.cos(a));
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) =>
        M.V(it.c.x + (u.x * s * it.w) / 2 + (v.x * t * it.d) / 2, it.c.y + (u.y * s * it.w) / 2 + (v.y * t * it.d) / 2)
      );
    }
    const along = (it, s, t) => {
      const a = (it.ang * Math.PI) / 180;
      return M.V(it.c.x + Math.cos(a) * s - Math.sin(a) * t, it.c.y + Math.sin(a) * s + Math.cos(a) * t);
    };

    // Що показувати на рівні: підлоги рівня, зали що проходять крізь нього, дахи нижчих приміщень і привид.
    function roomsFor(key) {
      if (key === 'r') {
        const all = M.rooms.slice().sort((a, b) => top(a) - top(b) || a.z0 - b.z0);
        return { draw: [], through: [], roofs: all, ghost: [], roofMode: true };
      }
      const L = levelOf(key);
      return {
        L,
        draw: M.rooms.filter((r) => r.z0 >= L.z0 && r.z0 < L.z1),
        through: M.rooms.filter((r) => r.h > 0 && r.z0 < L.z0 && top(r) > L.z0),
        roofs: M.rooms.filter((r) => r.h > 0 && (r.roof === 'solid' || r.roof === 'shield') && roofTop(r) >= L.z0 && roofTop(r) < L.z1 && r.z0 < L.z0),
        ghost: L.z0 > 0 ? M.rooms.filter((r) => top(r) <= L.z0 && r.h > 0) : [],
        // на землі — контур ангарів, що звисають над обривом
        over: L.z0 === 0 ? M.rooms.filter((r) => r.overhang) : [],
      };
    }

    // Чи діє проріз на цьому рівні плану.
    function openingAt(room, o, z0, z1) {
      const lo = o.z0 !== undefined ? o.z0 : room.z0;
      // у палуби (h = 0) відкритий край діє на висоту парапету
      const hi = o.z1 !== undefined ? o.z1 : o.type === 'door' ? room.z0 + 2.5 : Math.max(top(room), room.z0 + 1);
      return lo < z1 && hi > z0;
    }

    function wallSvg(room, cls, z0, z1) {
      let out = '';
      for (const e of M.roomEdges(room)) {
        const types = e.open.filter((o) => openingAt(room, o, z0, z1)).map((o) => o.type);
        const seg = `x1="${px(e.a.x)}" y1="${py(e.a.y)}" x2="${px(e.b.x)}" y2="${py(e.b.y)}"`;
        if (types.includes('open')) continue;
        if (types.includes('shield')) out += `<line class="op-shield" ${seg}/>`;
        else if (types.includes('balcony')) out += `<line class="parapet" ${seg}/>`;
        else if (types.includes('door')) out += `<line class="op-door" ${seg}/>`;
        else out += `<line class="${cls}" ${seg}/>`;
      }
      return out;
    }

    function stairsSvg(it) {
      const c = itemCorners(it);
      let s = `<g class="it it-stairs"><title>${esc(T('{name}: з +{from} на +{to}', { name: LAB(it.name), from: NUM(it.from), to: NUM(it.to) }))}</title><polygon points="${pts(c)}"/>`;
      const n = Math.max(3, Math.round(it.w * 2.2));
      for (let i = 1; i < n; i++) {
        const t = -it.w / 2 + (it.w * i) / n;
        const a = along(it, t, -it.d / 2), b = along(it, t, it.d / 2);
        s += `<line class="step" x1="${px(a.x)}" y1="${py(a.y)}" x2="${px(b.x)}" y2="${py(b.y)}"/>`;
      }
      const a = along(it, -it.w / 2 + 0.2, 0), b = along(it, it.w / 2 - 0.25, 0);
      s += `<line class="arrow" x1="${px(a.x)}" y1="${py(a.y)}" x2="${px(b.x)}" y2="${py(b.y)}" marker-end="url(#arrowHead)"/>`;
      return s + '</g>';
    }

    function itemSvg(it) {
      if (it.kind === 'stairs') return stairsSvg(it);
      const c = itemCorners(it);
      let s = `<g class="it it-${it.kind}"><title>${esc(LAB(it.full || it.name))}</title><polygon points="${pts(c)}"/>`;
      if (it.kind === 'turbine') {
        const a = M.V(it.c.x - 0.42 * it.w, it.c.y), b = M.V(it.c.x + 0.42 * it.w, it.c.y);
        s += `<line class="rotor" x1="${px(a.x)}" y1="${py(a.y)}" x2="${px(b.x)}" y2="${py(b.y)}"/>`;
        s += `<circle class="hub" cx="${px(it.c.x)}" cy="${py(it.c.y)}" r="${(0.1 * S).toFixed(1)}"/>`;
      } else if (it.kind === 'windtrap') {
        s += `<circle class="hub" cx="${px(it.c.x)}" cy="${py(it.c.y)}" r="${(0.4 * it.w * S).toFixed(1)}"/>`;
      } else if (it.kind === 'pad') {
        s += `<circle class="pad-ring" cx="${px(it.c.x)}" cy="${py(it.c.y)}" r="${(1.6 * S).toFixed(1)}"/>`;
        s += `<text class="pad-h" x="${px(it.c.x)}" y="${py(it.c.y - 0.42)}">H</text>`;
      } else if (it.kind === 'hatch') {
        s += `<line class="step" x1="${px(c[0].x)}" y1="${py(c[0].y)}" x2="${px(c[2].x)}" y2="${py(c[2].y)}"/>`;
      }
      return s + '</g>';
    }

    function itemLines(it) {
      const name = LAB(it.name);
      const words = name.split(' ');
      if (words.length < 2 || name.length * 4.9 <= Math.max(it.w, it.d) * S * 0.92) return [name];
      const k = Math.ceil(words.length / 2);
      return [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    }
    const box = (cx, cy, w, h) => ({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });
    const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

    function tilesSvg(r, asRoof = false) {
      const rim = new Set((r.rim || []).map(tileKey));
      const sky = new Set(asRoof ? (r.skylight || []).map(tileKey) : []);
      const crown = new Set(asRoof && r.crown ? r.crown.tiles.map(tileKey) : []);
      const shield = r.group === 'shield' || (asRoof && r.roof === 'shield');
      let s = '';
      for (const t of r.tiles) {
        const k = tileKey(t);
        const cls = (t.k === 's' ? 'sq' : 'tri') + (rim.has(k) ? ' rim' : '') + (crown.has(k) ? ' crown' : '') + (shield || sky.has(k) ? ' shieldfill' : '');
        s += `<polygon class="${cls}" points="${pts(t.p)}"/>`;
      }
      // уступ вищого ярусу даху
      if (crown.size) for (const e of M.boundaryEdges(r.crown.tiles)) s += `<line class="step-edge" x1="${px(e.a.x)}" y1="${py(e.a.y)}" x2="${px(e.b.x)}" y2="${py(e.b.y)}"/>`;
      return s;
    }

    /** початок SVG плану: візерунки, тло, сітка */
    function head() {
      let s = `<svg class="plan" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(T('План бази'))}">`;
      s += `<defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="8" class="hatch-ln"/></pattern>
        <pattern id="shieldHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="7" height="7" class="shield-bg"/><line x1="0" y1="0" x2="0" y2="7" class="shield-ln"/></pattern>
        <pattern id="slope" width="6" height="6" patternUnits="userSpaceOnUse"><line x1="0" y1="3" x2="6" y2="3" class="slope-ln"/></pattern>
        <marker id="arrowHead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="arrow-head"/></marker>
      </defs>`;
      s += `<rect class="bg" x="0" y="0" width="${W.toFixed(0)}" height="${H.toFixed(0)}"/>`;

      s += '<g class="grid">';
      for (let x = Math.ceil(X0); x <= X1; x++) s += `<line x1="${px(x)}" y1="0" x2="${px(x)}" y2="${H.toFixed(0)}"/>`;
      for (let y = Math.ceil(Y0); y <= Y1; y++) s += `<line x1="0" y1="${py(y)}" x2="${W.toFixed(0)}" y2="${py(y)}"/>`;
      s += '</g>';
      return s;
    }
    /** кінець плану: координати (опція), ділянки, підписи фронту й розміру */
    function tail(opts, roofMode) {
      let s = '';
      // координати клітинок (опція): стовпці A… зліва направо, ряди 1… від фронту
      const nx = B.x1 - B.x0, ny = B.y1 - B.y0;
      if (opts.coords) {
        s += '<g class="coords">';
        for (let i = 0; i < nx; i++) {
          const c = String.fromCharCode(65 + i), x = px(B.x0 + i + 0.5);
          s += `<text x="${x}" y="${py(B.y1 + 0.35)}">${c}</text><text x="${x}" y="${py(B.y0 - 0.75)}">${c}</text>`;
        }
        for (let j = 0; j < ny; j++) {
          const y = py(B.y0 + j + 0.5);
          s += `<text x="${px(B.x0 - 0.55)}" y="${y}">${j + 1}</text><text x="${px(B.x1 + 0.55)}" y="${y}">${j + 1}</text>`;
        }
        for (let x = B.x0; x <= B.x1; x++) s += `<line x1="${px(x)}" y1="${py(B.y0)}" x2="${px(x)}" y2="${py(B.y1)}"/>`;
        for (let y = B.y0; y <= B.y1; y++) s += `<line x1="${px(B.x0)}" y1="${py(y)}" x2="${px(B.x1)}" y2="${py(y)}"/>`;
        s += '</g>';
      }

      // рамки ділянок з точками на кутах
      s += '<g class="claims">';
      const dots = new Set();
      for (const c of M.claims) {
        s += `<rect x="${px(c.x)}" y="${py(c.y + c.d)}" width="${c.w * S}" height="${c.d * S}"/>`;
        for (const [x, y] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.d], [c.x + c.w, c.y + c.d]]) dots.add(x + ',' + y);
      }
      for (const d of dots) { const [x, y] = d.split(',').map(Number); s += `<circle cx="${px(x)}" cy="${py(y)}" r="4"/>`; }
      s += '</g>';

      const annoY = roofMode ? B.y0 - 2.1 : B.y0 - 1.5;
      const nc = M.claims.length;
      // «N ділянок» рахуємо мовою сайту; свій підпис бази («2 × 3 ділянки») — як є
      const claims = !UI.claimsText || /^\d+\s+\S+$/.test(UI.claimsText) ? (root.BASE_CLAIMS ? root.BASE_CLAIMS(nc) : nc === 1 ? '1 ділянка' : `${nc} ділянок`) : UI.claimsText;
      s += `<g class="anno">
        ${roofMode ? '' : `<text x="${px((B.x0 + B.x1) / 2)}" y="${py(B.y0 - 1.5)}" class="front">▼ ${esc(T('ФРОНТ · виїзд'))}</text>`}
        <text x="${px(B.x0)}" y="${py(annoY)}" text-anchor="start">${esc(T('{x} × {y} плит', { x: nx, y: ny }))}</text>
        <text x="${px(B.x1)}" y="${py(annoY)}" text-anchor="end">${esc(claims)}</text>
      </g>`;
      return s;
    }

    function render(opts) {
      if (M.format === 2) return renderPieces(opts);
      const key = opts.level || 'g';
      const sel = roomsFor(key);
      const L = sel.L || { z0: M.heights.TOP, z1: 99 };
      const hl = opts.highlight;
      // focus (редактор): те, що на інших поверхах (дахи нижчих, високі зали знизу, привид), — тло, притемнене (.ctx);
      // на «Даху» правиться лише те, що від його висоти вгору — решта дахів теж тло
      const ctx = opts.focus ? ' ctx' : '';
      const ctxOf = (r) => (opts.focus && (!sel.roofMode || r.z0 < L.z0) ? ' ctx' : '');
      let s = head();

      if (sel.ghost.length) {
        s += `<g class="ghost${ctx}">`;
        for (const r of sel.ghost) for (const t of r.tiles) s += `<polygon points="${pts(t.p)}"/>`;
        s += '</g>';
      }

      // дахи нижчих приміщень на цьому рівні (у режимі "Дах" — усе зверху вниз)
      for (const r of sel.roofs) {
        const dim = hl && hl !== r.id ? ' dim' : '';
        s += `<g class="room roofs${sel.roofMode ? '' : ' roof-under'}${dim}${ctxOf(r)}" data-room="${r.id}"><title>${esc(r.name)}</title>${tilesSvg(r, true)}</g>`;
      }
      for (const r of sel.through) {
        s += `<g class="room through${hl && hl !== r.id ? ' dim' : ''}${ctx}" data-room="${r.id}"><title>${esc(r.name)}</title>`;
        for (const t of r.tiles) s += `<polygon points="${pts(t.p)}" fill="url(#hatch)"/>`;
        s += '</g>';
      }
      for (const r of sel.over || []) {
        s += `<g class="room overhead${hl && hl !== r.id ? ' dim' : ''}${ctx}" data-room="${r.id}"><title>${esc(T('{name}: над обривом, підлога +{z}', { name: r.name, z: NUM(r.z0) }))}</title>`;
        for (const t of r.tiles) s += `<polygon points="${pts(t.p)}"/>`;
        for (const e of M.boundaryEdges(r.tiles)) s += `<line x1="${px(e.a.x)}" y1="${py(e.a.y)}" x2="${px(e.b.x)}" y2="${py(e.b.y)}"/>`;
        s += '</g>';
      }
      for (const r of sel.draw) {
        const dim = hl && hl !== r.id ? ' dim' : '';
        s += `<g class="room g-${r.group}${dim}" data-room="${r.id}"><title>${esc(r.name)}</title>${tilesSvg(r)}`;
        if (r.profile) {
          const ys = r.tiles.flatMap((t) => t.p.map((p) => p.y));
          const p = r.profile;
          // смуги пандусів, крім рівних заїздів (flat)
          const cuts = [Math.min(...ys), ...(p.flat || []).flat(), Math.max(...ys)];
          for (let i = 0; i < cuts.length - 1; i += 2) {
            const y0 = cuts[i], y1 = cuts[i + 1];
            for (const [a, b] of [[p.x0, p.x0 + p.ch], [p.x1 - p.ch, p.x1]])
              s += `<rect class="slope" x="${px(a)}" y="${py(y1)}" width="${((b - a) * S).toFixed(1)}" height="${((y1 - y0) * S).toFixed(1)}" fill="url(#slope)"/>`;
          }
        }
        s += '</g>';
      }

      // стіни і парапети
      s += '<g class="walls">';
      if (sel.roofMode) {
        for (const r of sel.roofs)
          if (r.h === 0 || r.roof !== 'none') s += wallSvg(r, (r.h > 0 ? 'wall' : 'parapet') + ctxOf(r), top(r) - 0.01, top(r) + 0.01);
      } else {
        for (const r of sel.through) s += wallSvg(r, 'wall' + ctx, L.z0, L.z1);
        for (const r of sel.draw) s += wallSvg(r, r.h > 0 ? 'wall' : 'parapet', r.z0, r.h > 0 ? Math.min(top(r), L.z1) : r.z0 + 1);
      }
      if (hl) {
        const r = [...sel.draw, ...sel.through, ...sel.roofs].find((x) => x.id === hl);
        if (r) for (const e of M.boundaryEdges(r.tiles)) s += `<line class="hl-edge" x1="${px(e.a.x)}" y1="${py(e.a.y)}" x2="${px(e.b.x)}" y2="${py(e.b.y)}"/>`;
      }
      s += '</g>';

      // обладнання
      const shownItems = [];
      if (opts.items) {
        s += '<g class="items">';
        const inLevel = (it) => (it.z !== undefined ? it.z >= L.z0 && it.z < L.z1 : true);
        if (sel.roofMode) {
          // станції приміщень, що стоять на даху (палуби, місток), і «дахові»
          for (const r of sel.roofs) if (r.z0 >= L.z0) for (const it of r.items || []) if (it.kind !== 'light') s += itemSvg(it);
          for (const it of M.roofItems) s += itemSvg(it);
        } else {
          for (const r of sel.draw)
            for (const it of r.items || []) if (it.kind !== 'light' && inLevel(it)) { s += itemSvg(it); shownItems.push(it); }
          for (const r of sel.through) for (const it of r.items || []) if (it.kind === 'stairs') s += itemSvg(it);
          for (const it of M.roofItems) if (inLevel(it)) s += itemSvg(it);
        }
        s += '</g>';
      }

      // підписи: спершу приміщення, потім техніка там, де вільно
      if (opts.labels) {
        s += '<g class="labels">';
        const taken = [];
        const list = sel.roofMode ? [] : [...sel.draw, ...sel.through.filter((r) => r.group !== 'tower' || key !== 't'), ...(sel.over || [])];
        for (const r of list) {
          const p = M.labelPoint(r);
          const name = r.short || r.name;
          const sub = (sel.over || []).includes(r)
            ? T('над обривом · +{z}', { z: NUM(r.z0) })
            : sel.through.includes(r)
            ? T('висота до +{z}', { z: NUM(top(r)) })
            : r.h > 0 ? T('{area} пл · +{from}…+{to}', { area: Math.round(M.roomArea(r)), from: NUM(r.z0), to: NUM(top(r)) }) : r.group === 'shield' ? T('стеля гаража') : r.z0 === 0 ? T('фундамент · просто неба') : T('палуба +{z}', { z: NUM(r.z0) });
          const X = +px(p.x), Y = +py(p.y);
          taken.push(box(X, Y - 1, Math.max(name.length * 6.7, sub.length * 5.5) + 6, 30));
          s += `<text class="lbl${hl === r.id ? ' hl' : ''}" x="${X}" y="${py(p.y + 0.15)}">${esc(name)}</text>`;
          s += `<text class="lbl-sub" x="${X}" y="${py(p.y - 0.42)}">${esc(sub)}</text>`;
        }
        for (const it of shownItems) {
          if (['storage', 'stairs', 'pad', 'gate', 'furniture', 'hatch', 'console'].includes(it.kind)) continue;
          const lines = itemLines(it);
          const w = Math.max(...lines.map((l) => l.length)) * 4.9 + 4, h = lines.length * 10 + 2;
          const X = +px(it.c.x), Y = +py(it.c.y);
          const b = box(X, Y, w, h);
          if (taken.some((t) => hit(t, b))) continue;
          taken.push(b);
          const y0 = Y - ((lines.length - 1) * 10) / 2 + 3;
          lines.forEach((ln, i) => { s += `<text class="it-label" x="${X}" y="${(y0 + i * 10).toFixed(1)}">${esc(ln)}</text>`; });
        }
        if (sel.roofMode) {
          const tag = (x, y, t1, t2) =>
            `<text class="lbl" x="${px(x)}" y="${py(y)}">${esc(t1)}</text><text class="lbl-sub" x="${px(x)}" y="${py(y - 0.55)}">${esc(t2)}</text>`;
          for (const t of UI.roofTags || []) s += tag(...t); // підписи даху — з даних бази
        }
        s += '</g>';
      }

      s += tail(opts, sel.roofMode);
      return s + '</svg>';
    }

    // ---------- план бази з деталей (format 2) ----------
    // поверх: плити на висоті рівня (кольором приміщень), стіни й прорізи, що стоять на ньому, скати й сходи,
    // станції; тло — дахи нижчих, високі зали знизу (штрих), привид; «Дах» — вигляд згори: найвищі плити
    function renderPieces(opts) {
      const P = root.PIECES;
      const key = opts.level || 'g';
      const roofMode = key === 'r';
      const L = levelOf(key);
      const hl = opts.highlight;
      const ctx = opts.focus ? ' ctx' : '';
      const fp = new Map(M.pieces.map((p) => [p, P.footprint(p)]));
      const shape = (p) => P.SHAPES[p.shape] || {};
      const isSlab = (p) => { const s = shape(p); return s.family === 'slab' || (s.family === 'shield' && s.at === 'tile'); };
      const tileCls = (p) => { const s = shape(p); return s.family === 'shield' ? 'sq shieldfill' : s.tile === 't' ? 'tri' : 'sq'; };
      const zoneOfTile = new Map(); // висота@ключ плитки → зона (псевдокімната)
      for (const r of M.rooms) for (const t of r.tiles) zoneOfTile.set(r.z0 + '@' + P.keyOf(M.centroid(t.p)), r);
      let s = head();

      if (roofMode) {
        // згори: для кожної плитки — найвища плита чи скат
        const top = new Map();
        for (const p of M.pieces) {
          const f = fp.get(p), sh = shape(p);
          if (f.at !== 'tile') continue;
          const k = P.keyOf(p);
          const z = f.z1;
          if (!top.has(k) || top.get(k).z < z) top.set(k, { p, z, slope: sh.family === 'slope', lean: sh.kind === 'lean' });
        }
        s += `<g class="room roofs">`;
        for (const { p, slope, lean } of [...top.values()].sort((a, b) => a.z - b.z)) s += lean ? `<polygon class="lean" points="${pts(fp.get(p).poly)}"/>` : `<polygon class="${slope ? 'tri' : tileCls(p)}" points="${pts(fp.get(p).poly)}"${slope ? ' fill="url(#slope)"' : ''}/>`;
        s += '</g><g class="walls">';
        for (const p of M.pieces) {
          const sh = shape(p), f = fp.get(p);
          if (f.at !== 'edge' || sh.family !== 'rail') continue;
          s += `<line class="parapet" x1="${px(f.seg.a.x)}" y1="${py(f.seg.a.y)}" x2="${px(f.seg.b.x)}" y2="${py(f.seg.b.y)}"/>`;
        }
        s += '</g>';
        if (opts.items) { s += '<g class="items">'; for (const it of M.roofItems) s += itemSvg(it); s += '</g>'; }
        if (opts.labels) {
          s += '<g class="labels">';
          for (const t of UI.roofTags || []) s += `<text class="lbl" x="${px(t[0])}" y="${py(t[1])}">${esc(t[2])}</text><text class="lbl-sub" x="${px(t[0])}" y="${py(t[1] - 0.55)}">${esc(t[3])}</text>`;
          s += '</g>';
        }
        return s + tail(opts, true) + '</svg>';
      }

      const inBand = (z) => z >= L.z0 - 1e-6 && z < L.z1 - 1e-6;
      // привид: приміщення повністю нижче; високі зали знизу крізь рівень — штрих
      const ghost = L.z0 > 0 ? M.rooms.filter((r) => r.h > 0 && r.z0 + r.h <= L.z0 + 1e-6) : [];
      const through = M.rooms.filter((r) => r.h > 0 && r.z0 < L.z0 - 1e-6 && r.z0 + r.h > L.z0 + 1e-6);
      if (ghost.length) { s += `<g class="ghost${ctx}">`; for (const r of ghost) for (const t of r.tiles) s += `<polygon points="${pts(t.p)}"/>`; s += '</g>'; }
      // дахи нижчих у межах рівня (вище за підлогу рівня)
      const under = M.pieces.filter((p) => isSlab(p) && p.z > L.z0 + 1e-6 && p.z < L.z1 - 1e-6);
      if (under.length) { s += `<g class="room roofs roof-under${ctx}">`; for (const p of under) s += `<polygon class="${tileCls(p)}" points="${pts(fp.get(p).poly)}"/>`; s += '</g>'; }
      for (const r of through) {
        s += `<g class="room through${hl && hl !== r.id ? ' dim' : ''}${ctx}" data-room="${r.id}"><title>${esc(r.name)}</title>`;
        for (const t of r.tiles) s += `<polygon points="${pts(t.p)}" fill="url(#hatch)"/>`;
        s += '</g>';
      }
      // підлоги рівня: плитки приміщень — групою приміщення (колір призначення), решта — окремо
      const floorHere = M.pieces.filter((p) => isSlab(p) && Math.abs(p.z - L.z0) < 1e-6);
      const byZone = new Map();
      const loose = [];
      for (const p of floorHere) {
        const r = zoneOfTile.get(L.z0 + '@' + P.keyOf(p));
        if (r) { if (!byZone.has(r)) byZone.set(r, []); byZone.get(r).push(p); } else loose.push(p);
      }
      if (loose.length) { s += '<g class="room">'; for (const p of loose) s += `<polygon class="${tileCls(p)}" points="${pts(fp.get(p).poly)}"/>`; s += '</g>'; }
      for (const [r, list] of byZone) {
        const dim = hl && hl !== r.id ? ' dim' : '';
        s += `<g class="room g-${r.group}${dim}" data-room="${r.id}"><title>${esc(r.name)}</title>`;
        for (const p of list) s += `<polygon class="${tileCls(p)}" points="${pts(fp.get(p).poly)}"/>`;
        s += '</g>';
      }
      // скати, сходи, пандуси на рівні — штрихом
      const inclines = M.pieces.filter((p) => shape(p).family === 'slope' && inBand(p.z));
      if (inclines.length) {
        s += '<g class="room">';
        // похила стіна — смугою стіни (низ на зовнішньому краї), решта — штрихом
        for (const p of inclines) s += shape(p).kind === 'lean' ? `<polygon class="lean" points="${pts(fp.get(p).poly)}"/>` : `<polygon class="slope" points="${pts(fp.get(p).poly)}" fill="url(#slope)"/>`;
        s += '</g>';
      }

      // стіни: на кожному краї — найнижча деталь у межах рівня (те, що бачиш на висоті підлоги)
      s += '<g class="walls">';
      const lowest = new Map();
      for (const p of M.pieces) {
        const f = fp.get(p), sh = shape(p);
        if (f.at !== 'edge' || !inBand(p.z)) continue;
        const k = M.edgeKey(f.seg.a, f.seg.b);
        if (!lowest.has(k) || lowest.get(k).p.z > p.z) lowest.set(k, { p, f, sh });
      }
      for (const { p, f, sh } of lowest.values()) {
        const seg = `x1="${px(f.seg.a.x)}" y1="${py(f.seg.a.y)}" x2="${px(f.seg.b.x)}" y2="${py(f.seg.b.y)}"`;
        const above = p.z > L.z0 + 0.5; // стіна не з підлоги рівня (над прорізом, антресоль) — блідіше
        let cls = 'wall';
        if (sh.family === 'shield') cls = 'op-shield';
        else if (sh.family === 'rail' || sh.family === 'ladder' || (sh.family === 'wall' && sh.h < 1 && !sh.hole)) cls = 'parapet';
        else if (sh.kind === 'door') cls = 'op-door';
        else if (sh.kind === 'open') continue; // прохід — без лінії
        s += `<line class="${cls}${above ? ctx : ''}" ${seg}/>`;
      }
      if (hl) {
        const r = M.rooms.find((x) => x.id === hl);
        if (r) for (const e of M.boundaryEdges(r.tiles)) s += `<line class="hl-edge" x1="${px(e.a.x)}" y1="${py(e.a.y)}" x2="${px(e.b.x)}" y2="${py(e.b.y)}"/>`;
      }
      s += '</g>';

      const shownItems = [];
      if (opts.items) {
        s += '<g class="items">';
        for (const it of M.items) {
          const z = it.z !== undefined ? it.z : 0;
          if (it.kind === 'light') continue;
          if (inBand(z) || (it.kind === 'stairs' && it.from < L.z0 && it.to > L.z0)) { s += itemSvg(it); if (inBand(z)) shownItems.push(it); }
        }
        s += '</g>';
      }
      if (opts.labels) {
        s += '<g class="labels">';
        const taken = [];
        const list = [...M.rooms.filter((r) => Math.abs(r.z0 - L.z0) < 1e-6 && r.tiles.length), ...through.filter((r) => r.group !== 'tower')];
        for (const r of list) {
          const p = r.label || M.labelPoint(r);
          const name = r.short || r.name;
          const sub = through.includes(r) ? T('висота до +{z}', { z: NUM(r.z0 + r.h) }) : r.h > 0 ? T('{area} пл · +{from}…+{to}', { area: Math.round(M.roomArea(r)), from: NUM(r.z0), to: NUM(r.z0 + r.h) }) : r.z0 === 0 ? T('просто неба') : T('палуба +{z}', { z: NUM(r.z0) });
          const X = +px(p.x), Y = +py(p.y);
          taken.push(box(X, Y - 1, Math.max(name.length * 6.7, sub.length * 5.5) + 6, 30));
          s += `<text class="lbl${hl === r.id ? ' hl' : ''}" x="${X}" y="${py(p.y + 0.15)}">${esc(name)}</text>`;
          s += `<text class="lbl-sub" x="${X}" y="${py(p.y - 0.42)}">${esc(sub)}</text>`;
        }
        for (const it of shownItems) {
          if (['storage', 'stairs', 'pad', 'gate', 'furniture', 'hatch', 'console'].includes(it.kind)) continue;
          const lines = itemLines(it);
          const w = Math.max(...lines.map((l) => l.length)) * 4.9 + 4, h = lines.length * 10 + 2;
          const X = +px(it.c.x), Y = +py(it.c.y);
          const b = box(X, Y, w, h);
          if (taken.some((t) => hit(t, b))) continue;
          taken.push(b);
          const y0 = Y - ((lines.length - 1) * 10) / 2 + 3;
          lines.forEach((ln, i) => { s += `<text class="it-label" x="${X}" y="${(y0 + i * 10).toFixed(1)}">${esc(ln)}</text>`; });
        }
        s += '</g>';
      }
      return s + tail(opts, false) + '</svg>';
    }

    return { render };
  }

  root.PLAN2D = { make };
})(typeof window !== 'undefined' ? window : globalThis);
