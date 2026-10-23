/*
 * Карта світу: GET /api/world — місця карти поверхні гри й переходи між мапами мовою запиту (200) чи «даних гри ще
 * нема» (503 — сторінка покаже «Спробувати ще»). Відкрито всім (дані гри, нічого особистого).
 */
import express from 'express'
import { wrap } from './auth.mjs'

export function createWorldRoutes({ world }) {
  const r = express.Router()
  r.get('/api/world', wrap(async (req, res) => {
    const d = world.get(req.lang)
    if (!d) return res.status(503).json({ error: req.t('дані гри ще не завантажено') })
    // мова — з ?lang= (так питає сайт): тоді відповідь від cookie не залежить і браузер її кешує
    res.set('cache-control', 'no-cache').set('etag', d.etag)
    if (!req.query.lang) res.set('vary', 'cookie, accept-language')
    if (req.headers['if-none-match'] === d.etag) return res.status(304).end()
    res.json(d)
  }))
  return r
}
