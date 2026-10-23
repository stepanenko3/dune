/*
 * Вміст усіх видів однаково: назва й опис для реєстру, створити, прочитати документ, скопіювати, стерти. Через нього
 * працюють копіювання з бібліотеки, видалення людини чи гільдії (їхнє — стерти чи передати) і перенесення давніх даних.
 * Власник для нової речі чи передачі — ownerFor: людина — лише сам (адміністратор — будь-хто), гільдія — де в тебе
 * щонайменше учасник, сайт — адміністратор чи роль із дозволом site.content.
 */
import { summary as baseSummary } from './bases.mjs'
import { blankRoadmap, roadmapSummary } from './roadmap.mjs'
import { fail, fill, newId } from './util.mjs'

/**
 * t — перекладач мовою людини (req.t): його можна передати в meta, щоб назва за замовчуванням («База», «Ресурс»)
 * була її мовою; без нього — українська.
 */
/** ліміти за замовчуванням: на людину й на гільдію (змінюються в «Налаштуваннях сайту») */
export const DEFAULT_LIMITS = {
  user: { base: 10, roadmap: 10, build: 30, calc: 30, marker: 100, place: 50, event: 20 },
  guild: { base: 30, roadmap: 30, build: 100, calc: 100, marker: 300, place: 200, event: 60 },
}

