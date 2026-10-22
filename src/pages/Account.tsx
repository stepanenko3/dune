/**
 * Налаштування профілю: ім'я, адреса сторінки, нік у грі, про себе, колір; мова сайту; пошта (вхід — кодом на неї);
 * моя гільдія (одна, як у грі: перехід на її сторінку й вихід; без гільдії — пошук); вхід і безпека (паскеї, двофакторна
 * перевірка — components/account/Security); сеанси (де ти увійшов) з
 * виходом; видалення облікового запису.
 */
import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Check, Download, LogOut, Monitor, Smartphone, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { del, get, post } from '@/lib/api'
import { GUILD_ROLE_LABEL, loginHref, safeNext, SITE_ROLE_LABEL, useAuth } from '@/lib/auth'
import { currentLang, LANGS, locale, setLang, t } from '@/lib/i18n'
import { useStore, openPath } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorAlert, Loading } from '@/components/states'
import { Avatar, GuildTag } from '@/components/access/Access'
import { SnColorPicker, SnInput, SnTextarea, valueOf } from '@/components/sn'
import { cn } from '@/lib/utils'
import { Field } from './Auth'
import { plainClick } from '@/lib/urlState'
import { DuneLoader } from '@/components/ui/dune-loader'
import { useUnsaved } from '@/components/UnsavedBar'
import { Security } from '@/components/account/Security'

const COLORS = ['#d9481f', '#ee8a2c', '#c9a227', '#5f9e4b', '#2f9e8f', '#2f6fd0', '#6a5acd', '#a855a8', '#c2410c', '#0e7490', '#6b7280', '#1f2937']

/** «Завантажити мої дані»: файл від сервера (помилку — повідомленням, а не сторінкою з відповіддю) */
async function downloadMine() {
  try {
    const r = await fetch('/api/me/export', { credentials: 'same-origin' })
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || t('Не вдалося вивантажити'))
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'sandwalkers.json'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await r.blob())
    a.download = name
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  } catch (e) {
    toast.error((e as Error).message)
  }
}

export function Section({ title, hint, children, danger }: { title: string; hint?: string; children: ReactNode; danger?: boolean }) {
  return (
    <section className={cn('rounded-xl border bg-panel p-4 shadow-sm sm:p-5', danger ? 'border-bad/40' : 'border-line')}>
      <h2 className={cn('font-display text-[16px] font-bold', danger && 'text-bad')}>{title}</h2>
      {hint && <p className="mt-1 text-[13px] leading-snug text-muted">{hint}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  )
}

/** колір: готові кольори, свій (шістнадцяткове значення чи вибір на палітрі) */
export function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return <SnColorPicker size="lg" modelValue={value} presets={COLORS} accessibilityLabel={t('Колір')} onChange={(e: Event) => onChange(valueOf(e))} />
}

/** Enter у полі sn-input сам не надсилає форму — надсилаємо, як у звичайному <input> (крім набору через IME) */
export function submitOnEnter(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || (e.target as HTMLElement).tagName !== 'SN-INPUT') return
  e.preventDefault()
  e.currentTarget.requestSubmit()
}

/** підтвердження дії вікном (замість confirm() браузера); монтуй лише коли треба — відкрите, поки змонтоване */
export function ConfirmDialog({ title, text, confirm, danger, onClose, onConfirm }: {
  title: ReactNode
  text?: ReactNode
  /** підпис кнопки підтвердження */
  confirm: string
  danger?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open
      size="sm"
      onOpenChange={onClose}
      title={title}
      description={text}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button>
          <Button variant={danger ? 'destructive' : 'default'} onClick={() => { onClose(); onConfirm() }}>{confirm}</Button>
        </>
      }
    >
      {null}
    </Modal>
  )
}

