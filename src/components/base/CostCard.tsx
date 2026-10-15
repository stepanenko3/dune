/**
 * Кошторис: кількість і ціну можна виправити прямо в комірці; правки зберігаються для кожної бази
 * окремо (prefs `base:<id>:cost`). Комірка тримає сирий текст, доки її правлять, — інакше «7,» чи
 * порожнє поле одразу перетворювались би на число і заважали набирати.
 */
import { useMemo, useState } from 'react'
import { Card, SectionTitle } from '@/components/ui/card'
import { prefGet, prefSet } from '@/lib/prefs'
import { cn, fmtN, fmtP } from '@/lib/utils'
import type { BaseCtx } from './ctx'

type Field = 'n' | 'price'
type Overrides = Record<string, Partial<Record<Field, number>>>

const num = (v: string) => Number(String(v).trim().replace(/\s/g, '').replace(',', '.'))
const devId = (d: any) => (d.id === 'shield' ? 'shield' : 'd-' + d.id)
const keyOf = (row: string, f: Field) => row + '|' + f

const th = 'border-b border-line px-1 py-[5px] text-right align-middle text-[11.5px] font-semibold text-muted first:pl-0 first:text-left'
const td = 'border-b border-line px-1 py-[5px] text-right align-middle first:pl-0 first:text-left'

