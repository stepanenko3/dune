/**
 * «Вхід і безпека» в налаштуваннях профілю: паскеї (додати, перейменувати, видалити) і двофакторна перевірка
 * застосунком (увімкнути з QR-кодом, нові резервні коди, вимкнути). Сервер — routes/security.mjs.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Copy, Download, Fingerprint, Pencil, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { del, get, patch, post } from '@/lib/api'
import { locale, t } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'
import { cancelled, createPasskey, passkeyError, passkeysHere, passkeysWhyNot, type PasskeyInfo, type SecurityState } from '@/lib/webauthn'
import { qrPath } from '@/lib/qr'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ErrorAlert, Loading } from '@/components/states'
import { SnInput, SnInputOtp, valueOf } from '@/components/sn'
import { cn } from '@/lib/utils'

// рік — лише якщо не цей
const day = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
const otpValue = (e: Event) => { const d = (e as CustomEvent<string | { value: string }>).detail; return typeof d === 'string' ? d : d?.value ?? '' }
const phone = () => /iPhone|iPad|Android/i.test(navigator.userAgent)

export function Security() {
  const [s, setS] = useState<SecurityState | null>(null)
  const [error, setError] = useState('')
  const load = () => get<SecurityState>('/api/me/security').then((r) => { setS(r); setError('') }).catch((e) => setError((e as Error).message))
  useEffect(() => { void load() }, [])
  if (error) return <ErrorAlert message={error} />
  if (!s) return <Loading lines={4} />
  return (
    <div className="grid gap-5">
      <Passkeys list={s.passkeys} onChange={setS} />
      <div className="h-px bg-line" />
      <TwoFactor state={s} onChange={setS} />
    </div>
  )
}

function Passkeys({ list, onChange }: { list: PasskeyInfo[]; onChange: (s: SecurityState) => void }) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null)
  const nameBox = useRef<HTMLElement & { focus: () => void }>(null)
  useEffect(() => { if (editing) setTimeout(() => nameBox.current?.focus(), 30) }, [editing])
  const why = passkeysWhyNot()
  const add = async () => {
    setBusy(true)
    try { onChange(await createPasskey()); toast.success(t('Паскей додано')) } catch (e) { if (!cancelled(e)) toast.error(passkeyError(e)) } finally { setBusy(false) }
  }
  const rename = async (e: FormEvent, id: string) => {
    e.preventDefault()
    try { onChange(await patch<SecurityState>(`/api/me/passkeys/${encodeURIComponent(id)}`, { name })); setEditing(null) } catch (err) { toast.error((err as Error).message) }
  }
  const remove = async (k: PasskeyInfo) => {
    try { onChange(await del<SecurityState>(`/api/me/passkeys/${encodeURIComponent(k.id)}`)); toast.success(t('Паскей видалено')) } catch (err) { toast.error((err as Error).message) }
  }
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-[min(100%,14rem)] flex-1">
          <h3 className="flex items-center gap-2 text-[14.5px] font-semibold"><Fingerprint size={16} className="text-spice" />{t('Паскеї')}</h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{t('Вхід без коду з пошти — відбитком, обличчям чи PIN-кодом пристрою.')}</p>
        </div>
        <Button variant="secondary" onClick={() => void add()} disabled={busy || !passkeysHere()} loading={busy}><Fingerprint size={15} />{t('Додати паскей')}</Button>
      </div>
      {why && <p className="mt-2 text-[12.5px] text-muted">{why}</p>}
      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {list.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2.5">
              <Fingerprint size={18} className="shrink-0 text-muted" aria-hidden />
              {editing === k.id ? (
                <form onSubmit={(e) => void rename(e, k.id)} className="flex min-w-0 flex-1 items-center gap-1.5">
                  <SnInput ref={nameBox} size="sm" className="block min-w-0 flex-1" modelValue={name} maxLength={60} accessibilityLabel={t('Назва паскея')}
                    onInput={(e: Event) => setName(valueOf(e))}
                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget.closest('form') as HTMLFormElement)?.requestSubmit() } else if (e.key === 'Escape') setEditing(null) }} />
                  <Button type="submit" size="icon" variant="ghost" aria-label={t('Зберегти')}><Check size={15} /></Button>
                  <Button size="icon" variant="ghost" aria-label={t('Скасувати')} onClick={() => setEditing(null)}><X size={15} /></Button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[13.5px] font-medium">{k.name}</div>
                    <div className="text-[12px] text-muted">
                      {k.lastUsed ? t('додано {created} · вхід {used}', { created: day(k.created), used: day(k.lastUsed) }) : t('додано {created} · ще не входили', { created: day(k.created) })}
                      {k.backedUp && <> · {t('на всіх твоїх пристроях')}</>}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" aria-label={t('Перейменувати')} data-tip={t('Перейменувати')} onClick={() => { setEditing(k.id); setName(k.name) }}><Pencil size={14} /></Button>
                  <Button size="icon" variant="ghost" aria-label={t('Видалити')} data-tip={t('Видалити')} onClick={() => setRemoving(k)}><Trash2 size={14} /></Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <Modal open size="sm" onOpenChange={() => setRemoving(null)} title={t('Видалити паскей «{name}»?', { name: removing.name })}
          description={t('Увійти ним більше не вийде. Сам ключ лишиться в менеджері паролів — його можна прибрати там.')}
          footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>{t('Скасувати')}</Button><Button variant="destructive" onClick={() => { const k = removing; setRemoving(null); void remove(k) }}>{t('Видалити')}</Button></>}>
          {null}
        </Modal>
      )}
    </div>
  )
}

function TwoFactor({ state, onChange }: { state: SecurityState; onChange: (s: SecurityState) => void }) {
  const tf = state.twoFactor
  const [open, setOpen] = useState<'' | 'setup' | 'recovery' | 'disable'>('')
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-[min(100%,14rem)] flex-1">
          <h3 className="flex items-center gap-2 text-[14.5px] font-semibold">
            <ShieldCheck size={16} className="text-spice" />{t('Двофакторна перевірка')}
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', tf.enabled ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted')}>{tf.enabled ? t('увімкнено') : t('вимкнено')}</span>
          </h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
            {tf.enabled
              ? t('Після коду з пошти сайт питає код із застосунку. З {since}; резервних кодів лишилось: {n}.', { since: day(tf.since!), n: tf.recoveryLeft })
              : t('Після коду з пошти — ще код із застосунку-автентифікатора: без твого телефона не увійти, навіть маючи доступ до пошти. Паскей його не питає.')}
          </p>
        </div>
        {tf.enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setOpen('recovery')}>{t('Нові резервні коди')}</Button>
            <Button variant="ghost" onClick={() => setOpen('disable')}>{t('Вимкнути')}</Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setOpen('setup')}><ShieldCheck size={15} />{t('Увімкнути')}</Button>
        )}
      </div>
      {tf.enabled && tf.recoveryLeft <= 3 && <p className="mt-2 rounded-md bg-warn/10 px-3 py-2 text-[12.5px] text-warn">{t('Резервних кодів мало — створи нові, поки маєш доступ до застосунку.')}</p>}
      {open === 'setup' && <Setup onClose={() => setOpen('')} onChange={onChange} />}
      {(open === 'recovery' || open === 'disable') && <Confirm kind={open} onClose={() => setOpen('')} onChange={onChange} />}
    </div>
  )
}

/** резервні коди: показати один раз, скопіювати чи зберегти файлом */
function Codes({ codes }: { codes: string[] }) {
  const text = codes.join('\n')
  const name = useAuth.getState().site.name
  const save = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`${name} — ${t('резервні коди')}\n\n${text}\n`], { type: 'text/plain' }))
    a.download = `${name.toLowerCase()}-recovery-codes.txt`
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }
  return (
    <div className="grid gap-3">
      <p className="rounded-md bg-warn/10 px-3 py-2 text-[13px] leading-snug text-warn">{t('Збережи ці коди зараз — більше їх не покажемо. Кожен відкриває вхід один раз, якщо телефона з застосунком нема поруч.')}</p>
      <ul className="grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-panel2/40 p-3 font-mono text-[14px] tabular-nums">
        {codes.map((c) => <li key={c} className="text-center">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success(t('Скопійовано')), () => toast.error(t('Не вдалося скопіювати')))}><Copy size={15} />{t('Скопіювати')}</Button>
        <Button variant="secondary" onClick={save}><Download size={15} />{t('Зберегти файлом')}</Button>
      </div>
    </div>
  )
}

