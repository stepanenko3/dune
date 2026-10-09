/*
 * 2D-план у стилі скріна 1: сині квадрати, помаранчеві трикутники, білі шви,
 * світла сітка, рамки ділянок 10x10 з точками на кутах.
 */
(function (root) {
  'use strict';
  const M = root.BASE;
  const S = 26; // пікселів на плиту
  const X0 = -11.6, X1 = 11.6, Y0 = -2.6, Y1 = 31.2;
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
    };
  }

  // Чи діє проріз на цьому рівні плану.
  function openingAt(room, o, z0, z1) {
    const lo = o.z0 !== undefined ? o.z0 : room.z0;
    const hi = o.z1 !== undefined ? o.z1 : o.type === 'door' ? room.z0 + 2.5 : top(room);
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
      else if (types.includes('glass')) out += `<line class="op-glass" ${seg}/>`;
      else out += `<line class="${cls}" ${seg}/>`;
    }
    return out;
  }

  function stairsSvg(it) {
    const c = itemCorners(it);
    let s = `<g class="it it-stairs"><title>${esc(it.name)}: з +${it.from} на +${it.to}</title><polygon points="${pts(c)}"/>`;
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
    let s = `<g class="it it-${it.kind}"><title>${esc(it.full || it.name)}</title><polygon points="${pts(c)}"/>`;
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
    const words = it.name.split(' ');
    if (words.length < 2 || it.name.length * 4.9 <= Math.max(it.w, it.d) * S * 0.92) return [it.name];
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

  function render(opts) {
    const key = opts.level || 'g';
    const sel = roomsFor(key);
    const L = sel.L || { z0: M.heights.TOP, z1: 99 };
    const hl = opts.highlight;
    let s = `<svg class="plan" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="План бази">`;
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

    if (sel.ghost.length) {
      s += '<g class="ghost">';
      for (const r of sel.ghost) for (const t of r.tiles) s += `<polygon points="${pts(t.p)}"/>`;
      s += '</g>';
    }

    // дахи нижчих приміщень на цьому рівні (у режимі "Дах" — усе зверху вниз)
    for (const r of sel.roofs) {
      const dim = hl && hl !== r.id ? ' dim' : '';
      s += `<g class="room roofs${sel.roofMode ? '' : ' roof-under'}${dim}" data-room="${r.id}"><title>${esc(r.name)}</title>${tilesSvg(r, true)}</g>`;
    }
    for (const r of sel.through) {
      s += `<g class="room through${hl && hl !== r.id ? ' dim' : ''}" data-room="${r.id}"><title>${esc(r.name)}</title>`;
      for (const t of r.tiles) s += `<polygon points="${pts(t.p)}" fill="url(#hatch)"/>`;
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
        if (r.h === 0 || r.roof !== 'none') s += wallSvg(r, r.h > 0 ? 'wall' : 'parapet', top(r) - 0.01, top(r) + 0.01);
    } else {
      for (const r of sel.through) s += wallSvg(r, 'wall', L.z0, L.z1);
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
      if (sel.roofMode) for (const it of M.roofItems) s += itemSvg(it);
      else {
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
      const list = sel.roofMode ? [] : [...sel.draw, ...sel.through.filter((r) => r.group !== 'tower' || key !== 't')];
      for (const r of list) {
        const p = M.labelPoint(r);
        const name = r.short || r.name;
        const sub = sel.through.includes(r)
          ? `висота до +${top(r)}`
          : r.h > 0 ? `${Math.round(M.roomArea(r))} пл · +${r.z0}…+${top(r)}` : r.group === 'shield' ? 'стеля гаража' : `палуба +${r.z0}`;
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
        s += tag(0, -0.9, 'Вітряки ×20 (1×1)', 'за горою на даху ангара грузових +13');
        s += tag(0, 30.75, 'Вітропастки ×15 (1,5×1,5)', 'дахи бічних блоків +9, дах гаража багі +5');
      }
      s += '</g>';
    }

    // рамки ділянок
    s += '<g class="claims">';
    for (const c of M.claims) s += `<rect x="${px(c.x)}" y="${py(c.y + c.d)}" width="${c.w * S}" height="${c.d * S}"/>`;
    for (const x of [-10, 0, 10]) for (const y of [0, 10, 20, 30]) s += `<circle cx="${px(x)}" cy="${py(y)}" r="4"/>`;
    s += '</g>';

    const annoY = sel.roofMode ? -2.1 : -1.5;
    s += `<g class="anno">
      ${sel.roofMode ? '' : `<text x="${px(0)}" y="${py(-1.5)}" class="front">▼ ФРОНТ · виїзд</text>`}
      <text x="${px(-10)}" y="${py(annoY)}" text-anchor="start">20 × 30 плит</text>
      <text x="${px(10)}" y="${py(annoY)}" text-anchor="end">2 × 3 ділянки</text>
    </g>`;
    return s + '</svg>';
  }

  // Підрахунок плит для кошторису.
  function pieceCounts() {
    const rows = [];
    const add = (name, rooms) => {
      let s = 0, t = 0;
      for (const r of rooms) for (const x of r.tiles) x.k === 's' ? s++ : t++;
      rows.push({ name, s, t });
    };
    const { G, CAR, BACK, TOWER, DECK, TOP } = M.heights;
    const body = M.rooms.filter((r) => r.group !== 'crown');
    add('Фундамент, рівень 0', body.filter((r) => r.z0 === 0));
    add('Підлоги і палуби +5', body.filter((r) => r.z0 === G));
    add('Ангар грузових +9', body.filter((r) => r.z0 === CAR));
    add('Дахи до +9 (зал, блоки, перехід, ангари, гараж, склад)', body.filter((r) => r.roof !== 'none' && r.z0 + r.h <= BACK));
    add('Верхній ярус дахів ангарів +9', body.filter((r) => r.crown).map((r) => ({ tiles: r.crown.tiles })));
    add('Балкони веж і місток +15', body.filter((r) => r.z0 === DECK));
    add('Дах ангара грузових +13', body.filter((r) => r.roof === 'solid' && r.z0 + r.h === TOP));
    add('Піраміда', M.rooms.filter((r) => r.group === 'crown'));
    add('Ліхтарі веж', body.filter((r) => r.z0 === TOWER));
    return rows;
  }

  root.PLAN2D = { render, pieceCounts };
})(typeof window !== 'undefined' ? window : globalThis);
