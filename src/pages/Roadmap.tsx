/**
 * План розвитку — перенесено з classic.html: що є зараз, 4 етапи з цінами, разом і як фармити
 * титан зі ставрідієм. Тексти статичні: ціни переробників — з гри, техніка — частково оцінка.
 */
import type { ReactNode } from 'react'
import { MapPin } from 'lucide-react'
import { Card, SectionTitle } from '@/components/ui/card'
import { PageHead } from '@/components/base/PageHead'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

const FACTS = ['<b>4</b> етапи', '≈ <b>2 000</b> пластану', '≈ <b>2 000</b> меланжу', 'указ Ландсрааду <b>−25%</b> на переробку']

const cellTd = 'border-b border-line py-1 text-right align-top first:pr-2.5 first:text-left [&+td]:whitespace-nowrap [&+td]:pl-2.5 [&+td]:font-mono'

/** таблиця ціни етапу: перший стовпець — назва, решта — моно-числа */
function CostTable({ head, rows }: { head?: string[]; rows: (string[] | { sum: string[] })[] }) {
  return (
    <table className="w-full border-collapse text-[13px] tabular-nums">
      <tbody>
        {head && (
          <tr>
            <th className="border-b border-line py-1" />
            {head.map((h) => (
              <th key={h} className="border-b border-line py-1 pl-2.5 text-right text-[11.5px] font-semibold text-muted">{h}</th>
            ))}
          </tr>
        )}
        {rows.map((r, i) => {
          const sum = !Array.isArray(r)
          const cells = Array.isArray(r) ? r : r.sum
          return (
            <tr key={i} className={cn(sum && 'font-bold')}>
              {cells.map((c, j) => (
                <td key={j} className={cellTd}>{c}</td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Chip({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold', ok ? 'bg-ok/15 text-ok' : 'border border-line bg-panel2 text-muted')}>
      {children}
    </span>
  )
}

function Step({ n, title, chip, why, children, meta }: { n: number; title: string; chip: ReactNode; why: string; children: ReactNode; meta: string }) {
  return (
    <li className="grid min-w-0 content-start gap-2.5 rounded-xl border border-line bg-panel p-3.5 shadow-sm sm:px-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-ink font-mono text-[13px] font-semibold text-panel">{n}</span>
        <h3 className="min-w-0 flex-[1_1_14ch] text-balance font-display text-[14px] font-bold leading-snug">{title}</h3>
        {chip}
      </div>
      <p className="text-[13.5px]">{why}</p>
      {children}
      <p className="text-[12.5px] text-muted">{meta}</p>
    </li>
  )
}

function Src({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[12.5px] text-muted [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-ink">{children}</p>
}

const colList = 'grid list-disc gap-[5px] pl-[18px] text-[13.5px]'

export function Roadmap() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid max-w-[1480px] gap-2.5">
        <PageHead
          title="План розвитку"
          lead="Що будувати далі, скільки це коштує і як добувати титан і ставрідій. Ціни переробників — з гри, деталі техніки — з актуальної бази, решта — оцінка."
          facts={FACTS}
        />

        <section className="grid items-start gap-2.5 lg:grid-cols-[300px_minmax(0,1fr)]" aria-label="План розвитку">
          <Card className="[&_b]:font-mono [&_b]:font-semibold">
            <SectionTitle>Зараз є</SectionTitle>
            <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Переробка</h3>
            <ul className="grid list-disc gap-1 pl-4 text-[13.5px]">
              <li>Середній переробник меланжу <b>×1</b></li>
              <li>Середній переробник руди <b>×4</b></li>
              <li>Середній хімічний <b>×2</b> <span className="text-muted">— більших немає</span></li>
            </ul>
            <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Техніка</h3>
            <ul className="grid list-disc gap-1 pl-4 text-[13.5px]">
              <li>Скаут Mk4, скаут Mk5</li>
              <li>Асаулт Mk5</li>
              <li>Багі Mk5, піскоцикл</li>
            </ul>
            <p className="mt-3.5 rounded-lg border border-line bg-panel2/60 px-3 py-2.5 text-[12.5px] text-muted">
              Цього тижня діє указ Ландсрааду: −25% на вхідні ресурси переробки. Середній бере 563 піску на 10 меланжу замість 750 і 5 титану на злиток пластану замість 6. Будівництво указ не здешевлює.
            </p>
          </Card>

          <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))] gap-2.5">
            <Step
              n={1}
              title="Великий переробник руди"
              chip={<Chip ok>ціна з гри</Chip>}
              why="Пластан з 4 титану замість 6 (з указом — 3 замість 5), злиток за 20 с замість 30. Усе далі коштує сотні злитків, тож він здешевлює кожен наступний етап."
              meta="Відкриття: 20 очок інтелу (від 1 200 витрачених). Бере 350 енергії."
            >
              <CostTable
                rows={[
                  ['Пластанієві злитки', '300'],
                  ['Меланж', '315'],
                  ['Силікон', '450'],
                  ['Кобальтова паста', '550'],
                  ['Складні механізми', '160'],
                  ['Покращені механізми', '40'],
                ]}
              />
            </Step>
            <Step
              n={2}
              title="Грузовий орні і вантажний контейнер"
              chip={<Chip>частково оцінка</Chip>}
              why="Доставляє краулер на поле і везе на Main контейнер: 15 000 об'єму — близько 100 000 спайс-піску за рейс."
              meta="Ще: кобальтова паста, покращені серво (контейнер — 68), конденсатори частинок, бронеплити, діамантиновий пил, гідропоршні. Відкриття: по 60 інтелу за деталь. Точний список — у наборі Carrier Ornithopter Mk6 Assembly у фабрикаторі."
            >
              <CostTable
                head={['Пластан', 'Меланж']}
                rows={[
                  ['Рама Mk6', '85', '42'],
                  ['Двигун Mk6', '45', '42'],
                  ['Головний корпус Mk6', '79', '42'],
                  ['Генератор, хвіст, бічні корпуси, крила', '≈ 190–290', '≈ 175–225'],
                  { sum: ['Грузовий разом', '≈ 400–500', '≈ 300–350'] },
                  ['Вантажний контейнер', '≈ 225', '≈ 105'],
                ]}
              />
            </Step>
            <Step
              n={3}
              title="Краулер"
              chip={<Chip>частково оцінка</Chip>}
              why="Середнє поле — близько 15 000 піску за кілька хвилин; з покращеним контейнером Regis вміщує до 75 000."
              meta="Ще: кобальтова паста, покращені серво, конденсатори частинок, гідропоршні."
            >
              <CostTable
                head={['Пластан', 'Меланж']}
                rows={[
                  ['Рама Mk6', '63', '55'],
                  ['Кабіна, двигун, живлення, пилосос, гусениці, центрифуга', '≈ 240–290', '≈ 295–345'],
                  { sum: ['Разом', '≈ 300–350', '≈ 350–400'] },
                ]}
              />
            </Step>
            <Step
              n={4}
              title="Великий переробник меланжу"
              chip={<Chip ok>ціна з гри</Chip>}
              why="50 піску на меланж замість 75 (з указом — 37,5 замість 56): +50% меланжу з того самого піску. 200 меланжу за 45 хв — у 3,3 раза швидше, води вдвічі менше. Окупається приблизно за 125 000 піску — 8 середніх полів."
              meta="Відкриття: 40 очок інтелу (від 1 200 витрачених)."
            >
              <CostTable
                rows={[
                  ['Пластанієві злитки', '750'],
                  ['Меланж', '840'],
                  ['Силікон', '900'],
                  ['Кобальтова паста', '825'],
                  ['Складні механізми', '280'],
                  ['Покращені механізми', 'звір у грі'],
                ]}
              />
            </Step>
          </ol>

          <Card className="lg:col-span-2">
            <SectionTitle>Разом на 4 етапи</SectionTitle>
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-6 gap-y-3">
              {[
                ['≈ 2 000–2 100', 'пластанієвих злитків'],
                ['≈ 1 900–2 000', 'меланжу'],
                ['≈ 8 800', 'титану (300 злитків у середньому, решта у великому; без указу)'],
                ['≈ 6 150', 'ставрідієвої маси (3 на злиток)'],
                ['≈ 2 500 л', 'води на пластан (1,25 л на злиток)'],
              ].map(([b, s]) => (
                <li key={s}>
                  <b className="block font-mono text-[20px] font-semibold leading-tight tabular-nums">{b}</b>
                  <span className="text-[12.5px] text-muted">{s}</span>
                </li>
              ))}
            </ul>
            <Src>
              Ціни: <a href="https://dune.gaming.tools/placeables/largeorerefinery_placeable" target="_blank" rel="noopener">великий рудний</a> · <a href="https://dune.gaming.tools/placeables/largespicerefinery_placeable" target="_blank" rel="noopener">великий меланжевий</a> · <a href="https://dune.gaming.tools/items/melangespice" target="_blank" rel="noopener">рецепти меланжу</a> · <a href="https://dune.gaming.tools/items/t6refinedresourcea" target="_blank" rel="noopener">рецепти пластану</a> · <a href="https://dune.gaming.tools/items/ornithoptertransportchassis_6" target="_blank" rel="noopener">рама грузового</a> · <a href="https://dune.gaming.tools/items/containervehicle" target="_blank" rel="noopener">контейнер</a> · <a href="https://dune.gaming.tools/items/sandcrawlerchassis_6" target="_blank" rel="noopener">рама краулера</a>
            </Src>
          </Card>

          <Card className="grid gap-3 lg:col-span-2" aria-labelledby="h-farm">
            <div>
              <SectionTitle>
                <span id="h-farm">Титан і ставрідій для пластану</span>
              </SectionTitle>
              <p className="text-[13.5px]">
                Обидва є лише в Deep Desert. Злиток пластану = титанова руда + 1 ставрідієве волокно + 1,25 л води. Волокно робить хімічний переробник із 3 ставрідієвих мас і 0,1 л води.
              </p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-x-7 gap-y-4">
              <div className="grid min-w-0 content-start gap-2">
                <h3 className="text-[13.5px] font-semibold">Скільки треба на 4 етапи</h3>
                <CostTable
                  head={['На злиток', 'Разом']}
                  rows={[
                    ['Титанова руда', '6 → 4', '≈ 8 800'],
                    ['Ставрідієва маса', '3', '≈ 6 150'],
                    { sum: ["Об'єм", '', '≈ 11 000'] },
                  ]}
                />
                <p className="text-[12.5px] text-muted">
                  Перші 300 злитків (на сам великий рудний) — по 6 титану, решта — по 4 у великому. Після нього маси треба майже стільки ж, скільки титану (3 до 4): збирайте обидва, а не лише титан. Титан займає 0,9 об'єму, маса — 0,5, стак 500. Уся руда на план влазить в один вантажний контейнер (15 000).
                </p>
                <p className="text-[12.5px] text-muted">
                  Указ −25% дає 5 титану замість 6 у середньому і 3 замість 4 у великому. Для 3 мас на волокно він, схоже, нічого не дає: 2,25 округлюється до 3, як 562,5 піску до 563.
                </p>
              </div>
              <div className="grid min-w-0 content-start gap-2">
                <h3 className="text-[13.5px] font-semibold">Де шукати</h3>
                <ul className={colList}>
                  <li>З квітня 2026 (патч 1.3.20) Deep Desert — два окремі світи: PvE на всю сітку 9×9 і PvP. У PvP вузлів більше і видобуток ×2,5 (за гайдами), у PvE — безпечно, але рідше.</li>
                  <li>Титан — темно-сині шипи на сіро-блакитних скелях. Ставрідій — бірюзово-зелені пластини на схилах червоних каньйонів. Обидва — біля скельних масивів і уламків кораблів.</li>
                  <li>Сектори з гайдів (E9, G4–G5…) застаріли: після бурі карта щотижня інша.</li>
                  <li>Найближче до Хагга — Щитова стіна і ряд A: з патча 1.1.20 вузли є і там.</li>
                  <li>Вузол у PvE відновлюється за 45 хв. Вичерпані вузли позначаються на карті до бурі.</li>
                  <li>Гравці пишуть, що щотижня є 2 невеликі райони з дуже густим титаном або ставрідієм — шукайте їх у перший день після бурі.</li>
                </ul>
                {/* нове порівняно з класичною сторінкою: одразу на мапу з шарами титану і ставрідію */}
                <a
                  href="/map?m=deepdesert_1&l=titanium,stravidium"
                  onClick={(e) => {
                    e.preventDefault()
                    useStore.getState().setView('map', { search: '?m=deepdesert_1&l=titanium,stravidium' })
                  }}
                  className="mt-1 inline-flex h-8 w-fit max-w-full items-center gap-1.5 rounded-md border border-line bg-panel2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-line/60"
                >
                  <MapPin size={14} className="shrink-0 text-spice" />
                  <span className="truncate">Відкрити на мапі Глибокої пустелі</span>
                </a>
              </div>
              <div className="grid min-w-0 content-start gap-2">
                <h3 className="text-[13.5px] font-semibold">Чим добувати</h3>
                <ul className={colList}>
                  <li>Ручний різак — щонайменше Mk5, краще Mk6. Тільки в ручного є режим аналізу з бонусом до видобутку.</li>
                  <li>Багі: різак для багі Mk6 на задньому модулі Utility Rear (у ньому слот під турель) і модуль сховища. У таблиці Mk5 титану й ставрідію немає — схоже, не бере; перевірте в грі.</li>
                  <li>Різак багі Mk6 бере титан і ставрідій у 4 рази повільніше, ніж мідь чи граніт (90 проти 375), але не треба виходити з машини. Focused-версія — ще +20–30%.</li>
                  <li>Планетолог: Cutteray Mining +10/15/20% і Deep Analysis +10/15/20% до бонусу аналізу.</li>
                </ul>
              </div>
              <div className="grid min-w-0 content-start gap-2">
                <h3 className="text-[13.5px] font-semibold">Форпост і коло — як з алюмінієм</h3>
                <ol className={cn(colList, 'list-decimal')}>
                  <li>Перший день після бурі облетіти сектори скаутом Mk5 зі сканером і знайти 2–3 скельні масиви, де є і титан, і ставрідій.</li>
                  <li>Форпост DD поставити на скелі між ними (черв'як не дістане). Краще в середніх рядах, де й середні поля спайсу: одна база і на руду, і на пісок.</li>
                  <li>Коло на 40–50 хв: поки його пройдете, перші вузли відновляться.</li>
                  <li>Удвох: один на багі по підніжжях і полицях, куди можна заїхати; другий на скауті з ручним різаком — по вершинах і стрімких схилах.</li>
                  <li>Пісок між масивами — черв'як: по ньому лише короткі перебіжки, далеко — орні.</li>
                  <li>Після кожного кола — у склад форпосту. На Main поки возити в орні, після етапу 2 — грузовим у контейнері. Переробляти великими партіями в тижні указу.</li>
                </ol>
              </div>
            </div>
            <Src>
              Джерела: <a href="https://www.method.gg/dune-awakening/where-to-find-and-farm-stravidium-mass-and-titanium-ore-in-dune-awakening" target="_blank" rel="noopener">де фармити</a> · <a href="https://awakening.wiki/Titanium_Ore" target="_blank" rel="noopener">титан</a> · <a href="https://awakening.wiki/Stravidium_Mass" target="_blank" rel="noopener">ставрідій</a> · <a href="https://awakening.wiki/Buggy_Cutteray_Mk6" target="_blank" rel="noopener">різак багі Mk6</a> · <a href="https://method.gg/dune-awakening/dune-awakening-patch-1-1-0-17-brings-first-deep-desert-pve-changes" target="_blank" rel="noopener">відновлення 45 хв</a> · <a href="https://mein-mmo.de/en/dune-awakening-patch-mehr-mats-deep-desert-pve,1519946" target="_blank" rel="noopener">вузли на Щитовій стіні</a> · <a href="https://howtoplayhub.com/dune-awakening/deep-desert-guide" target="_blank" rel="noopener">PvE і PvP з 1.3.20</a> · <a href="https://www.keengamer.com/articles/guides/best-planetologist-build-and-skills-guide-dune-awakening/" target="_blank" rel="noopener">планетолог</a>
            </Src>
          </Card>
        </section>
      </div>
    </div>
  )
}
