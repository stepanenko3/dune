/** Шапка сторінки: назва, вступ і ключові цифри (факти — HTML із <b>, тексти з репозиторію). */
export function PageHead({ title, lead, facts }: { title: string; lead: string; facts: string[] }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-7 gap-y-2 rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sm">
      <div className="min-w-0 max-w-full">
        <h1 className="text-balance font-display text-[clamp(19px,2.6vw,28px)] font-bold leading-tight tracking-[-0.01em]">{title}</h1>
        <p className="mt-1 max-w-[70ch] text-[14px] text-muted">{lead}</p>
      </div>
      <ul className="flex flex-wrap gap-x-[18px] gap-y-1.5 font-mono text-[13px] font-medium tabular-nums text-muted [&_b]:font-semibold [&_b]:text-ink" aria-label="Основні цифри">
        {facts.map((f, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: f }} />
        ))}
      </ul>
    </header>
  )
}
