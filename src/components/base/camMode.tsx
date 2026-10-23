/**
 * Режим камери будівельника: «Навколо центру» — за замовчуванням щоразу (центр стоїть на місці — лише обертати й
 * ближче/далі; перемикання сюди — назад у стартове положення), «Від першої особи» — погляд з місця, ходити WASD, як у
 * грі (лише до кінця сеансу на сторінці, не запам'ятовується). Звичайний перегляд бази — лише навколо центру.
 * Тут же — підказка, як керувати.
 */
import { useSyncExternalStore } from 'react'
import { Orbit, PersonStanding } from 'lucide-react'
import { Seg } from '@/components/ui/seg'
import type { CamMode } from '@/lib/engine'
import { t } from '@/lib/i18n'
let mode: CamMode = 'orbit'
const subs = new Set<() => void>()

export function setCamMode(m: CamMode) {
  if (m === mode) return
  mode = m
  for (const f of subs) f()
}
export const camModeNow = (): CamMode => mode
export function useCamMode(): CamMode {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => mode)
}

/** compact — лише значки (тісна панель будівельника), назва — у підказці */
export function CamModeSwitch({ size = 'md', compact = false }: { size?: 'sm' | 'md'; compact?: boolean }) {
  const m = useCamMode()
  const orbit = t('Навколо центру'), fly = t('Від першої особи')
  return (
    <Seg<CamMode>
      label={t('Камера')}
      size={size}
      value={m}
      onChange={setCamMode}
      items={[
        { id: 'orbit', label: compact ? <Orbit size={14} aria-label={orbit} /> : orbit, tip: `${compact ? orbit + ': ' : ''}${t('Крутити камеру навколо центру бази — центр не зсувається')}` },
        { id: 'fly', label: compact ? <PersonStanding size={14} aria-label={fly} /> : fly, tip: `${compact ? fly + ': ' : ''}${t('Дивитися з місця й ходити WASD, як у грі')}` },
      ]}
    />
  )
}

/** як керувати камерою в будівельнику — коротко, для підказки під палітрою */
export function camHint(m: CamMode): string {
  return m === 'fly'
    ? t('Права кнопка — роззирнутися, WASD — іти, Q/E — нижче/вище, Shift — швидше, колесо — крок до курсора, пробіл + тягни — зсув.')
    : t('Права кнопка — обертати навколо центру, колесо — ближче чи далі. Рухатися й ходити WASD — від першої особи.')
}
