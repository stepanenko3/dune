/*
 * Сховище файлів (зображення й інше): S3-сумісне — RustFS із Snotax console (S3_ENDPOINT, S3_BUCKET, S3_KEY,
 * S3_SECRET, S3_REGION у .env), без S3_ENDPOINT — тека на диску (<dataDir>/files). Клієнт S3 — свій, з підписом
 * AWS SigV4 на node:crypto, без залежностей (як паскеї). Адреса файлу для браузера — /media/<ключ>; віддає її
 * маршрут mediaRoute() з довгим кешем (ключі незмінні: новий вміст — новий ключ).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** ключ: латиниця, цифри, «-_.», теки через «/»; без «..» і порожніх сегментів */
const SAFE_KEY = /^[\w-]+(\/[\w.-]+)*$/
export const safeKey = (k) => typeof k === 'string' && k.length <= 300 && SAFE_KEY.test(k) && !k.split('/').some((s) => s === '..' || s === '.')

const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', json: 'application/json', txt: 'text/plain; charset=utf-8', pdf: 'application/pdf' }
export const typeOf = (key) => TYPES[path.extname(key).slice(1).toLowerCase()] || 'application/octet-stream'

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest()
/** RFC 3986: S3 кодує все, крім unreserved; «/» у шляху лишаємо */
const enc = (s, slash = false) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(slash ? /%2F/g : /$^/, '/')

/** S3 з path-style адресами (RustFS, MinIO): http://host:9000/<bucket>/<key> */
function s3Client({ endpoint, bucket, key: accessKey, secret, region = 'us-east-1' }) {
  const base = new URL(endpoint)
  async function call(method, objectKey, { body, query = {}, type } = {}) {
    const p = '/' + bucket + (objectKey ? '/' + enc(objectKey, true) : '')
    const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&')
    const now = new Date()
    const amz = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const day = amz.slice(0, 8)
    const payload = body ? sha(body) : sha('')
    const headers = { host: base.host, 'x-amz-content-sha256': payload, 'x-amz-date': amz }
    if (type) headers['content-type'] = type
    const names = Object.keys(headers).sort()
    const canonical = [method, p, qs, names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), payload].join('\n')
    const scope = `${day}/${region}/s3/aws4_request`
    const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n')
    const kSign = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), 's3'), 'aws4_request')
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hmac(kSign, toSign).toString('hex')}`
    delete headers.host
    return fetch(`${base.origin}${p}${qs ? '?' + qs : ''}`, { method, headers, body, signal: AbortSignal.timeout(30_000) })
  }
  const ok = async (r, what) => { if (!r.ok) throw new Error(`S3 ${what}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); return r }
  let ready = null
  /** кошик створюємо сам, якщо його ще нема */
  const ensure = () => (ready ??= call('HEAD', '').then(async (r) => {
    if (r.status === 404) await ok(await call('PUT', ''), 'create bucket')
    else if (!r.ok) throw new Error(`S3 bucket: HTTP ${r.status}`)
  }).catch((e) => { ready = null; throw e }))
  return {
    kind: 's3',
    where: `${base.host}/${bucket}`,
    async put(k, buf, type = typeOf(k)) { await ensure(); await ok(await call('PUT', k, { body: buf, type }), 'put') },
    async get(k) {
      await ensure()
      const r = await call('GET', k)
      if (r.status === 404) return null
      await ok(r, 'get')
      return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || typeOf(k) }
    },
    async has(k) { await ensure(); const r = await call('HEAD', k); return r.ok },
    async del(k) { await ensure(); const r = await call('DELETE', k); if (!r.ok && r.status !== 404) await ok(r, 'delete') },
    /** ключі з префіксом: [{ key, size, modified }] */
    async list(prefix = '') {
      await ensure()
      const out = []
      let token = null
      do {
        const q = { 'list-type': 2, prefix, ...(token ? { 'continuation-token': token } : {}) }
        const xml = await (await ok(await call('GET', '', { query: q }), 'list')).text()
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const tag = (n) => m[1].match(new RegExp(`<${n}>([^<]*)</${n}>`))?.[1] ?? ''
          out.push({ key: tag('Key').replace(/&amp;/g, '&'), size: Number(tag('Size')), modified: Date.parse(tag('LastModified')) || 0 })
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]*)</)?.[1] ?? null : null
      } while (token)
      return out
    },
  }
}