export function createContent({ items, guilds, auth, bases, roadmaps, builds, calcs, markers, places, events }) {
  const H = {
    base: {
      meta: (doc, t = fill) => ({ title: doc.ui?.name || t('База'), summary: baseSummary(doc, t).lead || '' }),
      // база в кошику — як нема: її не копіюють і не відкривають за посиланням
      read: async (id) => { const b = await bases.get(id); return b && !b.deleted ? b.doc : null },
      // by — хто створив (автор першої версії)
      create: async (doc, note, t, by) => (await bases.create(doc, note, t, by)).id,
      purge: (id) => bases.purge(id),
    },
    roadmap: {
      meta: (doc, t = fill) => ({ title: doc.title || t('Без назви'), summary: roadmapSummary(doc) }),
      read: async (id) => (await roadmaps.get(id))?.doc || null,
      create: async (doc) => (await roadmaps.create(newId('r'), doc || blankRoadmap())).id,
      purge: (id) => roadmaps.remove(id),
    },
    build: {
      meta: (doc) => ({ title: doc.name, summary: doc.about || '' }),
      // snap — вузли й версія дерева: копія лишається тим самим білдом і після оновлення гри
      read: async (id) => { const b = await builds.get(id); return b && { name: b.name, code: b.code, notes: b.notes, about: b.about, ...(b.snap ? { snap: b.snap } : {}) } },
      create: async (doc) => (await builds.create(doc)).id,
      purge: (id) => builds.remove(id),
    },
    calc: {
      meta: (doc) => ({ title: doc.name, summary: doc.about || '' }),
      read: async (id) => { const c = await calcs.get(id); if (!c) return null; const { id: _, created, updated, ...doc } = c; return doc },
      create: async (doc) => (await calcs.create(doc)).id,
      purge: (id) => calcs.remove(id),
    },
    marker: {
      meta: (doc) => ({ title: doc.title, summary: doc.note?.slice(0, 160) || '' }),
      read: async (id) => { const m = await markers.get(id); if (!m) return null; const { id: _, created, updated, ...doc } = m; return doc },
      create: async (doc) => (await markers.create(doc)).id,
      purge: (id) => markers.remove(id),
    },
    place: {
      meta: (doc, t = fill) => ({ title: doc.res || t('Ресурс'), summary: doc.place || '' }),
      read: async (id) => { const p = await places.get(id); if (!p) return null; const { id: _, created, updated, ...doc } = p; return doc },
      create: async (doc) => (await places.add(doc)).id,
      purge: (id) => places.remove(id),
    },
    event: {
      meta: (doc) => ({ title: doc.title, summary: doc.about?.replace(/\s+/g, ' ').slice(0, 160) || '' }),
      read: async (id) => { const e = await events.get(id); if (!e) return null; const { id: _, created, updated, ...doc } = e; return doc },
      create: async (doc) => (await events.create(doc)).id,
      // разом із командами, гравцями й глядачами
      purge: (id) => events.remove(id),
    },
  }

  /** власник нової речі чи передачі; o — { kind, id } із запиту (порожньо — сам) */
  async function ownerFor(req, o) {
    if (!req.user) throw fail('потрібно увійти', 401)
    if (!o || o.kind === 'user' || !o.kind) {
      if (o?.id && o.id !== req.user.id) {
        if (req.user.role !== 'admin') throw fail('чуже не можна віддати іншій людині', 403)
        if (!(await auth.get(o.id))) throw fail('немає такої людини', 404)
        return { kind: 'user', id: o.id }
      }
      return { kind: 'user', id: req.user.id }
    }
    if (o.kind === 'guild') {
      const g = typeof o.id === 'string' ? await guilds.get(o.id) : null
      if (!g) throw fail('немає такої гільдії', 404)
      const rank = req.user.role === 'admin' ? 4 : req.ctx.ranks.get(g.id) || 0
      // не в гільдії — так і кажемо; новобранець — лише дивиться
      if (!rank) throw fail('ти не в цій гільдії — створювати й передавати їй не можна', 403)
      if (rank < 2) throw fail('у цій гільдії ти ще новобранець — створювати й передавати їй не можна', 403)
      return { kind: 'guild', id: g.id }
    }
    // сам сайт — офіційний вміст (бібліотека, приклади); віддати йому може лише адміністрація (дозвіл site.content)
    if (o.kind === 'site') {
      if (!(req.ctx?.superuser || req.ctx?.siteContent || req.user.role === 'admin')) throw fail('віддати сайту може лише адміністрація', 403)
      return { kind: 'site', id: 'site' }
    }
    throw fail('хибний власник')
  }

  /**
   * Ліміт кількості речей одного виду на людину чи гільдію (налаштування сайту «limits»; 0 — без обмежень). Рахується
   * все, що має власник, разом із базами в кошику. Адміністрація й сам сайт — без лімітів.
   */
  const LIMIT_WHAT = (t) => ({ base: t('бази'), roadmap: t('роадмапи'), build: t('білди'), calc: t('розрахунки'), marker: t('позначки на мапі'), place: t('записи ресурсів'), event: t('події') })
  async function checkLimit(req, kind, o) {
    if (!o || o.kind === 'site' || req.ctx?.superuser || req.user?.role === 'admin') return
    const limits = await auth.settings.get('limits', null)
    const n = Number(limits?.[o.kind]?.[kind] ?? DEFAULT_LIMITS[o.kind]?.[kind] ?? 0)
    if (!(n > 0)) return
    const have = (await items.ownedBy(o)).filter((it) => it.kind === kind).length
    if (have < n) return
    const what = LIMIT_WHAT(req.t)[kind] || kind
    throw o.kind === 'guild'
      ? fail('досягнуто ліміту — {what}: не більше {n} на гільдію. Видаліть зайве (і очистіть кошик) чи попросіть адміністрацію', 409, { what, n })
      : fail('досягнуто ліміту — {what}: не більше {n} на людину. Видали зайве (і очисти кошик) чи попроси адміністрацію', 409, { what, n })
  }

  /** де в документі назва (копії її змінюють); записи ресурсів — за ресурсом, їх не перейменовуємо */
  const NAME = {
    base: { get: (d) => d.ui?.name || '', set: (d, v) => { d.ui = { ...(d.ui || {}), name: v } } },
    roadmap: { get: (d) => d.title || '', set: (d, v) => { d.title = v } },
    build: { get: (d) => d.name || '', set: (d, v) => { d.name = v } },
    calc: { get: (d) => d.name || '', set: (d, v) => { d.name = v } },
    marker: { get: (d) => d.title || '', set: (d, v) => { d.title = v } },
  }
  /**
   * Назва копії: «Назва (копія)», а така вже є в того самого власника — «(копія 2)», «(копія 3)»… Копія копії не
   * нарощує хвіст: «(копія)» з назви спершу знімаємо. Мовою людини (t).
   */
  async function copyName(kind, name, owner, t = fill) {
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const one = t('{name} (копія)', { name: '' }), many = t('{name} (копія {n})', { name: '', n: '#' })
    const tail = new RegExp(`(?:${esc(one)}|${esc(many).replace('#', '\\d+')})$`)
    const root = String(name || '').replace(tail, '').trim() || name || ''
    const taken = new Set((await items.ownedBy(owner)).filter((x) => x.kind === kind).map((x) => x.title))
    let n = 1, out = t('{name} (копія)', { name: root })
    while (taken.has(out) && n < 999) out = t('{name} (копія {n})', { name: root, n: ++n })
    return out.slice(0, 120)
  }

  /** копія речі в чужий (свій) простір: документ той самий, назва — з «(копія)», у реєстрі — «на основі …» */
  async function copy(kind, id, owner, by, t = fill) {
    const h = H[kind], src = await items.get(kind, id), doc = h && (await h.read(id))
    if (!src || !doc) throw fail('немає такої речі', 404)
    if (kind === 'base') doc.ui = { ...(doc.ui || {}), name: doc.ui?.name || t('База') }
    if (NAME[kind]) NAME[kind].set(doc, await copyName(kind, NAME[kind].get(doc) || src.title, owner, t))
    // примітка до версії лишається українською («Копія з бібліотеки»): мовою людини її показують там, де читають історію
    const nid = await h.create(doc, 'Копія з бібліотеки', t, by)
    const m = h.meta(doc, t)
    const so = await items.owner(src.owner_kind, src.owner_id, t)
    const it = await items.add(kind, nid, { owner, visibility: owner.kind === 'guild' ? 'guild' : 'private', title: m.title, summary: m.summary, by, basedOn: { kind, id, title: src.title, owner: so.tag ? `[${so.tag}] ${so.name}` : so.name } })
    if (!(src.owner_kind === owner.kind && src.owner_id === owner.id)) await items.copied(kind, id)
    return it
  }

  /** що ще прибрати, коли річ стерто назавжди (знімки бази, її історія змін) — додає app.mjs */
  const afterPurge = []
  /** стерти річ разом із документом */
  async function purge(kind, id) {
    await H[kind]?.purge(id)
    await items.remove(kind, id)
    for (const fn of afterPurge) await fn(kind, id)
  }

  return {
    H,
    ownerFor,
    checkLimit,
    copy,
    copyName,
    purge,
    afterPurge: (fn) => afterPurge.push(fn),
    /** людину видалено: її особисте — стерти */
    async purgeOwned(o) { for (const it of await items.ownedBy(o)) await purge(it.kind, it.id) },
    /** гільдію видалено: її річ — лідеру особисто (видимість «Особисте», якщо була гільдійською) */
    async transferOwned(from, to) {
      for (const it of await items.ownedBy(from)) await items.setAccess(it.kind, it.id, to, it.visibility === 'guild' ? 'private' : it.visibility)
    },
  }
}
