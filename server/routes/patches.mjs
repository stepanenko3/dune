/*
 * «Що змінилось у патчі» (/api/patches): стрічка патчів гри і один патч — мовою людини. Назви й тексти лежать у патчі
 * всіма мовами гри; у відповідь іде лише мова людини (сайт без англійської в інших мовах). Порахувати знову може адмін (той самий перерахунок робить і перевірка даних гри).
 */
import express from 'express'
import { wrap } from './auth.mjs'

/** розмітка тексту гри (<GreatHouse>Великого Дому</>) — геть, лишається сам текст */
const plainText = (v) => (typeof v === 'string' ? v.replace(/<\/?[A-Za-z][\w.]*>|<\/>/g, '') : v)

/** картка мовою: loc — назва мовою людини (нема перекладу — null), names — геть */
function localCard(x, lang) {
  if (!x) return x
  const { names = {}, ...rest } = x
  return { ...rest, loc: names[lang] ?? (lang === 'en' ? x.name ?? null : null) }
}

/** змінений запис мовою: назва й опис — текстами цієї мови (text), а не англійськими значеннями полів */
function localChanged(x, lang) {
  const { texts = {}, fields = [], ...rest } = x
  const card = localCard(rest, lang)
  const textual = fields.filter(([k]) => k === 'name' || k === 'desc').map(([k]) => k)
  const other = fields.filter(([k]) => k !== 'name' && k !== 'desc')
  const raw = texts[lang] ?? null
  const t = raw && Object.fromEntries(Object.entries(raw).map(([k, pair]) => [k, pair.map(plainText)]))
  const out = { ...card, fields: other }
  if (textual.length) out.textChanged = textual
  if (t) out.text = t
  return out
}

export function localPatch(p, lang) {
  const sections = {}
  for (const [s, d] of Object.entries(p.notes.sections ?? {})) {
    sections[s] = { added: d.added.map((x) => localCard(x, lang)), removed: d.removed.map((x) => localCard(x, lang)), changed: d.changed.map((x) => localChanged(x, lang)) }
  }
  const refs = Object.fromEntries(Object.entries(p.notes.refs ?? {}).map(([id, x]) => [id, localCard(x, lang)]))
  const { notes, ...head } = p
  return { ...head, sections, map: notes.map ?? null, refs }
}

export function createPatchRoutes({ patches, roles }) {
  const r = express.Router()
  r.get('/api/patches', wrap(async (req, res) => {
    res.set('cache-control', 'no-cache').json({ items: patches ? await patches.list() : [] })
  }))
  r.get('/api/patches/:build', wrap(async (req, res) => {
    const p = patches && /^\d{1,12}$/.test(req.params.build) ? await patches.get(req.params.build) : null
    if (!p) return res.status(404).json({ error: req.t('немає такого патча') })
    res.set('cache-control', 'no-cache').set('vary', 'cookie, accept-language').json(localPatch(p, req.lang))
  }))
  r.post('/api/admin/patches/scan', wrap(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: req.t('потрібно увійти') })
    if (!(await roles.can(req.user, 'gamedata.manage'))) return res.status(403).json({ error: req.t('бракує прав') })
    res.json({ made: patches ? await patches.scan() : [] })
  }))
  return r
}
