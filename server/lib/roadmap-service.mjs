/*
 * Права й прогрес роадмапів разом, для маршрутів і для решти сайту: права людини на роадмап (з його налаштувань),
 * прогрес для списків, що робити з прогресом при копії, передачі іншому власнику, видаленні роадмапу чи людини, і
 * одноразове перенесення давніх статусів із документів у записи прогресу.
 */
import { effectiveAccess, insider, normAccess, ownerScope, rightsOf } from './roadmap-access.mjs'
import { emptyState } from './roadmap-progress.mjs'

export function createRoadmapService({ roadmaps, items, progress }) {
  /** права контексту на роадмап (рядок реєстру), разом із його налаштуваннями */
  const rights = async (ctx, it, access) => rightsOf(ctx, it, access === undefined ? await roadmaps.access(it.id) : access)

  /** чи писати позначку в журнал: спільні записи — так; особистий — лише в гільдійському роадмапі свого учасника (прогрес учасників) */
  const logged = (ctx, it, scope) => !scope.startsWith('u:') || (it.owner_kind === 'guild' && insider(ctx, it))

  /** прогрес для списків: Map(id → { n, done }) — за тим записом, який людина бачила б, відкривши роадмап */
  async function listProgress(rows, ctx) {
    const ids = rows.map((r) => r.id)
    const [meta, done] = await Promise.all([roadmaps.meta(ids), progress.doneSets(ids)])
    const out = new Map()
    for (const it of rows) {
      const m = meta.get(it.id)
      if (!m) continue
      const r = rightsOf(ctx || { user: null, ranks: new Map() }, it, m.access)
      // річ, якої контекст не бачить (панель, потоки), — прогрес власника
      const scope = r.view ? r.scope : ownerScope(it)
      const set = scope ? done.get(`${it.id} ${scope}`) : null
      out.set(it.id, { n: m.stages.length, done: set ? m.stages.filter((s) => set.has(s)).length : 0 })
    }
    return out
  }

  /** опис для реєстру (пошук, панель): за записом власника, коли прогрес — власника; інакше «виконано 0» */
  async function ownerState(it, access) {
    const a = effectiveAccess(access === undefined ? await roadmaps.access(it.id) : access, it.owner_kind, it.visibility)
    return a.progress === 'owner' ? progress.state(it.id, ownerScope(it)) : emptyState()
  }

  return {
    rights,
    logged,
    listProgress,
    ownerState,
    /** річ перейшла до іншого власника: права — допустимі для нового власника; роадмап — ще й запис прогресу власника за ним */
    async moved(before, after) {
      if (before.owner_kind === after.owner_kind && before.owner_id === after.owner_id) return
      if (before.kind === 'roadmap') await progress.rescope(before.id, ownerScope(before), ownerScope(after))
      const raw = (await items.get(after.kind, after.id))?.access
      if (raw != null) await items.setRights(after.kind, after.id, normAccess(raw, after.owner_kind, after.kind))
    },
    /** копія: її прогрес — з тих позначок, які людина бачила (state), у запис власника копії */
    async copied(out, state) {
      if (state) await progress.merge(out.id, ownerScope(out), state, out.created_by)
    },
    /**
     * Давні статуси етапів і галочки задач (жили в документі) → запис власника; права наявних — щоб усе виглядало, як
     * учора: є картки «зібрано» (кожен збирав своє у себе) — у кожного свій і відмічають усі, хто увійшов; інакше —
     * прогрес власника, сторонні бачать (як бачили статуси в документі).
     */
    async migrate() {
      await roadmaps.fillStages()
      for (const { id, doc } of await roadmaps.rawDocs()) {
        const it = await items.get('roadmap', id)
        if (!it || !doc) continue
        const st = emptyState()
        for (const s of doc.stages || []) {
          if (s?.status === 'done' || s?.status === 'doing') st.s[s.id] = s.status
          for (const t of s?.tasks || []) if (t?.done) st.t[t.id] = true
        }
        await progress.merge(id, ownerScope(it), st, null)
        if ((await roadmaps.access(id)) == null) {
          const collect = (doc.sections || []).some((s) => s?.collect)
          const a = normAccess(null, it.owner_kind)
          // статуси в документі міняв лише той, хто редагує: у сайту це його автори (а не типове «усі, хто увійшов»)
          await roadmaps.setAccess(id, collect ? { ...a, progress: 'each', mark: 'users' } : { ...a, progress: 'owner', mark: a.edit, seeProgress: 'anyone' })
        }
      }
    },
  }
}
