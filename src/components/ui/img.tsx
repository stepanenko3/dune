/**
 * Картинка сайту: вантажиться ліниво (loading=lazy, decoding=async), місце під неї зарезервоване (розміри — з пропсів
 * або з адреси медіатеки #s=ШxВ), поки вантажиться — розмита заглушка ThumbHash з тієї ж адреси (#t=…), потім
 * картинка плавно проявляється. Чужа адреса дозволеного джерела стає нашим проксі (lib/media.ts), невідома чужа —
 * не показується. Не вантажиться — fallback (або нічого).
 * className — для самої картинки; boxClassName — для обгортки (вона є лише тоді, коли є заглушка).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { mediaInfo, ourImg } from '@/lib/media'
import { thumbHashDataUrl } from '@/lib/thumbhash'

export interface ImgProps {
  src: string | null | undefined
  alt?: string
  /** розміри для резерву місця (атрибути width/height); не задано — з адреси медіатеки */
  width?: number
  height?: number
  className?: string
  boxClassName?: string
  style?: CSSProperties
  /** вище першого екрана — без lazy */
  eager?: boolean
  /** що показати, якщо картинки нема чи вона не вантажиться */
  fallback?: ReactNode
  title?: string
  onLoad?: () => void
  onError?: () => void
}

export function Img({ src, alt = '', width, height, className, boxClassName, style, eager, fallback = null, title, onLoad, onError }: ImgProps) {
  const info = useMemo(() => {
    const u = ourImg(src)
    return u ? mediaInfo(u) : null
  }, [src])
  const [state, setState] = useState<'load' | 'ok' | 'bad'>('load')
  useEffect(() => setState('load'), [info?.src])
  // уже в кеші браузера — показуємо одразу, без проявлення
  const ref = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth) setState('ok')
  }, [])
  const ph = info?.thumb ? thumbHashDataUrl(info.thumb) : null
  if (!info || state === 'bad') return <>{fallback}</>

  const common = {
    ref,
    src: info.src,
    alt,
    title,
    width: width ?? info.w ?? undefined,
    height: height ?? info.h ?? undefined,
    loading: eager ? ('eager' as const) : ('lazy' as const),
    decoding: 'async' as const,
    referrerPolicy: 'no-referrer' as const,
    onLoad: () => { setState('ok'); onLoad?.() },
    onError: () => { setState('bad'); onError?.() },
  }
  const fade = cn('transition-opacity duration-300 motion-reduce:transition-none', state === 'ok' ? 'opacity-100' : 'opacity-0')
  if (!ph) return <img {...common} className={cn(fade, className)} style={style} />
  // заглушка — під картинкою, на весь її розмір; картинка проявляється, заглушка гасне. Розмір обгортці задає картинка
  return (
    <span className={cn('relative inline-block max-w-full overflow-hidden align-middle', boxClassName)} style={style}>
      <span
        aria-hidden
        className={cn('absolute inset-0 bg-cover bg-center transition-opacity duration-300 motion-reduce:transition-none', state === 'ok' ? 'opacity-0' : 'opacity-100')}
        style={{ backgroundImage: `url(${ph})` }}
      />
      <img {...common} className={cn('relative block', fade, className)} />
    </span>
  )
}