interface Sess { id: string; created: number; seen: number; agent: string; ip: string; current: boolean }
const when = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const device = (a: string) => (/iPhone|Android|Mobile/i.test(a) ? t('Телефон') : t("Комп'ютер")) + (/Firefox/.test(a) ? ', Firefox' : /Edg\//.test(a) ? ', Edge' : /Chrome\//.test(a) ? ', Chrome' : /Safari\//.test(a) ? ', Safari' : '')

/** «Моя гільдія»: тег, назва, роль, скільки учасників із ліміту; перейти на сторінку гільдії й вийти з неї */
function MyGuild() {
  const { guild, requests, site } = useAuth()
  const setView = useStore((s) => s.setView)
  const [asking, setAsking] = useState(false)
  const leave = async () => {
    if (!guild) return
    try {
      await post(`/api/guilds/${guild.slug}/leave`)
      await useAuth.getState().load()
      toast.success(t('Ти вийшов з гільдії'))
    } catch (e) { toast.error((e as Error).message) }
  }
  if (!guild) {
    return (
      <Empty icon={Users} framed={false} title={t('Ти ще не в гільдії')} description={requests.length ? t('Подано заявок: {n}', { n: requests.length }) : t('Знайди гільдію й подай заявку чи створи свою — у грі гільдія в людини одна.')}>
        <a href="/guilds" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('guilds') }} className="text-[13.5px] font-semibold text-spice hover:underline">{t('Знайти гільдію')}</a>
      </Empty>
    )
  }
  const full = guild.members >= site.guildCap
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3 rounded-lg border border-spice/50 bg-spice/10 px-3 py-2.5">
        <GuildTag tag={guild.tag} color={guild.color} />
        <div className="min-w-0 flex-1">
          <a href={`/g/${guild.slug}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('guild', { param: guild.slug }) }} className="block truncate text-[14.5px] font-semibold hover:text-spice">{guild.name}</a>
          <div className="text-[12.5px] text-muted">
            {GUILD_ROLE_LABEL[guild.role]} · <span className={cn(full && 'font-semibold text-warn')}>{t('Учасників: {n} з {cap}', { n: guild.members, cap: site.guildCap })}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setView('guild', { param: guild.slug })}>{t('До гільдії')}</Button>
        {guild.role === 'leader'
          ? <span className="text-[12.5px] text-muted">{t('Лідер не може просто вийти: передай лідерство чи видали гільдію на її сторінці.')}</span>
          : <Button variant="ghost" onClick={() => setAsking(true)}><LogOut size={15} />{t('Вийти з гільдії')}</Button>}
      </div>
      {asking && (
        <ConfirmDialog danger title={t('Вийти з гільдії «{name}»?', { name: guild.name })} text={t('Щоб вступити в іншу гільдію, спершу треба вийти з цієї.')} confirm={t('Вийти з гільдії')} onClose={() => setAsking(false)} onConfirm={leave} />
      )}
    </div>
  )
}

export function Account() {
  const { user, ready } = useAuth()
  const setView = useStore((s) => s.setView)
  const [p, setP] = useState({ name: '', login: '', nick: '', bio: '', color: '#2f6fd0' })
  const [sessions, setSessions] = useState<Sess[] | null>(null)
  const [sessionsError, setSessionsError] = useState('')
  const [delEmail, setDelEmail] = useState('')
  const [askDel, setAskDel] = useState(false)
  const [busy, setBusy] = useState('')
  const [switching, setSwitching] = useState('')

  useEffect(() => { if (user) setP({ name: user.name, login: user.login, nick: user.nick, bio: user.bio, color: user.color }) }, [user])
  // адреса — /u/<свій логін>/settings: з /me, чужого логіна чи після зміни свого — на свою (без нового кроку історії)
  const param = useStore((s) => s.param)
  useEffect(() => { if (user && param !== user.login) setView('account', { param: user.login, replace: true, search: location.search }) }, [user, param]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadSessions = () => get<{ rows: Sess[] }>('/api/me/sessions').then((r) => { setSessions(r.rows); setSessionsError('') }).catch((e) => setSessionsError((e as Error).message))
  useEffect(() => { if (user) loadSessions() }, [user?.id])
  useEffect(() => { if (ready && !user) location.replace(loginHref()) }, [ready, user])
  // незбережене в профілі — смуга внизу (components/UnsavedBar): «Зберегти» / «Скасувати»
  const profDirty = !!user && (p.name !== user.name || p.login !== user.login || p.nick !== user.nick || p.bio !== user.bio || p.color !== user.color)
  useUnsaved(profDirty, { save: () => saveProfile(), discard: () => user && setP({ name: user.name, login: user.login, nick: user.nick, bio: user.bio, color: user.color }), label: t('Профіль не збережено') })
  if (!user) return <Loading page />

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try { await fn(); toast.success(ok) } catch (e) { toast.error((e as Error).message) } finally { setBusy('') }
  }
  const saveProfile = (e?: FormEvent) => { e?.preventDefault(); return run('p', () => useAuth.getState().update(p), t('Профіль збережено')) }
  // мову запам'ятовуємо в профілі й на пристрої; сторінка перезавантажується вибраною мовою
  const pickLang = (code: string) => {
    if (switching || code === currentLang()) return
    setSwitching(code)
    void setLang(code, { save: (l) => useAuth.getState().update({ lang: l }) })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          meta={<><Avatar name={p.name || user.name} color={p.color} size={24} /><span className="text-[13.5px] font-semibold">{user.name}</span></>}
          title={t('Налаштування профілю')}
          lead={`@${user.login} · ${user.email} · ${SITE_ROLE_LABEL[user.role]}`}
          actions={<Button variant="secondary" onClick={() => setView('user', { param: user.login })}>{t('Мій профіль')}</Button>}
        />
        {/* щойно зареєструвався за посиланням (запрошення тощо): вказати ім'я — і далі, куди йшов */}
        {safeNext(new URLSearchParams(location.search).get('next')) && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-spice/40 bg-spice/10 px-4 py-3 text-[14px]">
            <span className="min-w-0 flex-1">{t('Вітаємо! Вкажи ім’я, яке бачитимуть інші, — і продовжуй, куди йшов.')}</span>
            <Button onClick={() => openPath(safeNext(new URLSearchParams(location.search).get('next')) ?? '/')}>{t('Далі')}</Button>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-2.5 lg:grid-cols-2">
        <Section title={t('Профіль')} hint={t('Це бачать інші на твоїй сторінці, у гільдії й під тим, що ти виклав.')}>
          <form onSubmit={saveProfile} onKeyDown={submitOnEnter} className="grid gap-3.5">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 sm:grid-cols-2">
              <Field label={t("Ім'я на сайті")}>
                <SnInput size="lg" modelValue={p.name} maxLength={40} required accessibilityLabel={t("Ім'я на сайті")} onInput={(e: Event) => setP({ ...p, name: valueOf(e) })} />
              </Field>
              <Field label={t('Нік у грі')}>
                <SnInput size="lg" modelValue={p.nick} maxLength={40} placeholder={t('Як тебе звати в Dune')} accessibilityLabel={t('Нік у грі')} onInput={(e: Event) => setP({ ...p, nick: valueOf(e) })} />
              </Field>
            </div>
            <Field label={t('Адреса твоєї сторінки')} hint={t('{url} — латинські літери, цифри, «_», «.», «-»', { url: `${location.host}/u/${p.login || '…'}` })}>
              <SnInput size="lg" modelValue={p.login} minLength={3} maxLength={24} required accessibilityLabel={t('Адреса твоєї сторінки')} onInput={(e: Event) => setP({ ...p, login: valueOf(e).toLowerCase() })} />
            </Field>
            <Field label={t('Про себе')}>
              <SnTextarea size="lg" rows={4} modelValue={p.bio} maxLength={500} placeholder={t('Сервер, чим займаєшся в грі, як знайти')} accessibilityLabel={t('Про себе')} onInput={(e: Event) => setP({ ...p, bio: valueOf(e) })} />
            </Field>
            <Field label={t('Колір')}><ColorPick value={p.color} onChange={(color) => setP({ ...p, color })} /></Field>
          </form>
        </Section>

        <div className="grid gap-2.5">
        <Section title={t('Мова сайту')} hint={t('Сайт перезавантажиться вибраною мовою. Вибір збережеться в твоєму профілі.')}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {LANGS.map((l) => {
              const on = l.code === currentLang()
              return (
                <button key={l.code} type="button" lang={l.code} aria-pressed={on} disabled={!!switching} onClick={() => pickLang(l.code)}
                  className={cn('flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13.5px] font-semibold transition-colors disabled:cursor-wait', on ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40', switching && !on && switching !== l.code && 'opacity-50')}>
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  {switching === l.code ? <DuneLoader size={18} label={t('Завантаження…')} /> : on && <Check size={15} className="shrink-0 text-spice" aria-hidden />}
                </button>
              )
            })}
          </div>
        </Section>

        <Section title={t('Моя гільдія')} hint={t('Гільдія в людини одна, як у грі. Її указ тижня бере калькулятор; її гільдійське відкривається першим.')}>
          <MyGuild />
        </Section>

        <Section title={t('Вхід і безпека')} hint={t('Як ти входиш: кодом на пошту {email}, паскеєм і, якщо ввімкнеш, ще кодом із застосунку.', { email: user.email ?? '' })}>
          <Security />
        </Section>

        <Section title={t('Де ти увійшов')} hint={t('Не впізнаєш пристрій — вийди на ньому. Увійти можна лише кодом із твоєї пошти чи твоїм паскеєм.')}>
          {sessionsError && <ErrorAlert message={sessionsError} className="mb-2" />}
          {!sessions && !sessionsError && <Loading lines={3} />}
          <ul className="divide-y divide-line">
            {sessions?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                {/iPhone|Android|Mobile/i.test(s.agent) ? <Smartphone size={18} className="shrink-0 text-muted" /> : <Monitor size={18} className="shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium">{device(s.agent)}{s.current && <span className="ml-2 rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-semibold text-ok">{t('цей')}</span>}</div>
                  <div className="text-[12px] text-muted">{t('востаннє {seen} · увійшов {created}', { seen: when(s.seen), created: when(s.created) })}{s.ip ? ` · ${s.ip}` : ''}</div>
                </div>
                {!s.current && <Button variant="ghost" size="sm" onClick={() => run('s', async () => { await del(`/api/me/sessions/${s.id}`); loadSessions() }, t('Сеанс закрито'))}><LogOut size={14} />{t('Вийти')}</Button>}
              </li>
            ))}
          </ul>
          {!!sessions && sessions.length > 1 && <Button variant="secondary" className="mt-2" onClick={() => run('s', async () => { await post('/api/me/sessions/others'); loadSessions() }, t('Вийшов на всіх інших пристроях'))}>{t('Вийти на всіх інших пристроях')}</Button>}
        </Section>

        <Section title={t('Мої дані')} hint={t('Усе твоє одним файлом: профіль, твої бази, роадмапи, білди, розрахунки, позначки й записи ресурсів з усім вмістом, гільдія, сеанси, зірки.')}>
          <div><Button variant="secondary" onClick={() => void downloadMine()}><Download size={15} />{t('Завантажити мої дані')}</Button></div>
        </Section>
        <Section title={t('Видалити обліковий запис')} danger hint={t('Твоє особисте (бази, роадмапи, білди, розрахунки, позначки, записи ресурсів) зникне назавжди разом з історією змін. Гільдії, де ти лідер, перейдуть офіцеру чи найдавнішому учаснику, а гільдія без нікого — зникне. Гільдійське, що ти створив, лишається гільдії; у журналах ти станеш безіменним.')}>
          <form onSubmit={(e) => { e.preventDefault(); setAskDel(true) }} onKeyDown={submitOnEnter} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Field label={t('Твоя пошта для підтвердження')}>
                <SnInput size="lg" type="email" modelValue={delEmail} placeholder={user.email} required accessibilityLabel={t('Твоя пошта для підтвердження')} onInput={(e: Event) => setDelEmail(valueOf(e))} />
              </Field>
            </div>
            <Button type="submit" variant="destructive" disabled={busy === 'del'} className="h-10"><Trash2 size={15} />{t('Видалити назавжди')}</Button>
          </form>
          {askDel && (
            <ConfirmDialog danger title={t('Видалити обліковий запис')} text={t('Точно видалити обліковий запис назавжди?')} confirm={t('Видалити назавжди')} onClose={() => setAskDel(false)}
              onConfirm={() => run('del', async () => { await del('/api/me', { confirm: delEmail }); location.assign('/') }, t('Обліковий запис видалено'))} />
          )}
        </Section>
        </div>
        </div>
      </div>
    </div>
  )
}
