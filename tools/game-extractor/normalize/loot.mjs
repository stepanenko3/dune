/*
 * Лут контейнерів з таблиць гри (DT_LootTable_*): шанс кожного предмета (хоч один) і середня кількість, коли випав.
 * Звичайна таблиця: кожен рядок незалежно — з шансом PercentageChance, NumRolls кидків; зважена — за кидок один рядок
 * за вагою (Weight), кількість MinRolls…MaxRolls; рядок дає предмет (ItemTemplateId), вкладену таблицю чи зважену.
 * Умови рядка — теги місця: RequiredTags усі є, ForbiddenTags жодного (зони луту LootTier.N — з бітових карт світу).
 * Без своєї таблиці контейнер бере таблицю розподілу свого типу (DT_LootContainerActorsTable → override, далі загальний
 * DT_LootDistributionSettings): найвищий пріоритет серед рядків, чиї умови місце задовольняє.
 */
const pkg = (p) => String(p ?? '').split('/').pop().replace(/\..*$/, '')
const ref = (soft) => { const n = pkg(soft?.AssetPathName); return n && n !== 'None' ? n : null }
const itemOf = (r) => { const i = r.ItemTemplateId?.Name; return i && i !== 'None' ? i : null }
// теги гри ієрархічні: вимога чи заборона «LootTier» — будь-який LootTier.N місця
const has = (tags, t) => tags.has(t) || [...tags].some((x) => x.startsWith(t + '.'))
// зона безпеки рядка (TargetSecurityZone): PvP чи PvE — лише в такій зоні місця; Any (і без зони) — будь-де
// рядок з умовою гравця (RequiredPlayerTags: бонус ключового вміння, активний контракт) — лише для гравця з цими тегами
// (player — Set тегів гравця; без нього такі рядки пропускаємо)
const forPlayer = (r, player) => (r.RequiredPlayerTags?.TagDictionary ?? []).every((t) => player?.has(t.TagName))
const inZone = (r, zone) => { const z = /::(PvP|PvE)$/.exec(r.TargetSecurityZone ?? '')?.[1]; return !z || !zone || z === zone }
const fits = (r, tags, zone, player) => forPlayer(r, player) && inZone(r, zone) && (r.RequiredTags ?? []).every((t) => has(tags, t)) && !(r.ForbiddenTags ?? []).some((t) => has(tags, t))

/** BitMapData: W×H пікселів по bits біт підряд (молодший біт першим), біт k — тег m_Tags[k]; дані — хвіст пакета */
export function bitmapSampler(props, buf) {
  // порожня карта гри (без розміру й тегів — є така серед карт розкладок ГП): тегів не дає
  if (!props?.m_SizeX && !props?.m_Tags?.length) return () => []
  const W = Number(props.m_SizeX), H = Number(props.m_SizeY), bits = Number(props.m_BitsPerWord)
  const tags = (props.m_Tags ?? []).map((t) => t.TagName)
  const bytes = Math.ceil((W * H * bits) / 8)
  if (!(W > 0 && H > 0 && bits > 0) || buf.length < bytes || tags.length !== bits) throw new Error(`бітова карта ${W}×${H}×${bits}: даних ${buf.length} байт, тегів ${tags.length}`)
  const data = buf.subarray(buf.length - bytes)
  return (i, j) => {
    if (!(i >= 0 && j >= 0 && i < W && j < H)) return []
    const out = []
    const base = (j * W + i) * bits
    for (let k = 0; k < bits; k++) { const n = base + k; if ((data[n >> 3] >> (n & 7)) & 1) out.push(tags[k]) }
    return out
  }
}

/**
 * рядок таблиці розподілу для типу контейнера й тегів місця → ім'я таблиці луту (null — жоден не підходить). own — власна
 * таблиця типу (override з DT_LootContainerActorsTable): тип у її рядках не фільтр (примітивна скриня бере таблицю
 * звичайної, де рядки — BasicContainer); у загальній (DT_LootDistributionSettings) — фільтр
 */
export function pickDistribution(rows, containerType, tags, { own = false, zone = null } = {}) {
  let best = null
  for (const r of rows) {
    const t = r.LootContainerType?.Name
    if (r.bIsEnabled === false || (!own && t && t !== 'None' && t !== containerType) || !fits(r, tags, zone)) continue
    const table = ref(r.LootTable) ?? ref(r.LootWeightedTable)
    if (table && (!best || (r.Priority ?? 0) > best.p)) best = { p: r.Priority ?? 0, table }
  }
  return best?.table ?? null
}