function Setup({ onClose, onChange }: { onClose: () => void; onChange: (s: SecurityState) => void }) {
  const [d, setD] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const otp = useRef<HTMLElement & { focus: () => void }>(null)
  useEffect(() => { post<{ secret: string; uri: string }>('/api/me/2fa/setup').then(setD, (e) => setError((e as Error).message)) }, [])
  // ключ прийшов — курсор одразу в поле коду (на телефоні застосунок відкривають кнопкою, а код вводять тут)
  useEffect(() => { if (d && !phone()) setTimeout(() => otp.current?.focus(), 80) }, [d])
  const qr = useMemo(() => (d ? qrPath(d.uri) : null), [d])
  const enable = async (value = code) => {
    if (value.replace(/\D/g, '').length !== 6 || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await post<SecurityState & { codes: string[] }>('/api/me/2fa/enable', { code: value })
      setCodes(r.codes)
      onChange(r)
    } catch (e) { setError((e as Error).message); setCode(''); setTimeout(() => otp.current?.focus(), 50) } finally { setBusy(false) }
  }
  return (
    <Modal open onOpenChange={onClose} title={codes ? t('Резервні коди') : t('Увімкнути двофакторну перевірку')}
      description={codes ? undefined : t('Додай Sandwalkers у застосунок-автентифікатор (Google Authenticator, 1Password, «Паролі» в iPhone…) і введи код, який він покаже.')}
      footer={codes ? <Button onClick={onClose}>{t('Готово, зберіг')}</Button> : <><Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button><Button onClick={() => void enable()} disabled={busy || code.replace(/\D/g, '').length !== 6} loading={busy}>{t('Увімкнути')}</Button></>}>
      {codes ? <Codes codes={codes} /> : !d ? (error ? <ErrorAlert message={error} /> : <Loading lines={4} />) : (
        <div className="grid justify-items-center gap-4">
          {phone() && (
            <Button href={d.uri} className="w-full"><Smartphone size={15} />{t('Додати в застосунок на цьому телефоні')}</Button>
          )}
          {qr && (
            // QR — завжди на білому (камера погано читає світлі модулі на темному)
            <svg viewBox={`0 0 ${qr.size} ${qr.size}`} className="h-auto w-[min(220px,70vw)] rounded-lg bg-white" role="img" aria-label={t('QR-код для застосунку-автентифікатора')} shapeRendering="crispEdges">
              <path d={qr.d} fill="#000" />
            </svg>
          )}
          <div className="w-full text-center">
            <p className="text-[12.5px] text-muted">{t('Не сканується? Введи ключ вручну:')}</p>
            <button type="button" className="mt-1 inline-flex max-w-full items-center gap-1.5 break-all rounded-md px-2 py-1 font-mono text-[13.5px] font-semibold tracking-wider hover:bg-panel2"
              onClick={() => void navigator.clipboard?.writeText(d.secret).then(() => toast.success(t('Ключ скопійовано')), () => {})}>
              {d.secret.replace(/(.{4})/g, '$1 ').trim()}<Copy size={13} className="shrink-0 text-muted" />
            </button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void enable() }} className="grid w-full justify-items-center gap-2">
            <span className="text-[13px] font-semibold">{t('Код із застосунку')}</span>
            <SnInputOtp ref={otp} length={6} groups={[3, 3]} size="lg" pattern="digits" autofocus modelValue={code} aria-label={t('Код із застосунку')}
              onChange={(e: Event) => setCode(valueOf(e) ?? '')}
              onComplete={(e: Event) => { const v = otpValue(e); setCode(v); void enable(v) }} />
            {error && <p role="alert" className="w-full rounded-md bg-bad/10 px-3 py-2 text-[13px] text-bad">{error}</p>}
          </form>
        </div>
      )}
    </Modal>
  )
}

