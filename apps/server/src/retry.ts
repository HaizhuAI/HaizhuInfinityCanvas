/**
 * Retrying provider requests without paying twice.
 *
 * - `idempotent` (reads: polling a job, listing, downloading, chat): retried on network errors and on
 *   statuses that mean "try again" (408, 425, 429, 500, 502, 503, 504).
 * - `paid` (starting a generation): retried only when the provider certainly did not do the work —
 *   the connection was never made (refused, name not found, unreachable), or it answered 429 / 503
 *   (rejected before processing). A timeout or a 502/504 after sending may mean the work was done, so
 *   those are reported instead of risking a second charge.
 * Waits 1 s, 3 s, 7 s (plus jitter) or what Retry-After says, at most 20 s.
 */
export type RetryPolicy = 'idempotent' | 'paid' | 'none'

export const retryTiming = { delays: [1000, 3000, 7000], max: 20_000 }
export const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const PAID_RETRY_STATUS = new Set([429, 503])
/** the request never reached the provider */
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL'])

export function attempts(policy: RetryPolicy) { return policy === 'none' ? 1 : retryTiming.delays.length + 1 }

export function retryStatus(policy: RetryPolicy, status: number) {
  return policy === 'idempotent' ? TRANSIENT_STATUS.has(status) : policy === 'paid' ? PAID_RETRY_STATUS.has(status) : false
}

/** whether a thrown fetch error may be retried under this policy (never an abort or a timeout) */
export function retryError(policy: RetryPolicy, e: unknown) {
  const err = e as Error & { cause?: { code?: string }; code?: string }
  if (policy === 'none' || err?.name === 'AbortError' || err?.name === 'TimeoutError') return false
  const code = err?.cause?.code ?? err?.code
  if (policy === 'paid') return !!code && NOT_SENT.has(code)
  return true
}

export function retryDelay(attempt: number, retryAfter?: string | null): number {
  let ms = NaN
  if (retryAfter) ms = /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()
  const wait = Number.isFinite(ms) && ms > 0 ? ms : retryTiming.delays[Math.min(attempt, retryTiming.delays.length - 1)]!
  return Math.min(retryTiming.max, wait) + Math.floor(Math.random() * 200)
}

export const sleepFor = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason ?? new Error('aborted'))
  const t = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')) }, { once: true })
})
