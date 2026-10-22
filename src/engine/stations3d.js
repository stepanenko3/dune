/*
 * Обриси пристроїв гри в 3D (за ігровими іконками з awakening.wiki): кожен тип — кілька простих об'ємів у кольорах гри
 * (кремовий корпус, помаранчеві смуги, темні панелі, скло). Розміри — зі станції (w × d × h): обрис вписано в її
 * габарит, тож коли розміри уточнять, форма підлаштується сама.
 * Локальні осі групи станції: x — ширина (w), z — глибина (d, перед — +z), y — угору від підлоги.
 * build(type, g, W, D, H, K): K — { THREE, mat(колір, extra) } від view3d; повертає false, якщо типу не знає.
 * typeOf(it) — ігровий тип станції: it.type, а в давніх базах — за назвою.
 */
(function (root) {
  'use strict';

  /** давні станції (з моделей до переходу на ігрові пристрої) — тип за назвою */
  const BY_NAME = {
    'Верстак': 'Fabricator_Placeable', 'Базовий верстак': 'Fabricator_Placeable', 'Фабрикатор': 'Fabricator_Placeable',
    'Фаб. виживання': 'SurvivalFabricator_Placeable', 'Фабрикатор виживання': 'SurvivalFabricator_Placeable',
    'Фаб. зброї': 'WeaponsFabricator_Placeable', 'Фабрикатор зброї': 'WeaponsFabricator_Placeable',
    'Фаб. одягу': 'WearablesFabricator_Placeable', 'Фабрикатор одягу': 'WearablesFabricator_Placeable',
    'Фабрикатор техніки': 'VehiclesFabricator_Placeable',
    'Ремонт': 'RepairStation_Placeable', 'Ремонтна станція': 'RepairStation_Placeable', 'Ресайклер': 'Recycler_Placeable',
    'Консоль суб-фіфу': 'Totem_Small_Placeable',
    'Переробник руди': 'LargeOreRefinery_Placeable', 'Великий переробник руди': 'LargeOreRefinery_Placeable',
    'Середній переробник': 'MediumOreRefinery_Placeable', 'Середній переробник руди': 'MediumOreRefinery_Placeable',
    'Хімічний': 'MediumChemicalRefinery_Placeable', 'Хімічний переробник': 'MediumChemicalRefinery_Placeable',
    'Переробник спайсу': 'LargeSpiceRefinery_Placeable', 'Великий переробник спайсу': 'LargeSpiceRefinery_Placeable',
    'Deathstill': 'Fremen_Deathstill_Placeable',
    'Цистерна': 'WaterCistern_Placeable', 'Велика вітропастка': 'LargeWindtrap_Placeable', 'Спрямований вітряк': 'WindTurbineDirectional_Placeable',
    'Генератор': 'Generator_Placeable', 'Контейнер': 'StorageContainer_Placeable',
  };
  const typeOf = (it) => (it && (it.type || BY_NAME[it.full] || BY_NAME[it.name])) || null;

  // кольори гри
  const CREAM = 0xe6dfd0, ORANGE = 0xc4652c, DARK = 0x2c2d31, BLACK = 0x1b1c1f, STEEL = 0x8d9196, SAND = 0xc9a477, GLASS = 0x9cc3d0;

  function build(type, g, W, D, H, K) {
    const THREE = K.THREE;
    const m = {
      c: K.mat(CREAM), o: K.mat(ORANGE), k: K.mat(DARK), b: K.mat(BLACK), s: K.mat(STEEL, { metalness: 0.6, roughness: 0.35 }), t: K.mat(SAND),
      g: K.mat(GLASS, { transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.1 }),
    };
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const me = new THREE.Mesh(geo, mat);
      me.position.set(x, y, z);
      me.rotation.set(rx, ry, rz);
      me.castShadow = me.receiveShadow = true;
      g.add(me);
      return me;
    };
    /** брусок: розміри, центр низу (y — низ) */
    const box = (w, h, d, x, y, z, mat, rx = 0) => add(new THREE.BoxGeometry(Math.max(w, 1e-3), Math.max(h, 1e-3), Math.max(d, 1e-3)), mat, x, y + h / 2, z, rx);
    /** циліндр стоячи: y — низ */
    const cyl = (rt, rb, h, x, y, z, mat, seg = 24, t0 = 0, tl = Math.PI * 2) => add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, tl < Math.PI * 2 - 1e-6, t0, tl), mat, x, y + h / 2, z);
    /** циліндр лежачи вздовж x: y — вісь */
    const cylX = (r, len, x, y, z, mat, seg = 24) => add(new THREE.CylinderGeometry(r, r, len, seg), mat, x, y, z, 0, 0, Math.PI / 2);
    /** кільце (тор) лежачи */
    const ring = (R, r, x, y, z, mat, seg = 40) => add(new THREE.TorusGeometry(R, r, 8, seg), mat, x, y, z, Math.PI / 2);
    /** купол (верх сфери) */
    const dome = (r, x, y, z, mat, k = 0.5) => add(new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI * k), mat, x, y, z);
    const R = Math.min(W, D) / 2;

    switch (type) {
      // ---------- фабрикатори ----------
      case 'Fabricator_Placeable': // плита-основа, темне ложе, кришка над ним на стояках
        box(W, H * 0.34, D, 0, 0, 0, m.c);
        box(W * 0.8, H * 0.02, D * 0.8, 0, H * 0.34, 0, m.k);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(W * 0.06, H * 0.38, D * 0.06, sx * W * 0.44, H * 0.34, sz * D * 0.44, m.k);
        box(W * 0.96, H * 0.14, D * 0.96, 0, H * 0.72, 0, m.c);
        box(W * 0.97, H * 0.03, D * 0.2, 0, H * 0.72, 0, m.o);
        return true;
      case 'WearablesFabricator_Placeable': // будка, відкрита спереду
      case 'AdvancedWearablesFabricator_Placeable': {
        const adv = type === 'AdvancedWearablesFabricator_Placeable';
        box(W, H * 0.08, D, 0, 0, 0, m.k);
        if (adv) {
          // округлий корпус з прорізом спереду і дверцятами-панеллю збоку
          cyl(R * 0.98, R, H * 0.84, 0, H * 0.08, 0, m.c, 24, Math.PI * 0.32, Math.PI * 1.36);
          cyl(R, R, H * 0.08, 0, H * 0.92, 0, m.c);
          cyl(R * 0.7, R * 0.7, H * 0.02, 0, H * 0.1, 0, m.k);
          box(W * 0.18, H * 0.4, D * 0.28, -W * 0.42, H * 0.08, D * 0.3, m.o);
          ring(R * 1.0, H * 0.02, 0, H * 0.55, 0, m.o);
        } else {
          box(W, H * 0.92, D * 0.14, 0, H * 0.08, -D * 0.43, m.c); // спинка
          for (const sx of [-1, 1]) box(W * 0.14, H * 0.92, D, sx * W * 0.43, H * 0.08, 0, m.c); // боки
          box(W, H * 0.12, D, 0, H * 0.88, 0, m.c); // дах
          box(W * 0.72, H * 0.03, D * 0.8, 0, H * 0.08, D * 0.04, m.k); // підлога
          box(W * 0.02, H * 0.6, D * 0.04, -W * 0.36, H * 0.2, D * 0.46, m.o);
          box(W * 0.02, H * 0.6, D * 0.04, W * 0.36, H * 0.2, D * 0.46, m.o);
        }
        return true;
      }
      case 'SurvivalFabricator_Placeable': // барабан з помаранчевим поясом
        cyl(R, R, H * 0.08, 0, 0, 0, m.k);
        cyl(R * 0.97, R, H * 0.82, 0, H * 0.08, 0, m.c);
        cyl(R * 1.01, R * 1.01, H * 0.14, 0, H * 0.48, 0, m.o);
        cyl(R * 0.8, R * 0.95, H * 0.1, 0, H * 0.9, 0, m.c);
        cyl(R * 0.12, R * 0.12, H * 0.02, 0, H, 0, m.k);
        return true;
      case 'Advanced_SurvivalFabricator_Placeable': // два барабани, нижній з помаранчевими блоками
        box(W, H * 0.06, D, 0, 0, 0, m.b);
        cyl(R, R, H * 0.46, 0, H * 0.06, 0, m.c);
        box(W * 0.36, H * 0.4, D * 0.3, -W * 0.18, H * 0.06, D * 0.32, m.o);
        cyl(R * 0.88, R * 0.92, H * 0.36, 0, H * 0.52, 0, m.c);
        cyl(R * 0.93, R * 0.93, H * 0.06, 0, H * 0.6, 0, m.o);
        cyl(R * 0.7, R * 0.88, H * 0.1, 0, H * 0.88, 0, m.c);
        return true;
      case 'WeaponsFabricator_Placeable': // стіл з темним ложем і блоком у торці
      case 'AdvancedWeaponsFabricator_Placeable': {
        const adv = type === 'AdvancedWeaponsFabricator_Placeable';
        box(W * 0.82, H * 0.46, D, W * 0.09, 0, 0, m.c);
        box(W * 0.7, H * 0.03, D * 0.8, W * 0.12, H * 0.46, 0, m.k);
        box(W * 0.72, H * 0.06, D * 0.04, W * 0.12, H * 0.46, D * 0.46, m.c);
        box(W * 0.72, H * 0.06, D * 0.04, W * 0.12, H * 0.46, -D * 0.46, m.c);
        box(W * 0.18, H * (adv ? 0.62 : 0.78), D * (adv ? 0.9 : 0.62), -W * 0.41, 0, 0, adv ? m.o : m.c);
        box(W * 0.19, H * 0.2, D * 0.3, -W * 0.41, H * 0.3, D * (adv ? 0.31 : 0.2), adv ? m.c : m.o);
        return true;
      }
      case 'VehiclesFabricator_Placeable': // помост з решіткою, високий щит позаду, пандус спереду
        box(W, H * 0.22, D * 0.8, 0, 0, -D * 0.06, m.c);
        box(W * 0.84, H * 0.02, D * 0.6, 0, H * 0.22, -D * 0.04, m.k);
        box(W * 0.96, H * 0.03, D * 0.06, 0, H * 0.19, D * 0.32, m.o);
        box(W * 0.8, H * 0.95, D * 0.08, 0, 0, -D * 0.46, m.k); // щит
        box(W * 0.84, H * 0.05, D * 0.1, 0, H * 0.95, -D * 0.46, m.c);
        for (const sx of [-1, 1]) box(W * 0.05, H, D * 0.1, sx * W * 0.42, 0, -D * 0.46, m.c);
        box(W * 0.5, H * 0.03, D * 0.24, W * 0.18, H * 0.06, D * 0.4, m.k, 0.35); // пандус
        return true;
      case 'Advanced_VehiclesFabricator_Placeable': // широкий низький помост з помаранчевим кантом і пандусами
        box(W, H * 0.16, D, 0, 0, 0, m.c);
        box(W * 0.78, H * 0.02, D * 0.7, 0, H * 0.16, 0, m.k);
        for (const sx of [-1, 1]) box(W * 0.06, H * 0.06, D, sx * W * 0.47, H * 0.16, 0, m.o);
        for (const sx of [-0.25, 0.25]) box(W * 0.18, H * 0.02, D * 0.18, sx * W, H * 0.03, D * 0.56, m.k, 0.3);
        return true;

      // ---------- переробники ----------
      case 'SmallOreRefinery_Placeable':
      case 'MediumOreRefinery_Placeable':
      case 'LargeOreRefinery_Placeable': { // корпус з темним барабаном-вікном уздовж і помаранчевим торцем
        const big = type === 'LargeOreRefinery_Placeable';
        box(W * 0.98, H * 0.12, D, 0, 0, 0, m.k);
        box(W * 0.78, H * 0.76, D * 0.86, -W * 0.1, H * 0.12, 0, m.c);
        cylX(Math.min(H * 0.26, D * 0.32), W * 0.66, -W * 0.1, H * 0.52, D * 0.18, m.k, 20);
        box(W * 0.2, H * 0.88, D * 0.92, W * 0.39, H * 0.12, 0, m.o);
        box(W * 0.1, H * 0.5, D * 0.6, W * 0.47, H * 0.3, 0, m.k);
        box(W * 0.8, H * 0.05, D * 0.88, -W * 0.1, H * 0.86, 0, m.c);
        if (big) { box(W * 0.3, H * 0.5, D * 0.3, -W * 0.3, H * 0.12, -D * 0.5, m.c); cylX(H * 0.1, W * 0.5, 0, H * 0.3, -D * 0.5, m.k, 12); }
        return true;
      }
      case 'SmallChemicalRefinery_Placeable':
      case 'MediumChemicalRefinery_Placeable': { // основа і скляний циліндр лежачи з темними кільцями
        const med = type === 'MediumChemicalRefinery_Placeable';
        box(W, H * 0.34, D, 0, 0, 0, m.c);
        box(W * 1.01, H * 0.06, D * 1.01, 0, H * 0.14, 0, m.o);
        const r = Math.min(D * 0.36, H * 0.32);
        cylX(r, W * 0.62, -W * 0.06, H * 0.34 + r, 0, m.g, 24);
        cylX(r * 0.55, W * 0.6, -W * 0.06, H * 0.34 + r, 0, m.k, 16);
        for (const fx of med ? [-0.36, -0.12, 0.12] : [-0.36, 0.22]) ring(r * 1.02, r * 0.08, fx * W, H * 0.34 + r, 0, m.k);
        box(W * 0.12, H * 0.4, D * 0.5, W * 0.33, H * 0.34, 0, m.k); // привід у торці
        box(W * 0.06, H * 0.5, D * 0.6, W * 0.44, H * 0.34, 0, m.c);
        box(W * 0.16, H * 0.3, D * 0.18, -W * 0.38, H * 0.34, D * 0.38, m.c); // пульт
        box(W * 0.1, H * 0.12, D * 0.02, -W * 0.38, H * 0.48, D * 0.47, m.o);
        return true;
      }
      case 'SpiceRefinery_Placeable': // основа і високий скляний циліндр з кремовою кришкою
        box(W, H * 0.3, D, 0, 0, 0, m.c);
        box(W * 1.01, H * 0.05, D * 1.01, 0, H * 0.22, 0, m.o);
        cyl(R * 0.6, R * 0.6, H * 0.58, 0, H * 0.3, 0, m.g);
        cyl(R * 0.4, R * 0.4, H * 0.56, 0, H * 0.31, 0, m.k);
        cyl(R * 0.66, R * 0.66, H * 0.12, 0, H * 0.88, 0, m.c);
        return true;
      case 'MediumSpiceRefinery_Placeable': // помост і два скляні циліндри
        box(W, H * 0.16, D, 0, 0, 0, m.k);
        for (const sx of [-1, 1]) {
          cyl(R * 0.42, R * 0.46, H * 0.18, sx * W * 0.24, H * 0.16, 0, m.c);
          cyl(R * 0.44, R * 0.44, H * 0.5, sx * W * 0.24, H * 0.34, 0, m.g);
          cyl(R * 0.3, R * 0.3, H * 0.48, sx * W * 0.24, H * 0.35, 0, m.c);
          cyl(R * 0.36, R * 0.46, H * 0.14, sx * W * 0.24, H * 0.84, 0, m.c);
        }
        return true;
      case 'LargeSpiceRefinery_Placeable': // висока кремова вежа на темній основі з помаранчевими поясами
        box(W, H * 0.1, D, 0, 0, 0, m.k);
        cyl(R * 0.85, R * 0.95, H * 0.2, 0, H * 0.1, 0, m.k);
        cyl(R * 0.9, R * 0.9, H * 0.62, 0, H * 0.3, 0, m.c);
        for (const y of [0.42, 0.7]) cyl(R * 0.92, R * 0.92, H * 0.04, 0, H * y, 0, m.o);
        cyl(R * 0.82, R * 0.9, H * 0.08, 0, H * 0.92, 0, m.c);
        box(W * 0.3, H * 0.16, D * 0.2, 0, H * 0.1, R * 0.95, m.o);
        return true;

      // ---------- вода ----------
      case 'Windtrap_Placeable': { // вигнутий капот, що нахиляється назад, зі скляними ламелями зверху, на круглій основі
        cyl(R * 0.95, R, H * 0.14, 0, 0, 0, m.c);
        ring(R * 0.95, H * 0.015, 0, H * 0.14, 0, m.o);
        // профіль збоку (z — уперед, y — угору): товста дуга від переду внизу вгору й далеко назад
        const fz = D * 0.5, fy = H * 0.86;
        const P0 = [fz * 0.85, 0], C0 = [fz * 1.0, fy * 0.95], P1 = [-fz * 0.25, fy];
        const sh = new THREE.Shape();
        sh.moveTo(P0[0], P0[1]);
        sh.quadraticCurveTo(C0[0], C0[1], P1[0], P1[1]);
        sh.lineTo(-fz * 0.8, fy * 0.72);
        sh.quadraticCurveTo(-fz * 0.3, fy * 0.5, -fz * 0.2, 0);
        sh.lineTo(P0[0], P0[1]);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: W * 0.62, bevelEnabled: false });
        geo.translate(0, 0, -W * 0.31);
        add(geo, m.c, 0, H * 0.14, 0, 0, -Math.PI / 2, 0);
        // скляні ламелі вздовж опуклого боку
        const q = (t, k) => (1 - t) * (1 - t) * P0[k] + 2 * (1 - t) * t * C0[k] + t * t * P1[k];
        for (let k = 0; k < 7; k++) {
          const t = 0.18 + k * 0.11, dz = q(t + 0.01, 0) - q(t - 0.01, 0), dy = q(t + 0.01, 1) - q(t - 0.01, 1);
          const L = Math.hypot(dz, dy) || 1, nz = dy / L, ny = -dz / L; // назовні
          box(W * 0.48, H * 0.01, D * 0.1, 0, H * 0.14 + q(t, 1) + ny * 0.02 - H * 0.005, q(t, 0) + nz * 0.02, m.g, -Math.atan2(dy, dz));
        }
        box(W * 0.64, H * 0.03, D * 0.04, 0, H * 0.14, fz * 0.74, m.o);
        return true;
      }
      case 'LargeWindtrap_Placeable': { // широкий барабан із темними ребрами й помаранчевим кільцем
        cyl(R, R, H * 0.08, 0, 0, 0, m.k);
        cyl(R * 0.92, R * 0.92, H * 0.78, 0, H * 0.08, 0, m.c);
        const n = 16;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          box(R * 0.06, H * 0.74, R * 0.16, Math.cos(a) * R * 0.94, H * 0.1, Math.sin(a) * R * 0.94, m.k).rotation.y = -a;
        }
        cyl(R * 0.94, R * 0.94, H * 0.1, 0, H * 0.86, 0, m.c);
        ring(R * 0.62, R * 0.04, 0, H * 0.965, 0, m.o);
        cyl(R * 0.16, R * 0.16, H * 0.02, 0, H * 0.96, 0, m.b);
        return true;
      }
      case 'BloodWaterExtractor_Placeable':
      case 'BloodWaterExtractionAdvanced_Placeable': { // високий блок з темними вікнами позаду, пульт і бак спереду
        const imp = type === 'BloodWaterExtractionAdvanced_Placeable';
        box(W, H * 0.06, D, 0, 0, 0, m.k);
        box(W * (imp ? 0.96 : 0.6), H * 0.94, D * 0.42, imp ? 0 : -W * 0.18, 0, -D * 0.28, m.c);
        const wn = imp ? 3 : 3, ww = (imp ? 0.96 : 0.6) / wn;
        for (let i = 0; i < wn; i++) box(W * ww * 0.6, H * 0.28, D * 0.02, (imp ? -0.48 : -0.48) * W + W * ww * (i + 0.5) + (imp ? 0 : 0), H * 0.56, -D * 0.065, m.k);
        box(W * (imp ? 0.98 : 0.62), H * 0.06, D * 0.44, imp ? 0 : -W * 0.18, H * 0.9, -D * 0.28, m.o);
        box(W * 0.36, H * 0.42, D * 0.4, W * (imp ? 0.1 : -0.2), H * 0.06, D * 0.26, m.c);
        box(W * 0.36, H * 0.08, D * 0.06, W * (imp ? 0.1 : -0.2), H * 0.4, D * 0.44, m.o);
        cyl(R * 0.16, R * 0.16, H * 0.3, W * 0.36, H * 0.06, D * 0.28, m.k, 12);
        return true;
      }
      case 'Fremen_Deathstill_Placeable':
      case 'Deathstill_Placeable': { // низька довга ванна з піском і машинкою в торці
        const adv = type === 'Deathstill_Placeable';
        box(W, H * 0.12, D, 0, 0, 0, adv ? m.k : m.c);
        box(W * 0.84, H * 0.36, D * 0.9, W * 0.06, H * 0.12, 0, adv ? m.k : m.c);
        box(W * 0.76, H * 0.03, D * 0.76, W * 0.06, H * 0.48, 0, m.t);
        box(W * 0.86, H * 0.04, D * 0.06, W * 0.06, H * 0.46, D * 0.44, m.c);
        box(W * 0.86, H * 0.04, D * 0.06, W * 0.06, H * 0.46, -D * 0.44, m.c);
        box(W * 0.14, H * 0.56, D * 0.5, -W * 0.42, H * 0.12, 0, m.s);
        cylX(Math.min(D, H) * 0.12, W * 0.12, -W * 0.42, H * 0.62, 0, m.k, 12);
        return true;
      }
      case 'WaterCistern_Placeable': // капсула з закругленим верхом, темна основа, помаранчевий поясок
        cyl(R * 0.8, R * 0.9, H * 0.1, 0, 0, 0, m.b);
        cyl(R * 0.9, R * 0.9, H * 0.66, 0, H * 0.1, 0, m.c);
        add(new THREE.SphereGeometry(R * 0.9, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.c, 0, H * 0.76, 0).scale.set(1, (H * 0.24) / (R * 0.9), 1);
        cyl(R * 0.91, R * 0.91, H * 0.02, 0, H * 0.74, 0, m.o);
        box(R * 0.36, H * 0.05, R * 1.86, 0, H * 0.95, 0, m.b); // ремінь через верх
        box(R * 0.36, H * 0.3, R * 0.06, 0, H * 0.66, R * 0.88, m.b);
        box(R * 0.36, H * 0.3, R * 0.06, 0, H * 0.66, -R * 0.88, m.b);
        box(R * 0.06, H * 0.3, R * 0.04, -R * 0.5, H * 0.3, R * 0.76, m.g);
        return true;
      case 'MediumWaterCistern_Placeable': // циліндр у темній рамі
        box(W, H * 0.06, D, 0, 0, 0, m.b);
        cyl(R * 0.86, R * 0.86, H * 0.86, 0, H * 0.06, 0, m.c);
        cyl(R * 0.87, R * 0.87, H * 0.02, 0, H * 0.5, 0, m.o);
        for (const sx of [-1, 1]) box(W * 0.07, H, D * 0.3, sx * W * 0.46, 0, 0, m.b);
        box(W, H * 0.06, D * 0.3, 0, H * 0.94, 0, m.b);
        return true;
      case 'LargeWaterCistern_Placeable': // циліндр з темним куполом у восьмикутній рамі на ніжках
        cyl(R, R, H * 0.06, 0, 0, 0, m.b, 8);
        cyl(R * 0.72, R * 0.72, H * 0.66, 0, H * 0.06, 0, m.c);
        cyl(R * 0.74, R * 0.74, H * 0.03, 0, H * 0.68, 0, m.o);
        cyl(R * 0.74, R * 0.74, H * 0.06, 0, H * 0.71, 0, m.b);
        dome(R * 0.72, 0, H * 0.77, 0, m.b, 0.5).scale.set(1, (H * 0.2) / (R * 0.72), 1);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; box(R * 0.06, H * 0.72, R * 0.06, Math.cos(a) * R * 0.92, H * 0.04, Math.sin(a) * R * 0.92, m.b); }
        return true;

      // ---------- сховища ----------
      case 'SpiceSilo_Placeable': // кремовий кубик з помаранчевою смугою
        box(W, H * 0.92, D, 0, 0, 0, m.c);
        box(W * 0.16, H * 0.93, D * 1.01, 0, 0, 0, m.o);
        box(W * 0.9, H * 0.08, D * 0.9, 0, H * 0.92, 0, m.c);
        box(W * 0.3, H * 0.01, D * 0.3, 0, H, 0, m.o);
        return true;
      case 'GenericContainer_Placeable': // низька довга скриня з помаранчевими смугами й темними торцями
        box(W * 0.9, H * 0.9, D, 0, 0, 0, m.c);
        for (const sx of [-1, 1]) box(W * 0.06, H * 0.92, D * 0.96, sx * W * 0.47, 0, 0, m.k);
        for (const sx of [-0.28, 0.28]) box(W * 0.06, H * 0.91, D * 1.01, sx * W, 0, 0, m.o);
        box(W * 0.6, H * 0.04, D * 0.04, 0, H * 0.7, D * 0.5, m.k);
        return true;
      case 'StorageContainer_Placeable':
      case 'MediumStorageContainer_Placeable': { // куб з темними круглими дверцятами спереду
        const med = type === 'MediumStorageContainer_Placeable';
        box(W, H, D, 0, 0, 0, m.c);
        box(W * 0.84, H * 0.84, D * 0.02, 0, H * 0.08, D * 0.5, m.k);
        add(new THREE.CylinderGeometry(Math.min(W, H) * 0.32, Math.min(W, H) * 0.32, D * 0.03, 24), m.b, 0, H * 0.5, D * 0.51, Math.PI / 2);
        box(W * 1.01, H * 0.04, D * 0.4, 0, H * 0.72, 0, m.o);
        if (med) for (const sx of [-1, 1]) box(W * 0.04, H * 1.01, D * 1.01, sx * W * 0.3, 0, 0, m.c);
        return true;
      }

      // ---------- енергія ----------
      case 'Generator_Placeable': { // темна основа, корпус з відкритою турбіною і скісним блоком радіатора
        box(W, H * 0.08, D, 0, 0, 0, m.b);
        box(W * 0.5, H * 0.62, D * 0.42, -W * 0.2, H * 0.08, -D * 0.2, m.c);
        box(W * 0.5, H * 0.08, D * 0.84, -W * 0.2, H * 0.62, 0, m.c);
        box(W * 0.06, H * 0.62, D * 0.84, -W * 0.42, H * 0.08, 0, m.c);
        cylX(Math.min(H, D) * 0.22, W * 0.36, -W * 0.2, H * 0.36, D * 0.16, m.s, 16);
        for (const fx of [-0.32, -0.2, -0.08]) ring(Math.min(H, D) * 0.23, Math.min(H, D) * 0.02, fx * W, H * 0.36, D * 0.16, m.k).rotation.set(0, Math.PI / 2, 0);
        const sh = new THREE.Shape();
        sh.moveTo(0, 0); sh.lineTo(W * 0.42, 0); sh.lineTo(W * 0.42, H * 0.3); sh.lineTo(W * 0.1, H * 0.92); sh.lineTo(0, H * 0.92); sh.lineTo(0, 0);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: D * 0.84, bevelEnabled: false });
        geo.translate(0, 0, -D * 0.42);
        add(geo, m.c, W * 0.06, H * 0.08, 0);
        box(W * 0.04, H * 0.4, D * 0.86, W * 0.44, H * 0.1, 0, m.o);
        return true;
      }
      case 'SpiceGenerator_Placeable': { // високий скісний блок з темною панеллю, бак унизу
        box(W, H * 0.06, D, 0, 0, 0, m.b);
        const sh = new THREE.Shape();
        sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(W / 2, H * 0.2); sh.lineTo(W * 0.05, H * 0.94); sh.lineTo(-W / 2, H * 0.94); sh.lineTo(-W / 2, 0);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: D * 0.7, bevelEnabled: false });
        geo.translate(0, 0, -D * 0.45);
        add(geo, m.c, 0, H * 0.06, 0);
        box(W * 0.5, H * 0.5, D * 0.02, -W * 0.22, H * 0.3, D * 0.26, m.k);
        box(W * 0.04, H * 0.9, D * 0.02, -W * 0.02, H * 0.06, D * 0.26, m.o);
        cylX(H * 0.1, W * 0.6, 0, H * 0.16, D * 0.36, m.c, 16);
        box(W * 0.1, H * 0.2, D * 0.22, W * 0.32, H * 0.06, D * 0.36, m.o);
        return true;
      }
      case 'WindTurbineDirectional_Placeable': { // висока овальна колона з трьома турбінами одна над одною, на круглій основі
        cyl(R, R, H * 0.06, 0, 0, 0, m.c);
        cyl(R * 0.3, R * 0.4, H * 0.12, 0, H * 0.06, 0, m.k, 12);
        const body = add(new THREE.CylinderGeometry(1, 1, H * 0.78, 24), m.c, 0, H * 0.18 + H * 0.39, 0);
        body.scale.set(W * 0.5, 1, D * 0.4);
        dome(1, 0, H * 0.96, 0, m.c).scale.set(W * 0.5, H * 0.04, D * 0.4);
        for (let i = 0; i < 3; i++) {
          const y = H * (0.33 + i * 0.22);
          const o = add(new THREE.CylinderGeometry(1, 1, D * 0.84, 20), m.k, 0, y, 0, Math.PI / 2);
          o.scale.set(W * 0.44, 1, H * 0.09);
          const rr = add(new THREE.TorusGeometry(1, 0.07, 6, 24), m.c, 0, y, D * 0.42);
          rr.scale.set(W * 0.46, H * 0.095, 1);
        }
        return true;
      }
      case 'WindTurbineOmnidirectional_Placeable': { // вертикальна вісь: щогла і темні вигнуті лопаті
        cyl(R * 0.7, R * 0.8, H * 0.06, 0, 0, 0, m.c);
        box(W * 0.2, H * 0.14, D * 0.1, W * 0.2, H * 0.06, 0, m.o);
        cyl(R * 0.05, R * 0.06, H * 0.92, 0, H * 0.06, 0, m.s, 8);
        for (let i = 0; i < 2; i++) {
          const blade = add(new THREE.CylinderGeometry(R * 0.9, R * 0.9, H * 0.74, 16, 1, true, i * Math.PI - Math.PI * 0.3, Math.PI * 0.6), K.mat(DARK, { side: THREE.DoubleSide }), 0, H * 0.21, 0);
          blade.scale.set(1, 1, 0.45);
          blade.position.y = H * 0.21 + H * 0.37;
        }
        box(W * 0.6, H * 0.02, D * 0.06, 0, H * 0.96, 0, m.s);
        return true;
      }

      // ---------- різне ----------
      case 'Totem_Small_Placeable': // чаша на ніжці з помаранчевими пультами
        cyl(R * 0.3, R * 0.4, H * 0.3, 0, 0, 0, m.k, 16);
        cyl(R, R * 0.55, H * 0.5, 0, H * 0.3, 0, m.c, 24);
        cyl(R * 0.82, R * 0.6, H * 0.02, 0, H * 0.79, 0, m.k);
        cyl(R * 0.14, R * 0.2, H * 0.2, 0, H * 0.6, 0, m.k, 12);
        for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) box(R * 0.36, H * 0.14, R * 0.16, Math.cos(a) * R * 0.92, H * 0.66, Math.sin(a) * R * 0.92, m.o).rotation.y = -a;
        return true;
      case 'Totem_Placeable': // сталеве кільце на ніжці з диском посередині
        cyl(R * 0.2, R * 0.3, H * 0.34, 0, 0, 0, m.s, 16);
        cyl(R * 0.6, R * 0.3, H * 0.1, 0, H * 0.34, 0, m.s, 24);
        ring(R * 0.88, R * 0.1, 0, H * 0.5, 0, m.s);
        cyl(R * 0.25, R * 0.3, H * 0.2, 0, H * 0.42, 0, m.k, 16);
        for (const a of [Math.PI / 4, (Math.PI * 5) / 4]) box(R * 0.26, H * 0.12, R * 0.14, Math.cos(a) * R, H * 0.46, Math.sin(a) * R, m.k).rotation.y = -a;
        return true;
      case 'RepairStation_Placeable': // шафа з відкритою темною кришкою і помаранчевим боком
        box(W, H * 0.5, D, 0, 0, 0, m.c);
        box(W * 0.3, H * 0.5, D * 1.01, W * 0.35, 0, 0, m.o);
        box(W * 0.62, H * 0.03, D * 0.5, -W * 0.16, H * 0.5, D * 0.2, m.k);
        box(W * 0.66, H * 0.42, D * 0.3, -W * 0.14, H * 0.5, -D * 0.32, m.k); // висока задня частина
        box(W * 0.6, H * 0.36, D * 0.02, -W * 0.14, H * 0.53, -D * 0.165, m.s); // решітка
        box(W * 0.7, H * 0.08, D * 0.62, -W * 0.14, H * 0.92, -D * 0.16, m.k); // козирок
        box(W * 0.04, H * 0.3, D * 0.04, -W * 0.3, H * 0.62, D * 0.1, m.s);
        return true;
      case 'Recycler_Placeable': { // корпус з темною скісною пащею спереду й помаранчевим боком
        box(W, H * 0.82, D * 0.7, 0, 0, -D * 0.15, m.c);
        const sh = new THREE.Shape();
        sh.moveTo(0, 0); sh.lineTo(D * 0.3, 0); sh.lineTo(D * 0.3, H * 0.25); sh.lineTo(0, H * 0.7); sh.lineTo(0, 0);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: W * 0.62, bevelEnabled: false });
        geo.translate(0, 0, -W * 0.31);
        add(geo, m.k, -W * 0.12, 0, D * 0.2, 0, -Math.PI / 2, 0);
        box(W * 0.24, H * 0.6, D * 0.3, W * 0.36, 0, D * 0.35, m.c);
        box(W * 0.06, H * 0.5, D * 0.5, W * 0.48, H * 0.3, -D * 0.1, m.o);
        box(W * 0.1, H * 0.2, D * 0.04, W * 0.34, H * 0.35, D * 0.5, m.k);
        return true;
      }
      case 'ModdingStation_Placeable': // широка ванна з відкинутою кришкою
        box(W, H * 0.46, D * 0.8, 0, 0, D * 0.1, m.c);
        box(W * 0.84, H * 0.03, D * 0.6, 0, H * 0.46, D * 0.12, m.k);
        box(W * 1.01, H * 0.05, D * 0.81, 0, H * 0.38, D * 0.1, m.o);
        box(W * 0.96, H * 0.08, D * 0.5, 0, H * 0.72, -D * 0.34, m.c, 0.9);
        box(W * 0.98, H * 0.03, D * 0.08, 0, H * 0.5, -D * 0.3, m.o);
        return true;
    }
    return false;
  }

  const api = { build, typeOf, BY_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.STATIONS3D = api;
})(typeof window !== 'undefined' ? window : globalThis);