/**
 * tables — { ім'я: рядки }; start — ім'я таблиці; tags — Set тегів місця; zone — зона безпеки місця (PvP / PvE);
 * absent(ім'я) — таблиці нема в збірці гри.
 * → [[предмет, шанс %, середня кількість]] (за спаданням шансу); таблиці нема — помилка
 */
export function lootOf(tables, start, tags, { zone = null, absent = () => false, player = null } = {}) {
  // розподіл: предмет → { p — імовірність хоч одного, e — сподівана кількість }
  const combine = (parts) => {
    const out = new Map()
    for (const d of parts) for (const [i, { p, e }] of d) {
      const c = out.get(i) ?? { p: 0, e: 0 }
      out.set(i, { p: 1 - (1 - c.p) * (1 - p), e: c.e + e })
    }
    return out
  }
  // взаємовиключні частини (рядки зваженої таблиці — один за кидок): шанс і кількість додаються
  const add = (parts) => {
    const out = new Map()
    for (const d of parts) for (const [i, { p, e }] of d) {
      const c = out.get(i) ?? { p: 0, e: 0 }
      out.set(i, { p: Math.min(1, c.p + p), e: c.e + e })
    }
    return out
  }
  const repeat = (d, n, chance = 1) => new Map([...d].map(([i, { p, e }]) => [i, { p: chance * (1 - (1 - p) ** n), e: chance * n * e }]))
  const scale = (d, k) => new Map([...d].map(([i, { p, e }]) => [i, { p: p * k, e: e * k }]))
  const memo = new Map()
  function dist(name, depth) {
    if (memo.has(name)) return memo.get(name)
    const rows = tables[name]
    // таблиці нема в самій збірці гри (на неї лише посилаються) — гра там нічого не дає; не вивантажена — помилка
    if (!rows && absent(name)) return new Map()
    if (!rows) throw new Error(`нема таблиці луту ${name}`)
    if (depth > 12) throw new Error(`таблиця луту ${name}: забагато вкладень`)
    const list = Object.values(rows).filter((r) => fits(r, tags, zone, player))
    let d
    if (list.some((r) => r.Weight != null)) {
      // зважена: один рядок за кидок; кількість — середнє MinRolls…MaxRolls
      const W = list.reduce((s, r) => s + (r.Weight ?? 0), 0)
      d = add(list.filter((r) => r.Weight > 0).map((r) => {
        const q = ((r.MinRolls ?? 1) + (r.MaxRolls ?? r.MinRolls ?? 1)) / 2
        const one = roll(r, depth)
        // предмет — q штук; вкладена таблиця — q кидків
        const got = itemOf(r) ? new Map([...one].map(([i, v]) => [i, { p: v.p, e: v.e * q }])) : repeat(one, q)
        return scale(got, r.Weight / W)
      }))
    } else {
      d = combine(list.map((r) => repeat(roll(r, depth), r.NumRolls ?? 1, Math.min(1, r.PercentageChance ?? 1))))
    }
    memo.set(name, d)
    return d
  }
  // один кидок рядка: предмет, вкладена таблиця, зважена — чи обидві таблиці (тир печери й креслення — разом)
  function roll(r, depth) {
    const i = itemOf(r)
    if (i) return new Map([[i, { p: 1, e: 1 }]])
    return combine([ref(r.LootTable), ref(r.LootWeightedTable)].filter(Boolean).map((sub) => dist(sub, depth + 1)))
  }
  return [...dist(start, 0)]
    .filter(([, v]) => v.p > 0.0005)
    .map(([i, v]) => [i, Math.round(v.p * 1000) / 10, Math.round((v.e / v.p) * 10) / 10])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
}

/** умови гравця, за якими гра дає додатковий лут: позначка предмета в переліку → тег гравця */
const PLAYER_BONUS = [['k', 'Character.Keystone.Exploration.BonusLoot'], ['c', 'Contract.Tracking.Active']]

/**
 * лут для всіх і окремо — предмети, які дає лише умова гравця (бонус спеціалізації — k, активний контракт — c):
 * [[предмет, шанс %, кількість, позначка?]]; предмет, що й так є в луті, вдруге не додаємо
 */
export function lootWithBonus(tables, start, tags, opts = {}) {
  const base = lootOf(tables, start, tags, opts)
  const have = new Set(base.map((x) => x[0]))
  const out = [...base]
  for (const [code, tag] of PLAYER_BONUS) {
    for (const [id, pc, n] of lootOf(tables, start, tags, { ...opts, player: new Set([tag]) })) {
      if (have.has(id)) continue
      have.add(id)
      out.push([id, pc, n, code])
    }
  }
  return out
}
