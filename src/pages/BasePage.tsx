/**
 * Сторінка бази — перенесена з classic.html/app.js: план і 3D ліворуч, легенда й приміщення праворуч
 * (на вузькому екрані — висувний лист), під ними ліміти, етапи, кошторис і версії. База — документ із
 * сервера (lib/bases.ts, живі оновлення поки сторінка відкрита); «Редагувати» відкриває редактор (/bases/<id>/edit),
 * «Вивантажити» — файл бази (його можна імпортувати на сторінці «Бази» чи на іншому сайті Sandwalkers; лише після входу
 * й тим, кому копіювати дозволено), «Видалити» —
 * у кошик. Модель, підрахунки і 3D-сцена живуть у контексті бази (components/base/ctx.ts) — переживають перемикання
 * вкладок; тут лише стан показу. Обрив мережі — «спробувати ще», а не вічне завантаження; гостю — «Увійти».
 */
import { useEffect, useState } from 'react'
import { Download, LogIn, PencilRuler, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { downloadBase, useBases, useBasesLive, type BaseEnvelope } from '@/lib/bases'
import { t } from '@/lib/i18n'
import { useStore } from '@/store'
import { loginHref, useAuth } from '@/lib/auth'
import { plainClick } from '@/lib/urlState'
import { VERSIONS } from '@/lib/engine'
import { Button } from '@/components/ui/button'
import { context } from '@/components/base/ctx'
import { PageHead } from '@/components/base/PageHead'
import { BaseViewer } from '@/components/base/BaseViewer'
import { BuildPlan, Limits } from '@/components/base/BuildCards'
import { BaseCalc } from '@/components/base/BaseCalc'
import { Versions } from '@/components/base/Versions'
import { Confirm, eraseBase, trashBase, untrashBase } from '@/components/base/Ask'
import { Builder } from '@/components/base/builder/Builder'
import { readDraft } from '@/components/base/builder/store'
import { DraftRescue } from '@/components/base/builder/DraftRescue'
import { ItemActions, ItemBar } from '@/components/access/Access'
import { Empty, Loading, PageError } from '@/components/states'
import { useCrumb, useScopeOf } from '@/components/Crumbs'

const shell = (body: React.ReactNode) => (
  <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
    <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
      {body}
    </div>
  </div>
)

export function BasePage({ base }: { base: string }) {
  useBasesLive()
  const env = useBases((s) => s.docs[base])
  const edit = useStore((s) => s.edit)
  const { user, ready } = useAuth()
  // шлях: Бази (вкладка, де база лежить) › назва бази (› Редагування)
  const loaded = env && typeof env === 'object' ? env : null
  const scope = useScopeOf(loaded?.item?.owner)
  // поки вантажиться — шляху нема (null); не завантажилась — без назви ([])
  useCrumb(env === 'error' || env === 'missing' ? [] : loaded ? [{ label: loaded.doc?.ui?.name || loaded.item?.title || t('База'), view: 'bases', base: loaded.id }, ...(edit ? [{ label: t('Редагування') }] : [])] : null, { sub: scope })
  useEffect(() => { void useBases.getState().loadBase(base) }, [base])
  const retry = () => void useBases.getState().loadBase(base, true)
  if (!env) return <Loading page label={t('Завантаження бази…')} />
  if (env === 'error') return shell(<PageError title={t('Базу не завантажено')} message={t('Не вдалося завантажити базу — перевір з’єднання й спробуй ще раз.')} onRetry={retry} />)
  if (env === 'missing')
    return shell(user || !ready
      ? <PageError title={t('Немає такої бази')} message={t('Немає такої бази — можливо, посилання застаріло чи доступ до неї змінили.')} onRetry={retry} />
      : (
        <Empty icon={LogIn} title={t('Немає такої бази або вона не публічна')} description={t('Особисті й гільдійські бази видно після входу.')}>
          <Button onClick={() => location.assign(loginHref())}>{t('Увійти')}</Button>
        </Empty>
      ))
  // редактор — лише тим, кому базу можна змінювати; решті — перегляд. Права зникли посеред редагування (вигнали з
  // гільдії, змінили доступ) — незбережені правки не пропадають мовчки: їх можна зберегти як свою базу чи вивантажити
  if (edit && env.item?.can?.edit) return <Builder key={env.id} env={env} />
  const orphan = edit ? readDraft(env.id) : null
  return <BaseView env={env} rescue={orphan && orphan.changes > 0 ? <DraftRescue id={env.id} doc={orphan.doc} reason={t('Змінювати цю базу тобі вже не можна.')} /> : null} />
}

function BaseView({ env, rescue }: { env: BaseEnvelope; rescue?: React.ReactNode }) {
  const base = env.id
  const C = context(env.id, env.version, env.doc)
  const UI = C.UI
  const can = env.item?.can as (NonNullable<BaseEnvelope['item']>['can'] & { own?: boolean }) | undefined
  // файл бази — та сама копія: після входу й лише тим, кому копіювати дозволено (власникові — завжди)
  const signedIn = !!useAuth((s) => s.user)
  const exportable = signedIn && (can?.copy !== false || !!can?.manage)
  /** незбережені правки цієї бази в цьому браузері (редактор їх відкриє) */
  const [draft] = useState(() => readDraft(base))
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<null | 'trash' | 'purge'>(null)
  const me = { id: base, name: UI.name as string }
  // файл — поточна збережена версія (чернетка редактора у файл не йде)
  const download = () => {
    setBusy(true)
    downloadBase(base).then(() => toast.success(t('Файл бази збережено — його можна імпортувати на сторінці «Бази»')), (e) => toast.error((e as Error).message)).finally(() => setBusy(false))
  }
  // версії — тим, хто може змінювати (сервер інакше їх не дає), і давні версії з коду
  const versions = !!can?.edit || VERSIONS.some((v) => v.base === base)
  // поточна версія — значок біля назви; є історія версій нижче — клік гортає до неї
  const vCls = 'ml-2 inline-flex translate-y-[-0.2em] items-center whitespace-nowrap rounded-full border border-line bg-panel2 px-2 py-0.5 align-middle font-mono text-[12px] font-medium tracking-normal text-muted'
  const vBadge = versions
    ? <a href="#versions" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); document.getElementById('versions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className={`${vCls} hover:border-spice/60 hover:text-spice`} title={t('Поточна версія {n} — до історії версій', { n: env.version })}>v{env.version}</a>
    : <span className={vCls} title={t('Поточна версія {n}', { n: env.version })}>v{env.version}</span>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        {rescue}
        <PageHead
          title={<>{UI.name}{vBadge}</>}
          lead={UI.lead}
          facts={UI.facts || []}
          badges={env.item && <ItemBar item={env.item} actions={false} className="min-w-0" />}
          actions={
            <>
              {/* дії одним рядком біля назви: зірка, «Доступ», решта — у меню «Дії», головне — «Редагувати» */}
              {env.item && (
                <ItemActions
                  item={env.item}
                  onChange={() => useBases.getState().loadBase(base, true)}
                  copyInMenu={!!can?.edit}
                  more={[
                    ...(exportable ? [{ label: t('Вивантажити'), icon: <Download size={14} />, onSelect: download, disabled: busy, hint: 'JSON' }] : []),
                    ...(can?.manage && !env.deleted ? [{ kind: 'separator' as const }, { label: t('Видалити'), icon: <Trash2 size={14} />, danger: true, onSelect: () => setAsk('trash') }] : []),
                  ]}
                />
              )}
              {can?.edit && <Button
                size="sm"
                onClick={() => useStore.getState().setView('bases', { base, edit: true })}
                className="hidden md:inline-flex"
                title={draft?.changes ? t('У цьому браузері є незбережені правки цієї бази — редактор відкриє їх') : undefined}
              >
                <PencilRuler size={14} /> {draft?.changes ? t('Продовжити редагування · {n}', { n: draft.changes }) : t('Редагувати')}
              </Button>}
            </>
          }
        />
        {env.deleted && can?.manage && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-2.5 text-[13.5px]">
            {t('Цю базу видалено — її видно лише за посиланням.')}
            <Button variant="secondary" size="sm" onClick={() => void untrashBase(me)}>
              <RotateCcw size={14} /> {t('Повернути')}
            </Button>
            {can.own && (
              <Button variant="ghost" size="sm" className="text-bad hover:text-bad" onClick={() => setAsk('purge')}>
                <Trash2 size={14} /> {t('Видалити назавжди')}
              </Button>
            )}
          </div>
        )}

        <BaseViewer env={env} C={C} />

        {/* ліміт елементів — одразу перед калькулятором: обидва з тих самих кількостей */}
        <Limits C={C} />
        <BaseCalc C={C} />

        {/* план будівництва і версії — в один ряд, двома стовпцями */}
        <div className={versions ? 'grid items-start gap-2.5 lg:grid-cols-2' : 'grid'}>
          <BuildPlan C={C} />
          {versions && <div id="versions" className="scroll-mt-3"><Versions env={env} /></div>}
        </div>
      </div>
      {ask === 'trash' && (
        <Confirm danger title={t('Видалити базу «{name}»?', { name: me.name })} text={t('Вона піде в кошик — її можна буде повернути зі списку видалених.')} confirm={t('Видалити')}
          onClose={() => setAsk(null)} onConfirm={() => void trashBase(me)} />
      )}
      {ask === 'purge' && (
        <Confirm danger title={t('Стерти «{name}» назавжди?', { name: me.name })} text={t('Разом з усіма версіями. Повернути вже не вийде.')} confirm={t('Видалити назавжди')}
          onClose={() => setAsk(null)} onConfirm={() => void eraseBase(me).then((ok) => { if (ok) useStore.getState().setView('bases') })} />
      )}
    </div>
  )
}