/** нові резервні коди чи вимкнення — з кодом застосунку (чи резервним) */
function Confirm({ kind, onClose, onChange }: { kind: 'recovery' | 'disable'; onClose: () => void; onChange: (s: SecurityState) => void }) {
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      if (kind === 'recovery') {
        const r = await post<SecurityState & { codes: string[] }>('/api/me/2fa/recovery', { code })
        setCodes(r.codes)
        onChange(r)
      } else {
        onChange(await post<SecurityState>('/api/me/2fa/disable', { code }))
        toast.success(t('Двофакторну перевірку вимкнено'))
        onClose()
      }
    } catch (err) { setError((err as Error).message); setCode('') } finally { setBusy(false) }
  }
  const title = codes ? t('Резервні коди') : kind === 'recovery' ? t('Нові резервні коди') : t('Вимкнути двофакторну перевірку?')
  return (
    <Modal open onOpenChange={onClose} size="sm" title={title}
      description={codes ? undefined : kind === 'recovery' ? t('Старі коди перестануть діяти. Введи код із застосунку.') : t('Тоді для входу знову досить коду з пошти. Введи код із застосунку чи резервний.')}
      footer={codes ? <Button onClick={onClose}>{t('Готово, зберіг')}</Button> : <><Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button><Button variant={kind === 'disable' ? 'destructive' : 'default'} onClick={() => void go()} disabled={busy || !code.trim()} loading={busy}>{kind === 'recovery' ? t('Створити') : t('Вимкнути')}</Button></>}>
      {codes ? <Codes codes={codes} /> : (
        <form onSubmit={go} className="grid gap-2">
          <SnInput size="lg" modelValue={code} autofocus autocomplete="one-time-code" inputmode="text" placeholder={t('123456 чи xxxx-xxxx')} accessibilityLabel={t('Код')} className="block font-mono"
            onInput={(e: Event) => setCode(valueOf(e))}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void go() } }} />
          {error && <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-[13px] text-bad">{error}</p>}
        </form>
      )}
    </Modal>
  )
}