export function CostCard({ C }: { C: BaseCtx }) {
  const prefKey = `base:${C.id}:cost`
  const c = useMemo(() => C.B.cost(C.res), [C])
  const short: Record<string, string> = Object.fromEntries(c.MATS.map((m: any) => [m.id, m.short]))
  const [ov, setOv] = useState<Overrides>(() => prefGet<Overrides>(prefKey, {}))
  const [draft, setDraft] = useState<Record<string, string>>({})

  // значення комірки для підрахунку: валідний текст, інакше збережена правка чи стандартне
  const val = (row: string, f: Field, def: number) => {
    const d = draft[keyOf(row, f)]
    if (d !== undefined) {
      const v = num(d)
      if (d.trim() !== '' && isFinite(v) && v >= 0) return v
      return def
    }
    return ov[row]?.[f] ?? def
  }

  const edit = (row: string, f: Field, def: number, text: string) => {
    setDraft((d) => ({ ...d, [keyOf(row, f)]: text }))
    const o: Overrides = { ...ov, [row]: { ...ov[row] } }
    const v = num(text)
    if (text.trim() === '' || !isFinite(v) || v < 0 || Math.abs(v - def) < 1e-9) delete o[row][f]
    else o[row][f] = v
    if (!Object.keys(o[row]).length) delete o[row]
    prefSet(prefKey, o)
    setOv(o)
  }

  const cell = (row: string, name: string, f: Field, def: number, label: string) => {
    const k = keyOf(row, f)
    const saved = ov[row]?.[f]
    const shown = draft[k] ?? (f === 'n' ? String(Math.round(saved ?? def)) : fmtP(saved ?? def))
    return (
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        aria-label={`${label}: ${name}`}
        onChange={(e) => edit(row, f, def, e.target.value)}
        // порожня або хибна комірка після виходу показує стандартне значення
        onBlur={() => {
          const d = draft[k]
          if (d !== undefined && (d.trim() === '' || !isFinite(num(d))))
            setDraft((x) => {
              const rest = { ...x }
              delete rest[k]
              return rest
            })
        }}
        className={cn(
          'w-[7.5ch] rounded-[5px] border border-transparent bg-transparent px-[5px] py-[3px] text-right tabular-nums text-ink',
          'hover:border-line hover:bg-panel2 focus:border-spice focus:bg-panel focus:outline-none',
          saved !== undefined && 'border-line font-semibold text-spice',
        )}
      />
    )
  }

  let stone = 0
  const sums: Record<string, number> = {}
  for (const r of c.rows) {
    const x = val(r.id, 'n', r.n) * val(r.id, 'price', r.price)
    sums[r.id] = x
    stone += x
  }
  // усе разом: камінь + матеріали пентащитів і пристроїв; паливо — на тиждень роботи генераторів
  const need: Record<string, number> = {}, n: Record<string, number> = {}
  let gives = 0, takes: number = c.shieldDraw
  for (const x of c.devices) {
    n[x.id] = val(devId(x), 'n', x.n)
    for (const [m, q] of Object.entries(x.mats as Record<string, number>)) need[m] = (need[m] || 0) + n[x.id] * q
    if (x.power > 0) gives += n[x.id] * x.power
    else takes -= n[x.id] * x.power
  }
  const all: [number, string][] = [[Math.ceil(stone), 'гранітного каменю'], ...c.MATS.filter((m: any) => need[m.id]).map((m: any) => [Math.ceil(need[m.id]), m.name] as [number, string])]
  if (n.generator) all.push([n.generator * c.fuelWeek, 'паливних елементів на тиждень'])
  const edited = Object.keys(ov).length > 0
  const sub = 'mb-1 mt-4 text-[13px] font-semibold'

  return (
    <Card>
      <SectionTitle>Кошторис</SectionTitle>
      <h3 className={cn(sub, 'mt-0')}>Будівельні деталі</h3>
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>
            <th className={th}>Деталь</th>
            <th className={th}>К-сть</th>
            <th className={th}>Ціна</th>
            <th className={th}>Каменю</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r: any) => (
            <tr key={r.id}>
              <td className={cn(td, r.sub && '!pl-3 text-muted')}>{r.name}</td>
              <td className={td}>{cell(r.id, r.name, 'n', r.n, 'Кількість')}</td>
              <td className={td}>{cell(r.id, r.name, 'price', r.price, 'Ціна')}</td>
              <td className={cn(td, 'whitespace-nowrap font-mono')}>{fmtN(sums[r.id])}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className="px-1 py-[5px] pl-0">Разом гранітного каменю</td>
            <td />
            <td />
            <td className="whitespace-nowrap px-1 py-[5px] text-right font-mono">{fmtN(stone)}</td>
          </tr>
        </tfoot>
      </table>
      {c.devices.length > 0 && (
        <>
          <h3 className={sub}>Пентащити й пристрої</h3>
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead>
              <tr>
                <th className={th}>Пристрій</th>
                <th className={th}>К-сть</th>
                <th className={cn(th, 'pl-2.5 text-left')}>На один</th>
              </tr>
            </thead>
            <tbody>
              {c.devices.map((x: any) => (
                <tr key={x.id}>
                  <td className={td}>{x.name}</td>
                  <td className={td}>{cell(devId(x), x.name, 'n', x.n, 'Кількість')}</td>
                  <td className={cn(td, 'pl-2.5 text-left text-[12px] text-muted')}>
                    {Object.entries(x.mats as Record<string, number>).map(([m, q]) => `${fmtP(q)} ${short[m]}`).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3 className={sub}>Що зібрати — усе разом</h3>
      <ul className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-[18px] gap-y-2.5">
        {all.map(([q, name]) => (
          <li key={name}>
            <b className="block font-mono text-[17px] font-semibold leading-tight tabular-nums">{fmtN(q)}</b>
            <span className="text-[12.5px] text-muted">{name}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[12.5px] text-muted">
        {c.factor !== 1 ? `Знижка Deep Desert ×${fmtP(c.factor)}. ` : ''}
        {gives ? `Енергія: ${fmtN(gives)} є, ${fmtN(takes)} треба. ` : ''}
        {edited && (
          <button
            type="button"
            className="text-spice underline underline-offset-2"
            onClick={() => {
              prefSet(prefKey, {})
              setOv({})
              setDraft({})
            }}
          >
            Скинути правки
          </button>
        )}
      </p>
      <p className="mt-3 text-[12.5px] text-muted [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-ink">
        Джерела: <a href="https://dune.gaming.tools/buildables/sardaukar_foundation" target="_blank" rel="noopener">фундамент</a> · <a href="https://dune.gaming.tools/buildables/sardaukar_wall_02" target="_blank" rel="noopener">стіна</a> · <a href="https://dune.gaming.tools/buildables/sardaukar_column" target="_blank" rel="noopener">колона</a> · <a href="https://awakening.wiki/Sardaukar_Building_Set" target="_blank" rel="noopener">увесь набір</a> · <a href="https://dune.gaming.tools/placeables/choam_pentashieldsurfacevertical_placeable" target="_blank" rel="noopener">пентащит</a> · <a href="https://www.method.gg/dune-awakening/building-in-the-deep-desert-in-dune-awakening-a-full-guide" target="_blank" rel="noopener">−50% у Deep Desert</a> · <a href="https://dune.gaming.tools/placeables/generator_placeable" target="_blank" rel="noopener">генератор</a> · <a href="https://dune.gaming.tools/placeables/fabricator_placeable" target="_blank" rel="noopener">фабрикатор</a> · <a href="https://dune.gaming.tools/placeables/repairstation_placeable" target="_blank" rel="noopener">ремонтна станція</a> · <a href="https://dune.gaming.tools/placeables/storagecontainer_placeable" target="_blank" rel="noopener">контейнер</a> · <a href="https://dune.gaming.tools/placeables/totem_placeable" target="_blank" rel="noopener">розширена консоль</a> · <a href="https://dune.gaming.tools/items/oil" target="_blank" rel="noopener">паливний елемент</a> · <a href="https://awakening.wiki/Solido_Replicator" target="_blank" rel="noopener">реплікатор</a>
      </p>
    </Card>
  )
}
