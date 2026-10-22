// Урізана @snotax/ui (scripts/snotax-ui-trim.mjs) має покривати все, що вживає сайт: інакше компонент без іконки
// чи без класу в тіньовому DOM. Падає — запусти `npm run ui:sync` (урізання перерахується під новий код).
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MANIFEST, staleAgainst, trimCss } from './snotax-ui-trim.mjs'

describe('урізана @snotax/ui', () => {
  it('покриває елементи, класи й іконки сайту', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    expect(staleAgainst(manifest), 'код сайту вживає вирізане з @snotax/ui — запусти npm run ui:sync').toEqual({ elements: [], classes: [], icons: [] })
  })

  it('CSS: лишає правила без класу, ділить списки селекторів, прибирає порожні @media', () => {
    const css = ':host{--a:1}.flex{display:flex}.hidden{display:none}@media (hover:hover){.hover\\:bg-x:hover{color:red}}'
      + '.a\\/b:is(:where(.group):hover *),.c{opacity:1}@keyframes spin{to{rotate:1turn}}.\\32 xl\\:p-1{padding:1px}'
    const { css: out, classes } = trimCss(css, (c) => c === 'flex' || c === 'c' || c === '2xl:p-1')
    expect(out).toBe(':host{--a:1}.flex{display:flex}.c{opacity:1}@keyframes spin{to{rotate:1turn}}.\\32 xl\\:p-1{padding:1px}')
    expect([...classes].sort()).toEqual(['2xl:p-1', 'a/b', 'c', 'flex', 'hidden', 'hover:bg-x'])
  })
})
