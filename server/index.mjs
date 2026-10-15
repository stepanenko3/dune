import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serveDist = process.argv.includes('--serve-dist')
const app = await createApp({ dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'), serveDist })
const port = Number(process.env.PORT || process.env.API_PORT) || 5181
app.listen(port, '127.0.0.1', () => console.log(`[api] http://127.0.0.1:${port}${serveDist ? ' (з фронтом)' : ''}`))
