// Ціни деталей у рушії (PRICE) — знімок даних гри. Новий пакет видобувача (GAMEDATA_BUNDLE_DIR) з іншими цінами — цей
// тест падає: знімок треба оновити з пакета. Без пакета (CI, живий без видобувача) — пропуск.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — рушій на чистому JS, без типів
import * as m from './pieces.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
const P: any = (m as any).default ?? (globalThis as any).PIECES

function bundleBuildables(): Map<string, [string, number][]> | null {
  const dir = process.env.GAMEDATA_BUNDLE_DIR
  if (!dir) return null
  try {
    const latest = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'))
    const b = path.join(dir, String(latest.build))
    const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(b, 'sections', 'buildables.json.gz'))).toString('utf8')).records
    return new Map(rows.map((r: any) => [r.id, r.cost]))
  } catch { return null }
}
const game = bundleBuildables()

describe.skipIf(!game)('ціни деталей = дані гри', () => {
  it('кожна форма рушія є в пакеті й коштує стільки ж', () => {
    const diff = Object.keys(P.SHAPES).filter((id) => P.SHAPES[id].family !== 'shield' || game!.has(id))
      .filter((id) => JSON.stringify(game!.get(id) ?? null) !== JSON.stringify(P.PRICE[id] ?? null))
    expect(diff).toEqual([])
  })
})
