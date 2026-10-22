/**
 * Вхід і реєстрація — одне й те саме: пошта → 6-значний код у листі (поле коду — sn-input-otp) → вхід. Нова пошта —
 * новий обліковий запис (ім'я й адреса сторінки — змінити можна в профілі). Паролів нема.
 * Паскей — вхід без пошти й коду: кнопкою чи підказкою прямо в полі пошти (автозаповнення браузера). На пристрої, де
 * вже входили паскеєм, він — першим. Після входу кодом (і після реєстрації) сайт пропонує зберегти паскей.
 * Увімкнено двофакторну перевірку — після коду з листа ще код застосунку (чи резервний); паскей її не питає.
 * Після входу — туди, звідки прийшли (?next=); новенький — у профіль. Перший, хто увійде на сайт, стає адміністратором.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { ArrowLeft, Fingerprint, KeyRound, LogIn, Mail } from 'lucide-react'
import { finishSignIn, offerPasskey, skipPasskeyOffer, useAuth, type SignedIn } from '@/lib/auth'
import { cancelled, conditionalAvailable, createPasskey, passkeyError, passkeysHere } from '@/lib/webauthn'
import { t, T } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { SnField, SnFieldDescription, SnFieldLabel, SnInput, SnInputOtp, valueOf } from '@/components/sn'

export const field = 'h-10 w-full rounded-md border border-line bg-panel px-3 text-[14px] text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-spice'

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <SnField>
      <SnFieldLabel>{label}</SnFieldLabel>
      {children}
      {hint && <SnFieldDescription>{hint}</SnFieldDescription>}
    </SnField>
  )
}

const GAP = 45 // с між листами — як на сервері

/** вставка коду: у листі він буває з пробілом («098 194») — беремо самі цифри (поле приймає лише 6 знаків) */
const pasteDigits = (e: React.ClipboardEvent, set: (v: string) => void, done: (v: string) => void) => {
  const text = e.clipboardData?.getData('text') ?? ''
  const digits = text.replace(/\D/g, '').slice(0, 6)
  if (!digits || digits === text) return
  e.preventDefault()
  set(digits)
  if (digits.length === 6) done(digits)
}
const otpValue = (e: Event) => { const d = (e as CustomEvent<string | { value: string }>).detail; return typeof d === 'string' ? d : d?.value ?? '' }

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-[12px] text-muted" role="separator">
      <span className="h-px flex-1 bg-line" />{children}<span className="h-px flex-1 bg-line" />
    </div>
  )
}

