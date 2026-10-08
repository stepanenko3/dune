/*
 * 2D-план у стилі скріна 1: сині квадрати, помаранчеві трикутники, білі шви,
 * світла сітка, рамки ділянок 10x10 з точками на кутах.
 */
(function (root) {
  'use strict';
  const M = root.BASE;
  const S = 24; // пікселів на плиту
  const X0 = -17, X1 = 17, Y0 = -2.4, Y1 = 21.6;
  const W = (X1 - X0) * S, H = (Y1 - Y0) * S;
  const px = (x) => ((x - X0) * S).toFixed(1);
  const py = (y) => ((Y1 - y) * S).toFixed(1);
  const pts = (arr) => arr.map((p) => px(p.x) + ',' + py(p.y)).join(' ');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const { G, UP } = M.heights;

  function itemCorners(it) {
    const a = (it.ang * Math.PI) / 180;
    const u = M.V(Math.cos(a), Math.sin(a)), v = M.V(-Math.sin(a), Math.cos(a));
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) =>
      M.V(it.c.x + (u.x * s * it.w) / 2 + (v.x * t * it.d) / 2, it.c.y + (u.y * s * it.w) / 2 + (v.y * t * it.d) / 2)
    );
  }

  // Які приміщення показувати на рівні і як.
  function roomsFor(level) {
    const top = (r) => r.z0 + r.h;
    if (level === 'g') return { draw: M.rooms.filter((r) => r.z0 === 0), through: [], ghost: [] };
    if (level === 'u')
      return {
        draw: M.rooms.filter((r) => r.z0 >= G && r.z0 < G + UP),
        through: M.rooms.filter((r) => r.z0 < G && top(r) > G),
        ghost: M.rooms.filter((r) => r.z0 === 0),
      };
    // дах: усе, відсортоване за висотою верхньої поверхні
    const all = M.rooms.slice();
    all.sort((a, b) => top(a) - top(b) || a.z0 - b.z0);
    return { draw: all, through: [], ghost: [], roof: true };
  }

  function wallSvg(room, cls) {
    let out = '';
    for (const e of M.roomEdges(room)) {
      const types = e.open.map((o) => o.type);
      const seg = `x1="${px(e.a.x)}" y1="${py(e.a.y)}" x2="${px(e.b.x)}" y2="${py(e.b.y)}"`;
      if (types.includes('open')) continue;
      if (types.includes('shield')) out += `<line class="op-shield" ${seg}/>`;
      else if (types.includes('glass')) out += `<line class="op-glass" ${seg}/>`;
      else if (e.open.some((o) => o.type === 'door' && (o.z0 === undefined || o.z0 === room.z0)))
        out += `<line class="op-door" ${seg}/>`;
      else out += `<line class="${cls}" ${seg}/>`;
    }
    return out;
  }

  // Підпис предмета: рядки, що влазять у прямокутник.
  function itemLines(it) {
    const words = it.name.split(' ');
    if (words.length < 2 || it.name.length * 4.9 <= Math.max(it.w, it.d) * S * 0.92) return [it.name];
    const k = Math.ceil(words.length / 2);
    return [words.slice(0, k).join(' '), words.slice(k).join(' ')];
  }

  function itemSvg(it) {
    const c = itemCorners(it);
    let s = `<g class="it it-${it.kind}"><title>${esc(it.full || it.name)}</title><polygon points="${pts(c)}"/>`;
    if (it.kind === 'turbine') {
      const a = M.V(it.c.x - 0.75, it.c.y), b = M.V(it.c.x + 0.75, it.c.y);
      s += `<line class="rotor" x1="${px(a.x)}" y1="${py(a.y)}" x2="${px(b.x)}" y2="${py(b.y)}"/>`;
      s += `<circle class="hub" cx="${px(it.c.x)}" cy="${py(it.c.y)}" r="${(0.16 * S).toFixed(1)}"/>`;
    } else if (it.kind === 'windtrap') {
      s += `<circle class="hub" cx="${px(it.c.x)}" cy="${py(it.c.y)}" r="${(0.62 * S).toFixed(1)}"/>`;
    } else if (it.kind === 'pad') {
      s += `<circle class="pad-ring" cx="${px(it.c.x)}" cy="${py(it.c.y)}" r="${(1.6 * S).toFixed(1)}"/>`;
      s += `<text class="pad-h" x="${px(it.c.x)}" y="${py(it.c.y - 0.42)}">H</text>`;
    }
    return s + '</g>';
  }

  // Прямокутники підписів у пікселях для перевірки накладань.
  const box = (cx, cy, w, h) => ({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  function render(opts) {
    const level = opts.level || 'g';
    const variant = M.variants[opts.variant || 'terrace'];
    const sel = roomsFor(level);
    const hl = opts.highlight;
    let s = `<svg class="plan" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="План бази">`;
    s += `<defs>
      <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="8" class="hatch-ln"/></pattern>
      <pattern id="shieldHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="7" height="7" class="shield-bg"/><line x1="0" y1="0" x2="0" y2="7" class="shield-ln"/></pattern>
    </defs>`;
    s += `<rect class="bg" x="0" y="0" width="${W}" height="${H}"/>`;

    // сітка
    s += '<g class="grid">';
    for (let x = Math.ceil(X0); x <= X1; x++) s += `<line x1="${px(x)}" y1="0" x2="${px(x)}" y2="${H}"/>`;
    for (let y = Math.ceil(Y0); y <= Y1; y++) s += `<line x1="0" y1="${py(y)}" x2="${W}" y2="${py(y)}"/>`;
    s += '</g>';

    // привид першого ярусу під верхнім
    if (sel.ghost.length) {
      s += '<g class="ghost">';
      for (const r of sel.ghost) for (const t of r.tiles) s += `<polygon points="${pts(t.p)}"/>`;
      s += '</g>';
    }

    // приміщення, що проходять крізь рівень (високі зали, башти)
    for (const r of sel.through) {
      s += `<g class="room through${hl && hl !== r.id ? ' dim' : ''}" data-room="${r.id}"><title>${esc(r.name)}</title>`;
      for (const t of r.tiles) s += `<polygon points="${pts(t.p)}" fill="url(#hatch)"/>`;
      s += wallSvg(r, 'wall') + '</g>';
    }

    // плитки
    for (const r of sel.draw) {
      const dim = hl && hl !== r.id ? ' dim' : '';
      const isShield = r.group === 'shield';
      s += `<g class="room g-${r.group}${dim}${hl === r.id ? ' hl' : ''}" data-room="${r.id}"><title>${esc(r.name)}</title>`;
      for (const t of r.tiles) {
        const fill = isShield ? ' fill="url(#shieldHatch)"' : '';
        s += `<polygon class="${t.k === 's' ? 'sq' : 'tri'}"${fill} points="${pts(t.p)}"/>`;
      }
      s += '</g>';
    }
    // стіни поверх плиток (щоб сусідні приміщення не перекривали)
    s += '<g class="walls">';
    for (const r of sel.draw) {
      if (sel.roof && r.roof === 'none' && r.h > 0) continue; // під палубами і верхніми залами
      if (r.h > 0 || r.group === 'deck') s += wallSvg(r, r.h > 0 ? 'wall' : 'parapet');
    }
    if (hl) {
      const r = [...sel.draw, ...sel.through].find((x) => x.id === hl);
      if (r) for (const e of M.boundaryEdges(r.tiles)) s += `<line class="hl-edge" x1="${px(e.a.x)}" y1="${py(e.a.y)}" x2="${px(e.b.x)}" y2="${py(e.b.y)}"/>`;
    }
    s += '</g>';

    // обладнання
    const shownItems = [];
    if (opts.items) {
      s += '<g class="items">';
      if (sel.roof) for (const it of M.roofItems) s += itemSvg(it);
      else {
        for (const r of sel.draw) for (const it of r.items || []) if (it.kind !== 'light') { s += itemSvg(it); shownItems.push(it); }
        if (level === 'u') for (const it of variant.items) { s += itemSvg(it); shownItems.push(it); }
      }
      s += '</g>';
    }

    // підписи: спершу приміщення, потім техніка там, де вільно
    if (opts.labels) {
      s += '<g class="labels">';
      const taken = [];
      const list = sel.roof ? [] : [...sel.draw, ...sel.through];
      for (const r of list) {
        const p = M.labelPoint(r);
        const name = r.id === 'terrace' ? variant.label : r.short || r.name;
        const sub = r.h > 0 ? `${Math.round(M.roomArea(r))} пл · висота ${r.h}` : r.group === 'shield' ? 'стеля гаража' : `палуба +${r.z0}`;
        const X = +px(p.x), Y = +py(p.y);
        taken.push(box(X, Y - 1, Math.max(name.length * 6.7, sub.length * 5.5) + 6, 30));
        s += `<text class="lbl${hl === r.id ? ' hl' : ''}" x="${X}" y="${py(p.y + 0.15)}">${esc(name)}</text>`;
        s += `<text class="lbl-sub" x="${X}" y="${py(p.y - 0.42)}">${esc(sub)}</text>`;
      }
      for (const it of shownItems) {
        if (['storage', 'stairs', 'pad', 'gate', 'furniture'].includes(it.kind)) continue;
        const lines = itemLines(it);
        const w = Math.max(...lines.map((l) => l.length)) * 4.9 + 4, h = lines.length * 10 + 2;
        const X = +px(it.c.x), Y = +py(it.c.y);
        const b = box(X, Y, w, h);
        if (taken.some((t) => hit(t, b))) continue;
        taken.push(b);
        const y0 = Y - ((lines.length - 1) * 10) / 2 + 3;
        lines.forEach((ln, i) => { s += `<text class="it-label" x="${X}" y="${(y0 + i * 10).toFixed(1)}">${esc(ln)}</text>`; });
      }
      if (sel.roof) {
        const tag = (x, y, t1, t2) =>
          `<text class="lbl" x="${px(x)}" y="${py(y)}">${esc(t1)}</text><text class="lbl-sub" x="${px(x)}" y="${py(y - 0.55)}">${esc(t2)}</text>`;
        s += tag(-11, 21.0, 'Вітряки ×10', 'дах залу меланжу, +7');
        s += tag(11, 21.0, 'Вітряки ×10', 'дах майстерні, +7');
        s += tag(0, 21.0, 'Вітропастки ×15', 'дах наскрізного ангара, +8');
      }
      s += '</g>';
    }

    // рамки ділянок
    s += '<g class="claims">';
    for (const c of M.claims) s += `<rect x="${px(c.x)}" y="${py(c.y + c.d)}" width="${c.w * S}" height="${c.d * S}"/>`;
    for (const x of [-15, -5, 5, 15]) for (const y of [0, 10, 20]) s += `<circle cx="${px(x)}" cy="${py(y)}" r="4"/>`;
    s += '</g>';

    // фронт і розміри
    s += `<g class="anno">
      <text x="${px(0)}" y="${py(-1.35)}" class="front">▼ ФРОНТ · виїзд</text>
      <text x="${px(-15)}" y="${py(-1.35)}" text-anchor="start">ширина 30 плит · 3 ділянки</text>
      <text x="${px(15)}" y="${py(-1.35)}" text-anchor="end">глибина 20 плит · 2 ділянки</text>
    </g>`;
    return s + '</svg>';
  }

  // Підрахунок деталей для кошторису.
  function pieceCounts() {
    const rows = [];
    const add = (name, rooms) => {
      let s = 0, t = 0;
      for (const r of rooms) for (const x of r.tiles) x.k === 's' ? s++ : t++;
      rows.push({ name, s, t });
    };
    add('Фундамент, рівень 0', M.rooms.filter((r) => r.z0 === 0));
    add('Перекриття +4 (підлоги ангарів, тераса)', M.rooms.filter((r) => r.z0 === G));
    add('Дах +7 (бічні корпуси)', M.rooms.filter((r) => r.roof === 'solid' && r.z0 + r.h === 7));
    add('Дах +8 (ангари)', M.rooms.filter((r) => r.roof === 'solid' && r.z0 + r.h === 8));
    add('Ліхтарі башт +8', M.rooms.filter((r) => r.group === 'tower' && r.z0 === 8));
    return rows;
  }

  root.PLAN2D = { render, pieceCounts };
})(typeof window !== 'undefined' ? window : globalThis);
