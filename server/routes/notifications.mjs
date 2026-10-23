/*
 * Сповіщення сайту (/api/notifications): список свого (з лічильником непрочитаних), «прочитано» (вибрані чи всі),
 * живий потік /stream — лише вкладкам цієї людини (подія { op: 'note', unread }).
 */
import express from 'express'
import { need, wrap } from './auth.mjs'

export function createNotificationRoutes({ notifications, hub }) {
  const r = express.Router()
  r.get('/api/notifications', need(), wrap(async (req, res) => {
    res.set('cache-control', 'no-store').json(await notifications.list(req.user.id, { limit: req.query.limit, before: req.query.before }))
  }))
  r.post('/api/notifications/read', need(), wrap(async (req, res) => {
    await notifications.read(req.user.id, req.body?.all ? 'all' : req.body?.ids)
    res.json({ unread: await notifications.unread(req.user.id) })
  }))
  if (hub) r.get('/api/notifications/stream', (req, res) => hub.open(req, res))
  return r
}
