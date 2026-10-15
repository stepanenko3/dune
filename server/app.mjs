/*
 * API-сервер Sandwalkers: записи «Ресурсів» (SQLite) і дані мапи (кеш TH.GL).
 * У розробці його проксує Vite (/api, /map-tiles, /versions); з --serve-dist віддає і зібраний фронт.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import compression from 'compression'
import { createDb, createPlacesStore } from './lib/db.mjs'
import { createMapData } from './lib/thgl.mjs'
import { createPlacesRoutes } from './routes/places.mjs'
import { createMapRoutes } from './routes/map.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function createApp({ dataDir, serveDist = false, log = console }) {
  const db = createDb({ dataDir })
  const places = createPlacesStore(db)
  const mapData = createMapData({ dataDir, log })

  const app = express()
  app.disable('x-powered-by')
  // SSE не стискаємо: інакше події застрягають у буфері компресора
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/stream') && compression.filter(req, res) }))
  app.use(express.json({ limit: '256kb' }))
  app.use(createPlacesRoutes({ places, mapData }))
  app.use(createMapRoutes({ mapData }))
  app.use('/versions', express.static(path.join(root, 'versions'), { maxAge: '1d' }))
  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.use('/api', (req, res) => res.status(404).json({ error: 'немає такого шляху' }))

  if (serveDist) {
    const dist = path.join(root, 'dist')
    app.use(express.static(dist, { maxAge: '1h', index: false }))
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')))
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500
    if (status >= 500) log.error?.(err)
    res.status(status).json({ error: status >= 500 ? 'помилка сервера' : err.message })
  })

  app.locals.close = () => db.close()
  return app
}
