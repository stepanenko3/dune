/** Запуск процесу без оболонки: вихід (stdout+stderr) — у out; ненульовий код — помилка з останніми рядками виводу. */
import { spawn } from 'node:child_process'

export function run(cmd, args = [], { cwd, env, timeoutMs, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env })
    let out = ''
    let rest = ''
    const take = (b) => {
      const s = b.toString()
      out += s
      if (!onLine) return
      rest += s
      const lines = rest.split('\n')
      rest = lines.pop()
      for (const l of lines) onLine(l)
    }
    p.stdout.on('data', take)
    p.stderr.on('data', take)
    const timer = timeoutMs ? setTimeout(() => p.kill('SIGKILL'), timeoutMs) : null
    p.on('error', (e) => { if (timer) clearTimeout(timer); reject(e) })
    p.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      if (code === 0) return resolve({ code, out })
      const tail = out.trimEnd().split('\n').slice(-20).join('\n')
      reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')}…: код ${code ?? signal}\n${tail}`))
    })
  })
}
