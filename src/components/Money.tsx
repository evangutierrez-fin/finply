import { useCountUp } from '../hooks.ts'
import { fmtMoney } from '../format.ts'

/** Cifra monetaria en mono tabular; los negativos van "en números rojos". */
export function Money({
  cents,
  signed = false,
  className = '',
}: {
  cents: number
  signed?: boolean
  className?: string
}) {
  const negative = cents < 0
  const prefix = signed && cents > 0 ? '+' : ''
  return (
    <span className={`cifra${negative ? ' cifra-neg' : ''} ${className}`.trim()}>
      {prefix}
      {fmtMoney(cents)}
    </span>
  )
}

/** Cifra grande animada: cuenta desde el valor anterior hasta el nuevo. */
export function CountUpMoney({ cents, className = '' }: { cents: number; className?: string }) {
  const animated = useCountUp(cents)
  return <Money cents={animated} className={className} />
}