export function AuthPage() {
  const user = useAuth((s) => s.user)
  const [step, setStep] = useState<'email' | 'code' | '2fa' | 'offer'>('email')
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('auth:email') || '' } catch { return '' } })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'' | 'send' | 'code' | 'passkey' | 'create'>('')
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)
  const [ticket, setTicket] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [signed, setSigned] = useState<SignedIn | null>(null)
  const otp = useRef<HTMLElement & { focus: () => void }>(null)
  const can = passkeysHere()
  // на цьому пристрої вже входили паскеєм — він першим
  const [usual] = useState(() => { try { return can && !!localStorage.getItem('auth:passkey') } catch { return false } })

  useEffect(() => {
    if (wait <= 0) return
    const h = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(h)
  }, [wait])

  /** увійшли: запропонувати паскей (якщо ще нема) або одразу далі */
  const done = (r: SignedIn) => {
    if (r.recoveryLeft !== undefined) toast.warning(r.recoveryLeft ? t('Резервних кодів лишилось: {n}. Створи нові в профілі.', { n: r.recoveryLeft }) : t('Резервні коди скінчились — створи нові в профілі.'))
    if (offerPasskey(r)) { setSigned(r); setStep('offer'); setBusy(''); setError('') } else finishSignIn(r)
  }

  // паскей підказкою в полі пошти (автозаповнення): тихий запит, поки відкрито перший крок
  const quiet = useRef<AbortController | null>(null)
  const stopQuiet = () => { quiet.current?.abort(); quiet.current = null }
  useEffect(() => {
    if (step !== 'email' || !can) return
    let live = true
    void conditionalAvailable().then((ok) => {
      if (!ok || !live) return
      const ac = new AbortController()
      quiet.current = ac
      useAuth.getState().passkey({ conditional: true, signal: ac.signal }).then(done, (e) => { if (!cancelled(e) && !ac.signal.aborted) setError(passkeyError(e)) })
    })
    return () => { live = false; stopQuiet() }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const withPasskey = async () => {
    stopQuiet()
    setBusy('passkey')
    setError('')
    try { done(await useAuth.getState().passkey()) } catch (e) { if (!cancelled(e)) setError(passkeyError(e)); setBusy('') }
  }

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    setBusy('send')
    setError('')
    const toCode = (w: number) => { stopQuiet(); setStep('code'); setCode(''); setWait(w); setTimeout(() => otp.current?.focus(), 80) }
    try {
      await useAuth.getState().sendCode(email)
      try { localStorage.setItem('auth:email', email.trim()) } catch { /* без сховища */ }
      toCode(GAP)
    } catch (err) {
      // код уже в листі (повернулись на «Інша пошта» чи оновили сторінку) — одразу до його введення
      const body = err instanceof ApiError ? (err.body as { already?: boolean } | null) : null
      if (body?.already) toCode(GAP)
      else setError((err as Error).message)
    } finally {
      setBusy('')
    }
  }
  /** вхід уже йде (вставка й «код повний» можуть прийти разом) */
  const verifying = useRef(false)
  const verify = async (value = code) => {
    const digits = value.replace(/\D/g, '')
    if (digits.length !== 6 || verifying.current) return
    verifying.current = true
    setBusy('code')
    setError('')
    try {
      const r = await useAuth.getState().verify(email, digits)
      if ('twoFactor' in r) { setTicket(r.ticket); setStep('2fa'); setCode(''); setRecovery(false); setBusy(''); setTimeout(() => otp.current?.focus(), 80) } else done(r)
    } catch (err) {
      setError((err as Error).message)
      setCode('')
      setBusy('')
      setTimeout(() => otp.current?.focus(), 50)
    } finally {
      verifying.current = false
    }
  }
  /** другий крок: код застосунку (6 цифр) чи резервний */
  const second = async (value = code) => {
    const v = value.trim()
    if ((!recovery && v.replace(/\D/g, '').length !== 6) || (recovery && v.replace(/[^a-z0-9]/gi, '').length !== 8) || verifying.current) return
    verifying.current = true
    setBusy('code')
    setError('')
    try {
      done(await useAuth.getState().verify2fa(ticket, v))
    } catch (err) {
      setError((err as Error).message)
      setCode('')
      setBusy('')
      // квиток згорів (забагато спроб чи минув час) — назад до пошти
      if (err instanceof ApiError && (err.body as { restart?: number } | null)?.restart) { setStep('email'); setTicket('') }
      else if (!recovery) setTimeout(() => otp.current?.focus(), 50)
    } finally {
      verifying.current = false
    }
  }
  const create = async () => {
    if (!signed) return
    setBusy('create')
    setError('')
    try {
      await createPasskey()
      toast.success(t('Паскей збережено — наступного разу вхід без коду'))
      finishSignIn(signed)
    } catch (e) {
      if (!cancelled(e)) setError(passkeyError(e))
      setBusy('')
    }
  }

  const back = (
    <button type="button" onClick={() => { setStep('email'); setError(''); setTicket('') }} className="-ml-1 mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
      <ArrowLeft size={14} /> {step === 'code' ? t('Інша пошта') : t('Назад')}
    </button>
  )
  const err = error && <p role="alert" className="w-full rounded-md bg-bad/10 px-3 py-2 text-[13px] text-bad">{error}</p>
  const passkeyBtn = (primary: boolean) => (
    <Button variant={primary ? 'default' : 'outline'} onClick={() => void withPasskey()} disabled={!!busy} loading={busy === 'passkey'} className="w-full">
      <Fingerprint size={16} />{t('Увійти з паскеєм')}
    </Button>
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-[420px] gap-3 py-[7vh]">
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm sm:p-6">
          {step === 'email' ? (
            <>
              <h1 className="font-display text-[22px] font-bold">{t('Вхід')}</h1>
              <p className="mt-1 text-[13.5px] leading-snug text-muted">
                {can ? t('Паскеєм — одним дотиком, або кодом на пошту. Нова пошта — новий обліковий запис, без паролів.') : t('Введи пошту — надішлемо код. Нова пошта — новий обліковий запис, без паролів.')}
              </p>
              {user && <p className="mt-3 rounded-md bg-ok/10 px-3 py-2 text-[13px] text-ok">{t('Ти вже увійшов як {name}.', { name: user.name })}</p>}
              <div className="mt-5 grid gap-3.5">
                {usual && <>{passkeyBtn(true)}<Divider>{t('або кодом на пошту')}</Divider></>}
                <form onSubmit={send} className="grid gap-3.5">
                  <Field label={t('Пошта')}>
                    {/* «webauthn» — браузер підкаже в цьому полі й паскеї сайту */}
                    <SnInput type="email" size="md" modelValue={email} autocomplete={can ? 'username webauthn' : 'email'} required autofocus={!usual} placeholder={t('ти@приклад.com')} accessibilityLabel={t('Пошта')}
                      onInput={(e: Event) => setEmail(valueOf(e))}
                      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && email.trim() && !busy) { e.preventDefault(); void send() } }} />
                  </Field>
                  {err}
                  <Button type="submit" variant={usual ? 'outline' : 'default'} disabled={!!busy || !email.trim()} loading={busy === 'send'} className="w-full">
                    <Mail size={15} />
                    {busy === 'send' ? t('Надсилаю…') : t('Надіслати код')}
                  </Button>
                </form>
                {can && !usual && <><Divider>{t('або')}</Divider>{passkeyBtn(false)}</>}
              </div>
            </>
          ) : step === 'code' ? (
            <>
              {back}
              <h1 className="font-display text-[22px] font-bold">{t('Код із листа')}</h1>
              <p className="mt-1 text-[13.5px] leading-snug text-muted">
                <T text="Надіслали на {email}. Код діє 10 хвилин." email={<b className="font-semibold text-ink">{email.trim()}</b>} />
              </p>
              <form onSubmit={(e) => { e.preventDefault(); void verify() }} className="mt-5 grid justify-items-center gap-3.5">
                <SnInputOtp ref={otp} length={6} groups={[3, 3]} size="lg" pattern="digits" autofocus modelValue={code} aria-label={t('Код із листа')}
                  onChange={(e: Event) => setCode(valueOf(e) ?? '')}
                  onPaste={(e: React.ClipboardEvent) => pasteDigits(e, setCode, (v) => void verify(v))}
                  onComplete={(e: Event) => { const v = otpValue(e); setCode(v); void verify(v) }} />
                {err}
                <Button type="submit" disabled={!!busy || code.replace(/\D/g, '').length !== 6} loading={busy === 'code'} className="w-full">
                  <LogIn size={15} />
                  {busy === 'code' ? t('Хвилинку…') : t('Увійти')}
                </Button>
              </form>
              <div className="mt-4 text-center text-[12.5px]">
                <button type="button" disabled={wait > 0 || !!busy} onClick={() => send()} className="text-spice hover:underline disabled:cursor-default disabled:text-muted disabled:no-underline">
                  {wait > 0 ? t('Надіслати ще раз через {n} с', { n: wait }) : t('Надіслати ще раз')}
                </button>
              </div>
            </>
          ) : step === '2fa' ? (
            <>
              {back}
              <h1 className="font-display text-[22px] font-bold">{recovery ? t('Резервний код') : t('Код із застосунку')}</h1>
              <p className="mt-1 text-[13.5px] leading-snug text-muted">
                {recovery ? t('Один із кодів, які ти зберіг, коли вмикав перевірку. Кожен діє один раз.') : t('Відкрий застосунок-автентифікатор і введи 6-значний код для {site}.', { site: useAuth.getState().site.name })}
              </p>
              <form onSubmit={(e) => { e.preventDefault(); void second() }} className="mt-5 grid justify-items-center gap-3.5">
                {recovery ? (
                  <div className="w-full">
                    <SnInput key="rc" size="lg" modelValue={code} autofocus autocomplete="one-time-code" placeholder="xxxx-xxxx" accessibilityLabel={t('Резервний код')} className="block font-mono"
                      onInput={(e: Event) => setCode(valueOf(e))}
                      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void second() } }} />
                  </div>
                ) : (
                  <SnInputOtp key="totp" ref={otp} length={6} groups={[3, 3]} size="lg" pattern="digits" autofocus modelValue={code} aria-label={t('Код із застосунку')}
                    onChange={(e: Event) => setCode(valueOf(e) ?? '')}
                    onPaste={(e: React.ClipboardEvent) => pasteDigits(e, setCode, (v) => void second(v))}
                    onComplete={(e: Event) => { const v = otpValue(e); setCode(v); void second(v) }} />
                )}
                {err}
                <Button type="submit" disabled={!!busy || !code.trim()} loading={busy === 'code'} className="w-full">
                  <LogIn size={15} />
                  {busy === 'code' ? t('Хвилинку…') : t('Увійти')}
                </Button>
              </form>
              <div className="mt-4 grid justify-items-center gap-2 text-[12.5px]">
                <button type="button" onClick={() => { setRecovery(!recovery); setCode(''); setError('') }} className="text-spice hover:underline">
                  {recovery ? t('Ввести код із застосунку') : t('Немає телефону? Резервний код')}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-spice/10 text-spice"><KeyRound size={22} /></span>
              <h1 className="mt-3 font-display text-[22px] font-bold">{t('Входь без коду')}</h1>
              <p className="mt-1 text-[13.5px] leading-snug text-muted">{t('Збережи паскей — наступного разу увійдеш відбитком, обличчям чи PIN-кодом пристрою, без листа. Паскей зберігається в менеджері паролів і є на всіх твоїх пристроях.')}</p>
              <div className="mt-5 grid gap-2.5">
                {err}
                <Button onClick={() => void create()} disabled={!!busy} loading={busy === 'create'} className="w-full"><Fingerprint size={16} />{t('Створити паскей')}</Button>
                <Button variant="ghost" disabled={!!busy} onClick={() => { skipPasskeyOffer(); if (signed) finishSignIn(signed) }} className="w-full">{t('Пізніше')}</Button>
              </div>
            </>
          )}
        </div>
        {(step === 'email' || step === 'code') && <p className="px-1 text-center text-[12.5px] text-muted">{t('Лист не прийшов? Зазирни в «Спам» і перевір, чи правильна пошта.')}</p>}
      </div>
    </div>
  )
}
