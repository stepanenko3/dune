import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { GetModuleInfo, OutputChunk } from 'rollup'

// Сайт працює через Snotax console: dune.test → host.docker.internal:5180 (див. .snotax.yaml).
// Тому Vite слухає всі інтерфейси і приймає проксований Host; /api, тайли мапи і знімки версій
// віддає API-сервер (server/index.mjs, :5181).
const API = `http://127.0.0.1:${process.env.API_PORT || 5181}`

// Великі бібліотеки — окремими шматками: міняються рідше за код сайту, тож після оновлення сайту лишаються в кеші.
// three.js (сцена на головній і рушій баз) — один шматок на двох; з @snotax/ui — лише те, що реєструє
// components/sn/index.ts (потрібне всім сторінкам); елементи панелі (components/sn/admin.ts) лишаються в її шматку.
const SN_CORE = '/src/components/sn/index.ts'
const snCore = new Map<string, boolean>()
function fromSnCore(id: string, info: GetModuleInfo) {
  if (!snCore.has(id)) {
    const seen = new Set([id])
    const queue = [id]
    let found = false
    while (queue.length && !found) {
      for (const i of info(queue.shift()!)?.importers ?? []) {
        if (i.endsWith(SN_CORE)) found = true
        else if (!seen.has(i)) seen.add(i), queue.push(i)
      }
    }
    snCore.set(id, found)
  }
  return snCore.get(id)
}
function manualChunks(id: string, { getModuleInfo }: { getModuleInfo: GetModuleInfo }) {
  if (id.includes('/node_modules/three/build/') || id.endsWith('/three/examples/jsm/controls/OrbitControls.js')) return 'three'
  if (id.includes('/vendor/snotax-ui/') && fromSnCore(id, getModuleInfo)) return 'snotax-ui'
}

// main.tsx вантажить шматок застосунку лише після словника мови (константи модулів перекладаються під час імпорту),
// тож браузер дізнавався про App-*.js аж тоді. Підказуємо його в index.html заздалегідь: modulepreload лише завантажує
// й розбирає модуль, не виконує — качається разом зі словником, а виконується, коли main.tsx його імпортує.
function preloadApp(): Plugin {
  let base = '/'
  return {
    name: 'preload-app',
    apply: 'build',
    configResolved(c) { base = c.base },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunks = Object.values(ctx.bundle ?? {}).filter((c): c is OutputChunk => c.type === 'chunk')
        // App.tsx сидить у спільному шматку (його модулі беруть і інші сторінки), тож facadeModuleId порожній — шукаємо за модулями
        const app = chunks.find((c) => c.moduleIds.some((id) => id.endsWith('/src/App.tsx')))
        if (!app) return
        const tags: HtmlTagDescriptor[] = []
        const seen = new Set<string>()
        const add = (c: OutputChunk) => {
          if (seen.has(c.fileName)) return
          seen.add(c.fileName)
          if (!html.includes(c.fileName)) tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: base + c.fileName }, injectTo: 'head' })
          for (const css of c.viteMetadata?.importedCss ?? []) {
            if (!html.includes(css) && !seen.has(css)) seen.add(css), tags.push({ tag: 'link', attrs: { rel: 'stylesheet', crossorigin: true, href: base + css }, injectTo: 'head' })
          }
          for (const f of c.imports) { const dep = chunks.find((x) => x.fileName === f); if (dep) add(dep) }
        }
        add(app)
        return tags
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), preloadApp()],
  server: {
    port: 5180,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: { '/api': API, '/map-tiles': API, '/versions': API, '/catalog-icons': API, '/catalog-wiki': API },
  },
  resolve: { alias: { '@': '/src' } },
  // межа попередження — щоб помітити, якщо головний шматок знову розростеться
  build: { chunkSizeWarningLimit: 800, rollupOptions: { output: { manualChunks } } },
  // серверні тести (кілька файлів) ділять одну тестову базу Postgres — по черзі, не разом
  test: { fileParallelism: false },
})