/** тека на диску — коли S3 не налаштовано (тести, SQLite-режим) */
function diskClient(dir) {
  const file = (k) => path.join(dir, ...k.split('/'))
  return {
    kind: 'disk',
    where: dir,
    async put(k, buf) { fs.mkdirSync(path.dirname(file(k)), { recursive: true }); fs.writeFileSync(file(k), buf) },
    async get(k) { try { return { buf: fs.readFileSync(file(k)), type: typeOf(k) } } catch { return null } },
    async has(k) { return fs.existsSync(file(k)) },
    async del(k) { fs.rmSync(file(k), { force: true }) },
    async list(prefix = '') {
      const out = []
      const walk = (d, rel) => {
        let names = []
        try { names = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
        for (const n of names) {
          const r = rel ? `${rel}/${n.name}` : n.name
          if (n.isDirectory()) walk(path.join(d, n.name), r)
          else if (r.startsWith(prefix)) { const st = fs.statSync(path.join(d, n.name)); out.push({ key: r, size: st.size, modified: st.mtimeMs }) }
        }
      }
      walk(dir, '')
      return out
    },
  }
}

/**
 * сховище за .env: S3_ENDPOINT (+ S3_BUCKET, S3_KEY, S3_SECRET, S3_REGION) — S3, інакше тека <dataDir>/files.
 * Ключі перевіряються (safeKey) — зовнішній ключ не вийде за межі кошика чи теки.
 */
export function createStorage({ dataDir, env = process.env } = {}) {
  const c = env.S3_ENDPOINT
    ? s3Client({ endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET || 'sandwalkers', key: env.S3_KEY || '', secret: env.S3_SECRET || '', region: env.S3_REGION || 'us-east-1' })
    : diskClient(path.join(dataDir || '.', 'files'))
  const check = (k) => { if (!safeKey(k)) throw new Error('хибний ключ файлу: ' + k) }
  return {
    kind: c.kind,
    where: c.where,
    put: (k, buf, type) => (check(k), c.put(k, buf, type)),
    get: (k) => (safeKey(k) ? c.get(k) : Promise.resolve(null)),
    has: (k) => (safeKey(k) ? c.has(k) : Promise.resolve(false)),
    del: (k) => (check(k), c.del(k)),
    list: (prefix) => c.list(prefix),
    /** адреса для браузера */
    url: (k) => '/media/' + k,
    /** ключ з адреси /media/<ключ> (або null) */
    keyOf: (url) => { const m = /^\/media\/(.+)$/.exec(String(url || '')); return m && safeKey(m[1]) ? m[1] : null },
  }
}

/** ключі private/… (знімки баз із правами доступу) — лише через свої маршрути, не через /media */
export const isPrivateKey = (k) => String(k).startsWith('private/')

/** express-обробник для GET /media/<ключ>: файл зі сховища, незмінний — кеш на рік */
export function mediaRoute(storage) {
  return (req, res, next) => {
    let k
    try { k = decodeURIComponent(req.path.replace(/^\/+/, '')) } catch { return res.status(404).end() }
    if (!safeKey(k) || isPrivateKey(k)) return res.status(404).end()
    storage.get(k).then((f) => {
      if (!f) return res.status(404).end()
      res.type(f.type).set('cache-control', 'public, max-age=31536000, immutable')
      // svg з чужих джерел — без скриптів
      if (/svg/.test(f.type)) res.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      res.send(f.buf)
    }, next)
  }
}
