/*
 * WebSocket без залежностей (RFC 6455, як паскеї й TOTP — своїм кодом): рукостискання на «upgrade» HTTP-сервера, кадри
 * тексту (з частинами), ping / pong, закриття. Лише те, що треба чату: текстові JSON-повідомлення до 64 КБ, без
 * розширень (стиснення не узгоджуємо). Сервер сам пінгує раз на 25 с і закриває з'єднання, що мовчить 70 с.
 */
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX = 64 * 1024

/** кадр від сервера (без маски): opcode і корисне навантаження */
function frame(op, payload = Buffer.alloc(0)) {
  const n = payload.length
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => {
    const b = Buffer.alloc(10)
    b[0] = 0x80 | op
    b[1] = 127
    b.writeBigUInt64BE(BigInt(n), 2)
    return b
  })()
  return Buffer.concat([head, payload])
}

/**
 * Прийняти з'єднання (запит «upgrade» уже перевірено): повертає conn — EventEmitter з подіями 'message' (рядок) і
 * 'close'; conn.send(об'єкт) шле JSON, conn.close() закриває. Не WebSocket-запит — null (сокет закрито з 400).
 */
export function acceptWs(req, socket, head) {
  const key = req.headers['sec-websocket-key']
  if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    return null
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64')
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'))
  socket.setNoDelay(true)
  const conn = new EventEmitter()
  let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0)
  let parts = []
  let open = true
  let heard = Date.now()
  const end = () => {
    if (!open) return
    open = false
    clearInterval(beat)
    socket.destroy()
    conn.emit('close')
  }
  const beat = setInterval(() => {
    if (Date.now() - heard > 70_000) return end()
    if (open) socket.write(frame(0x9))
  }, 25_000)
  beat.unref?.()

  conn.send = (obj) => { if (open && socket.writable) socket.write(frame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)))) }
  conn.close = (code = 1000) => {
    if (!open) return
    const p = Buffer.alloc(2)
    p.writeUInt16BE(code)
    try { socket.write(frame(0x8, p)) } catch { /* сокет уже закрито */ }
    end()
  }

  /** розібрати кадри з буфера (клієнт завжди маскує) */
  const parse = () => {
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0
      let len = buf[1] & 0x7f, at = 2
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4 }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX)) return conn.close(1009); len = Number(big); at = 10 }
      if (!masked || len > MAX) return conn.close(1002)
      if (buf.length < at + 4 + len) return
      const mask = buf.subarray(at, at + 4)
      const data = Buffer.from(buf.subarray(at + 4, at + 4 + len))
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3]
      buf = buf.subarray(at + 4 + len)
      heard = Date.now()
      if (op === 0x8) return conn.close()
      if (op === 0x9) { socket.write(frame(0xa, data)); continue }
      if (op === 0xa) continue
      if (op === 0x1 || op === 0x0) {
        parts.push(data)
        if (parts.reduce((n, p) => n + p.length, 0) > MAX) return conn.close(1009)
        if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; conn.emit('message', text) }
        continue
      }
      // двійкові кадри чату не потрібні
      return conn.close(1003)
    }
  }
  socket.on('data', (d) => { buf = Buffer.concat([buf, d]); try { parse() } catch { end() } })
  socket.on('close', end)
  socket.on('error', end)
  return conn
}
